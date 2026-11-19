"""Hybrid retrieval, PROD/DEV/ARCHIVE hard filtering, reranking and the decision step."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from smart_orchestrator.embeddings import HashingEmbedder
from smart_orchestrator.environment import ARCHIVE, DEV, PROD, EnvironmentPolicy
from smart_orchestrator.hybrid_index import HybridIndex, IndexDoc
from smart_orchestrator.query_norm import default_glossary_path, load_glossary, normalized_text
from smart_orchestrator.ranking import CatalogRetriever
from smart_orchestrator.settings import OrchestratorSettings
from smart_orchestrator.vector_store import PineconeStore

SETTINGS = OrchestratorSettings(_env_file=None)
GLOSSARY = load_glossary(str(default_glossary_path()))
POLICY = EnvironmentPolicy.from_settings(SETTINGS)


def _items(*titles: str, workspace: str = "Embedded PBI Portal") -> list[dict]:
    return [
        {"title": t, "workspace_id": "ws", "workspace_name": workspace, "menu_path": workspace, "dataset_id": t.lower(), "source": "workspace"}
        for t in titles
    ]


def _retriever(embedder=None, settings=SETTINGS, remote=None) -> CatalogRetriever:
    return CatalogRetriever(settings, index=HybridIndex(embedder or HashingEmbedder(256), remote), policy=POLICY, glossary=GLOSSARY)


class FixedEmbedder:
    """Returns chosen vectors so tests control the semantic score exactly."""

    def __init__(self, rules: list[tuple[str, list[float]]], default: list[float]):
        self.name = "fixed"
        self.dimensions = len(default)
        self.rules = rules
        self.default = default

    async def embed(self, texts):
        out = []
        for text in texts:
            lowered = text.lower()
            out.append(next((v for needle, v in self.rules if needle in lowered), self.default))
        return out


# ---------------------------------------------------------------- classification
@pytest.mark.parametrize(
    "title,expected",
    [
        ("Injury", PROD),
        ("Injury_Data_Draft", DEV),
        ("Injury_Test", DEV),
        ("Injury_v2", DEV),
        ("InjuryV3", DEV),
        ("Injury Version 2", DEV),
        ("INJURY_REPORT_DRAFT", DEV),
        ("Injury UAT", DEV),
        ("Injury Backup", ARCHIVE),
        ("Old Injury", ARCHIVE),
        ("Injury (Deprecated)", ARCHIVE),
        ("Injury_archive_2024", ARCHIVE),
        # Legitimate names that only contain the letters of a marker.
        ("Contest Results", PROD),
        ("Latest Fleet Position", PROD),
        ("Oldham Vessel Register", PROD),
        ("Testimonials", PROD),
        ("Development Projects Budget", DEV),
        ("Draft Survey", PROD),
        ("Drug Test Results", PROD),
        ("Vessel Draft Readings", PROD),
        ("Fleet 2024", PROD),
    ],
)
def test_environment_classification_uses_whole_tokens(title, expected):
    assert POLICY.classify(title).environment == expected


def test_workspace_name_classifies_models_and_overrides_win():
    assert POLICY.classify("Injury", workspace_name="Fabric F64 - Testing ").environment == DEV
    assert POLICY.classify("Injury", workspace_name="Embedded PBI Portal").environment == PROD
    policy = EnvironmentPolicy.from_settings(OrchestratorSettings(_env_file=None, report_env_overrides=json.dumps({"ds-legacy-name": "PROD"})))
    assert policy.classify("Legacy Fleet", ids=["DS-LEGACY-NAME"]).environment == PROD


@pytest.mark.parametrize(
    "question,explicit",
    [
        ("Show injury reports", False),
        ("how many drug test results this month", False),
        ("what was the vessel draft on arrival", False),
        ("show the latest injury figures", False),
        ("Show injury draft report", True),
        ("use the test model for injuries", True),
        ("injury count from the v2 model", True),
        ("injuries in uat", True),
        ("archived injury report", True),
    ],
)
def test_only_explicit_requests_unlock_non_production(question, explicit):
    candidates = [("Injury_Data_Draft", DEV), ("Injury_Test", DEV), ("Injury_v2", DEV), ("Injury_Archive", ARCHIVE)]
    assert POLICY.requested(question, candidates).explicit is explicit


def test_weak_word_unlocks_when_it_names_a_candidate():
    request = POLICY.requested("injury draft figures", [("Injury_Data_Draft", DEV)])
    assert DEV in request.allowed


# ---------------------------------------------------------------- test case 1: PROD over a better-scoring draft
async def test_prod_model_wins_even_when_the_draft_has_the_higher_similarity():
    question = "Show injury reports"
    query_text = normalized_text(question, GLOSSARY)
    # The draft documents and the query share one vector; production gets an orthogonal one.
    embedder = FixedEmbedder([(query_text, [1.0, 0.0]), ("draft", [1.0, 0.0]), ("test", [1.0, 0.0]), ("v2", [1.0, 0.0])], [0.0, 1.0])
    decision = await _retriever(embedder).retrieve(question, _items("Injury", "Injury_Data_Draft", "Injury_Test", "Injury_v2"))
    assert decision.action == "select"
    assert decision.selected.title == "Injury" and decision.selected.environment == PROD
    assert decision.selected.vector == 0.0
    assert {c.title for c in decision.excluded} == {"Injury_Data_Draft", "Injury_Test", "Injury_v2"}
    assert all(c.environment == PROD for c in decision.options)


async def test_non_production_is_never_auto_selected_when_it_is_the_only_match():
    decision = await _retriever().retrieve("injury count", _items("Injury_Data_Draft", "Injury_Test", "Finance"))
    assert decision.action == "ask" and decision.reason == "only_nonprod"
    assert decision.selected is None
    assert {o["label"] for o in (c.option() for c in decision.options)} == {"Injury_Data_Draft (draft/test)", "Injury_Test (draft/test)"}


# ---------------------------------------------------------------- test case 2: drafts only when explicit
async def test_draft_is_used_only_when_the_user_asks_for_it():
    pool = _items("Injury", "Injury_Data_Draft", "Injury_Test", "Injury_v2")
    retriever = _retriever()
    plain = await retriever.retrieve("Show injury reports", pool)
    draft = await retriever.retrieve("Show injury draft report", pool)
    version = await retriever.retrieve("injury count from the v2 model", pool)
    assert plain.selected.title == "Injury"
    assert draft.selected.title == "Injury_Data_Draft" and draft.selected.environment == DEV
    assert version.selected.title == "Injury_v2"


async def test_authorized_override_unlocks_everything_but_still_prefers_production():
    decision = await _retriever().retrieve("Show injury reports", _items("Injury", "Injury_Data_Draft"), override=True)
    assert decision.request.override and decision.selected.title == "Injury"


async def test_explicit_request_without_a_matching_version_falls_back_to_production():
    decision = await _retriever().retrieve("Show injury draft report", _items("Injury", "Finance"))
    assert decision.selected.title == "Injury" and decision.request.explicit


async def test_business_phrase_with_a_marker_word_stays_in_production():
    decision = await _retriever().retrieve("draft survey results for last voyage", _items("Draft Survey", "Injury_Test"))
    assert decision.selected.title == "Draft Survey" and decision.selected.environment == PROD
    assert not decision.request.explicit


# ---------------------------------------------------------------- test case 3: hybrid keyword + semantic
async def test_keyword_channel_finds_rare_names_without_vectors():
    zero = FixedEmbedder([], [0.0, 0.0])
    decision = await _retriever(zero).retrieve("RightShip score for vessels", _items("RightShip", "Vessel Particulars", "Fleet Overview"))
    assert decision.selected.title == "RightShip"
    assert decision.selected.bm25 > 0 and decision.selected.vector == 0.0


async def test_semantic_channel_finds_models_that_share_no_words():
    question = "hull fouling impact last month"
    query_text = normalized_text(question, GLOSSARY)
    semantic = FixedEmbedder([(query_text, [1.0, 0.0]), ("vessel performance", [0.95, 0.31])], [0.0, 1.0])
    found = await _retriever(semantic).retrieve(question, _items("Vessel Performance", "Crew Matrix"))
    keyword_only = await _retriever(FixedEmbedder([], [0.0, 0.0])).retrieve(question, _items("Vessel Performance", "Crew Matrix"))
    assert keyword_only.action == "none"
    # A vector-only match is offered for confirmation, never auto-selected.
    assert found.action == "ask" and found.reason == "weak_match"
    picked = found.options[0]
    assert picked.title == "Vessel Performance" and picked.vector > 0.9 and picked.bm25 == 0.0


async def test_glossary_maps_business_terms_to_models():
    decision = await _retriever().retrieve("how many LTIs last month", _items("Injury", "Purchase Orders", "Fleet Emissions"))
    assert decision.selected.title == "Injury"
    decision = await _retriever().retrieve("EUA surrender status", _items("Fleet Emissions", "EU ETS Carbon Credits", "Injury"))
    assert decision.selected.title == "EU ETS Carbon Credits"


# ---------------------------------------------------------------- test case 4: low confidence asks
async def test_close_candidates_produce_a_question_not_a_guess():
    decision = await _retriever().retrieve("injury rate", _items("Injury Analysis", "Injury Statistics", "Finance"))
    assert decision.action == "ask" and decision.reason == "ambiguous"
    assert {c.title for c in decision.options} == {"Injury Analysis", "Injury Statistics"}


async def test_open_report_is_used_when_nothing_matches_confidently():
    open_item = {"title": "PO", "workspace_id": "ws-1", "dataset_id": "ds-1", "source": "open"}
    decision = await _retriever().retrieve("Compare spend by vendor", _items("Finance Overview"), open_item=open_item)
    assert decision.action == "select" and decision.reason == "open_report"


# ---------------------------------------------------------------- test case 9: concurrent index use
async def test_concurrent_sync_and_search_keep_bm25_and_vectors_consistent():
    index = HybridIndex(HashingEmbedder(128))

    def docs(version: int) -> list[IndexDoc]:
        return [
            IndexDoc(f"d{i}", f"model {i} injury v{version}", ("model", str(i), "injury", f"v{version}"), {"environment": PROD}, f"{i}:{version}")
            for i in range(30)
        ]

    async def search() -> int:
        hits = await index.search("injury", ["injury"], ids={f"d{i}" for i in range(30)}, environments=[PROD], top_k=50)
        return len(hits.bm25)

    results = await asyncio.gather(*[index.sync(docs(v % 3)) for v in range(15)], *[search() for _ in range(15)])
    assert len(index) == 30 and len(index._bm25) == 30 and len(index._local) == 30
    assert all(isinstance(r, int) and r in (0, 30) for r in results[15:])
    assert {index.digest_of(f"d{i}").split(":")[0] for i in range(30)} == {str(i) for i in range(30)}


async def test_concurrent_retrievals_return_their_own_decisions():
    retriever = _retriever()
    pool = _items("Injury", "Purchase Orders", "Fleet Emissions", "Injury_Test")
    questions = ["injury count", "purchase orders raised this week", "co2 emissions this year"] * 10
    decisions = await asyncio.gather(*(retriever.retrieve(q, pool) for q in questions))
    expected = {"injury count": "Injury", "purchase orders raised this week": "Purchase Orders", "co2 emissions this year": "Fleet Emissions"}
    assert [d.selected.title for d in decisions] == [expected[q] for q in questions]


# ---------------------------------------------------------------- Pinecone REST and sync
def _pinecone(handler) -> PineconeStore:
    return PineconeStore(api_key="pc-test", index_host="idx.svc.pinecone.io", namespace="ns", api_version="2025-04", timeout_s=2, transport=httpx.MockTransport(handler))


async def test_pinecone_store_sends_filters_and_keys():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/query":
            return httpx.Response(200, json={"matches": [{"id": "a", "score": 0.9}, {"id": "zzz", "score": 0.99}]})
        return httpx.Response(200, json={})

    store = _pinecone(handler)
    await store.upsert([("a", [0.1, 0.2], {"environment": PROD, "env_markers": [], "title": None})])
    hits = await store.query([0.1, 0.2], top_k=5, environments=[PROD], ids={"a"})
    await store.aclose()
    assert hits == {"a": 0.9}
    upsert, query = seen
    assert upsert.headers["Api-Key"] == "pc-test" and upsert.headers["X-Pinecone-API-Version"] == "2025-04"
    assert json.loads(upsert.content)["vectors"][0]["metadata"] == {"environment": PROD, "env_markers": []}
    body = json.loads(query.content)
    assert body["filter"] == {"$and": [{"environment": {"$in": [PROD]}}, {"doc_id": {"$in": ["a"]}}]}


async def test_index_uses_pinecone_only_after_it_is_in_sync_and_falls_back_on_errors():
    state = {"fail": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/query":
            if state["fail"]:
                return httpx.Response(503)
            return httpx.Response(200, json={"matches": [{"id": "d1", "score": 0.8}]})
        return httpx.Response(200, json={})

    index = HybridIndex(HashingEmbedder(64), _pinecone(handler))
    doc = IndexDoc("d1", "Injury", ("injury",), {"doc_id": "d1", "environment": PROD}, "x")
    await index.sync([doc])
    first = await index.search("injury", ["injury"], ids={"d1"}, environments=[PROD], top_k=3)
    await index.drain()
    second = await index.search("injury", ["injury"], ids={"d1"}, environments=[PROD], top_k=3)
    state["fail"] = True
    third = await index.search("injury", ["injury"], ids={"d1"}, environments=[PROD], top_k=3)
    await index.aclose()
    assert first.vector_store == "local"
    assert second.vector_store == "pinecone" and second.vector == {"d1": 0.8}
    assert third.vector_store == "local" and third.vector["d1"] > 0


def test_glossary_reads_plural_abbreviations():
    assert "requisition" in GLOSSARY.canonical_tokens("pending PRs by vessel")
    assert "gas" not in GLOSSARY.canonical_tokens("ga report")


def test_two_equally_plain_drafts_ask_instead_of_guessing():
    decision = asyncio.run(_retriever().retrieve("Show injury draft report", _items("Injury", "Injury_Data_Draft", "INJURY_REPORT_DRAFT")))
    assert decision.action == "ask"
    assert {c.title for c in decision.options} == {"Injury_Data_Draft", "INJURY_REPORT_DRAFT"}


def test_incident_question_prefers_portal_dashboard_over_bare_workspace_model():
    pool = [
        {
            "title": "Incident",
            "workspace_id": "ws",
            "workspace_name": "Fabric F64 - Testing",
            "menu_path": "Fabric F64 - Testing",
            "dataset_id": "ds-plain",
            "source": "workspace",
        },
        {
            "title": "Incident Dashboard",
            "workspace_id": "ws",
            "workspace_name": "Synergy App Central",
            "menu_path": "Safety Reporting > Incident",
            "dataset_id": "ds-dash",
            "report_id": "rep-incident",
            "source": "portal",
        },
    ]
    decision = asyncio.run(_retriever().retrieve("incidents for november 2026", pool))
    assert decision.action == "select"
    assert decision.selected is not None
    assert decision.selected.item["title"] == "Incident Dashboard"


def test_offline_evaluation_set_has_no_nonprod_leaks():
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    from retrieval_eval import DEFAULT_CASES, evaluate

    report = asyncio.run(evaluate(DEFAULT_CASES, default_glossary_path(), {}))
    assert report["nonprod_leaks"] == 0
    assert report["accuracy"] >= 0.9, [r for r in report["rows"] if not r["ok"]]
