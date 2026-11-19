"""Keyword index -> router -> one targeted DAX. Offline: fake embedder, in-memory store, fake Power BI."""

from __future__ import annotations

from typing import Any

import pytest

from pbi_semantiq_agent import dax_guard
from pbi_semantiq_agent.keyword_index import build_points, build_value_points, clean_keywords, extract_items
from pbi_semantiq_agent.keyword_router import KeywordRouter, _pick_route, build_dax, stub_model
from pbi_semantiq_agent.keyword_store import MemoryKeywordStore
from pbi_semantiq_agent.metadata import Column, Measure, SemanticModel, Table
from pbi_semantiq_agent.settings import SemantiqSettings
from tests.conftest import FakeLLM
from tests.test_semantiq_agent import FakePowerBI, _agent

DS = "6fe28c18-151c-4b05-a696-979f0906ddee"
WS = "0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd"
VOCAB = ["fuel", "bunker", "vessel", "imo", "handymax", "tanker", "sppl", "sub", "type", "count", "manager", "group", "tankers"]


class FakeEmbedder:
    """Bag-of-vocabulary vectors: deterministic, so the search results are predictable."""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [[1.0 if w in t.lower() else 0.0 for w in VOCAB] for t in texts]


def _hit(kind: str, *, score: float, table: str = "IMO_MASTER_LIST", name: str | None = None, column: str | None = None, value: str | None = None, keyword: str = "k", ds: str = DS) -> dict[str, Any]:
    return {
        "score": score,
        "object_kind": kind,
        "measure_name": name if kind == "measure" else None,
        "column_name": column,
        "table_name": table,
        "value": value,
        "keyword": keyword,
        "dataset_id": ds,
        "workspace_id": WS,
        "report_ids": ["r1"],
    }


def test_plain_question_routes_to_measure_with_dimension_and_value_filters():
    hits = [
        _hit("measure", score=0.9, name="Vessel Count", keyword="number of vessels"),
        _hit("value", score=0.85, column="SUB_TYPE", value="Handymax", keyword="handymax"),
        _hit("value", score=0.8, column="MANAGER_GROUP", value="SPPL", keyword="sppl"),
        _hit("column", score=0.6, column="VESSEL_TYPE", keyword="vessel type"),
    ]
    route = _pick_route(hits, None, 0.55)
    assert route and route.dataset_id == DS
    assert [m["name"] for m in route.measures] == ["Vessel Count"]
    assert {(f["column"], f["value"]) for f in route.filters} == {("SUB_TYPE", "Handymax"), ("MANAGER_GROUP", "SPPL")}
    assert [d["column"] for d in route.dimensions] == ["VESSEL_TYPE"]


def test_value_and_dimension_need_words_in_the_question():
    # Embedding similarity alone must not filter the owner 'SHANDONG ...' for 'handymax tankers'.
    hits = [
        _hit("measure", score=0.7, name="No of Vessels"),
        _hit("value", score=0.68, column="OWNER", value="SHANDONG SHIPPING TANKER CO., LIMITED", keyword="shandong shipping tanker co., limited"),
        _hit("column", score=0.67, column="HANDOVER_DATE", keyword="vessel handover date"),
        _hit("value", score=0.9, column="SUB_TYPE", value="Handymax", keyword="handymax"),
    ]
    route = _pick_route(hits, None, 0.55, "no of handymax tankers in sppl for oct 2026")
    assert route is not None
    assert [f["column"] for f in route.filters] == ["SUB_TYPE"]
    assert route.dimensions == []


def test_exact_value_words_are_found_even_when_similarity_is_low():
    from pbi_semantiq_agent.keyword_router import exact_value_hits

    values = [
        {"keyword": "handymax", "value": "HANDYMAX", "column_name": "VESSEL_SUB_CATEGORY", "table_name": "VESSEL_PARTICULARS_ACTIVE"},
        {"keyword": "handysize tanker", "value": "HANDYSIZE TANKER", "column_name": "VESSEL_SUB_CATEGORY", "table_name": "VESSEL_PARTICULARS_ACTIVE"},
        {"keyword": "sppl", "value": "SPPL", "column_name": "DOC", "table_name": "VESSEL_PARTICULARS_ACTIVE"},
    ]
    found = {v["keyword"] for v in exact_value_hits("no of handymax tankers in sppl for oct 2026", values)}
    assert found == {"handymax", "sppl"}  # 'handysize tanker' is not in the question


def test_one_filter_per_question_term_prefers_doc_and_sub_category():
    hits = [
        _hit("measure", score=0.9, name="No of Vessels"),
        {**_hit("value", score=1.0, column="SHIP_MANAGEMENT_COMPANY_NAME", value="Synergy Pacific", keyword="sppl"), "table_name": "Handed over"},
        {**_hit("value", score=1.0, column="DOC", value="SPPL", keyword="sppl"), "table_name": "VESSEL_PARTICULARS_ACTIVE"},
        {**_hit("value", score=1.0, column="VESSEL_SUB_CATEGORY", value="HANDYMAX", keyword="handymax"), "table_name": "VESSEL_PARTICULARS_ACTIVE"},
        {**_hit("value", score=1.0, column="VESSEL_SUBTYPE", value="HANDYMAX", keyword="handymax"), "table_name": "Vessel type and vessel sub type order"},
    ]
    route = _pick_route(hits, None, 0.55, "handymax tankers in sppl")
    assert route is not None
    assert [(f["column"], f["value"]) for f in route.filters] == [("DOC", "SPPL"), ("VESSEL_SUB_CATEGORY", "HANDYMAX")]


def test_low_confidence_returns_no_route():
    assert _pick_route([_hit("measure", score=0.4, name="Vessel Count")], None, 0.55) is None


def test_no_measure_means_no_route_so_the_full_pipeline_answers():
    assert _pick_route([_hit("value", score=0.9, column="SUB_TYPE", value="Handymax")], None, 0.55) is None


def test_caller_dataset_restricts_the_route():
    other = _hit("measure", score=0.99, name="Other", ds="other-ds")
    mine = _hit("measure", score=0.6, name="Vessel Count")
    route = _pick_route([other, mine], DS, 0.55)
    assert route and route.dataset_id == DS and [m["name"] for m in route.measures] == ["Vessel Count"]


def test_dax_is_one_targeted_evaluate_with_filters_and_passes_the_guard():
    route = _pick_route(
        [
            _hit("measure", score=0.9, name="Vessel Count"),
            _hit("value", score=0.85, column="SUB_TYPE", value="Handymax"),
            _hit("column", score=0.6, column="VESSEL_TYPE"),
        ],
        None,
        0.55,
    )
    dax = build_dax(route)
    assert dax.startswith("EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(")
    assert "'IMO_MASTER_LIST'[VESSEL_TYPE]" in dax and "[Vessel Count]" in dax and "\"Handymax\"" in dax
    verdict = dax_guard.validate(dax, stub_model(route), max_rows=500)
    assert verdict.ok, verdict.errors


def test_quotes_in_values_are_escaped():
    route = _pick_route([_hit("measure", score=0.9, name="Count"), _hit("value", score=0.9, column="OWNER", value='Acme "Ships"')], None, 0.55)
    assert '"Acme ""Ships"""' in build_dax(route)


def test_keyword_text_is_cleaned_and_capped():
    out = clean_keywords("Total Voyage Fuel", ["Bunker Consumption", "bunker consumption", "  ", "fuel burned"] + [f"kw{i}" for i in range(20)])
    assert out[0] == "total voyage fuel"
    assert out.count("bunker consumption") == 1
    assert len(out) <= 10


def test_extract_items_takes_measures_and_only_dimension_columns():
    model = SemanticModel(
        WS,
        DS,
        "m",
        [
            Table("Fleet", columns=[Column("IMO_NUMBER"), Column("Internal Key")], measures=[Measure("Vessel Count", "Fleet", "DISTINCTCOUNT(Fleet[IMO_NUMBER])")]),
            Table("Hidden", columns=[Column("SUB_TYPE", hidden=True)], measures=[]),
        ],
        [],
    )
    names = [(i["kind"], i["name"]) for i in extract_items(model)]
    assert ("measure", "Vessel Count") in names and ("column", "IMO_NUMBER") in names
    assert ("column", "Internal Key") not in names and ("column", "SUB_TYPE") not in names


def test_value_keywords_include_acronyms():
    rows = build_value_points(WS, DS, ["r1"], {("IMO_MASTER_LIST", "MANAGER_GROUP"): ["Synergy Offshore Marine Inc"]})
    keywords = {payload["keyword"] for _, _, payload in rows}
    assert "synergy offshore marine inc" in keywords and "somi" in keywords
    assert all(p["object_kind"] == "value" and p["column_name"] == "MANAGER_GROUP" for _, _, p in rows)


def test_point_keys_are_stable_so_reindexing_overwrites():
    items = [{"kind": "measure", "table": "T", "name": "M", "description": "", "format": None}]
    a = build_points(WS, DS, ["r"], items, [["m", "x"]])
    b = build_points(WS, DS, ["r"], items, [["m", "x"]])
    assert [k for k, _, _ in a] == [k for k, _, _ in b]


async def test_store_search_filters_by_dataset_and_threshold_and_refresh_replaces():
    store = MemoryKeywordStore()
    emb = FakeEmbedder()
    rows = build_points(WS, DS, ["r"], [{"kind": "measure", "table": "F", "name": "Fuel Total", "description": "", "format": None}], [["bunker consumption"]])
    vectors = await emb.embed([k for _, k, _ in rows])
    await store.upsert([(key, vec, p) for (key, _, p), vec in zip(rows, vectors)])
    hits = await store.search((await emb.embed(["bunker"]))[0], top_k=5, dataset_id=DS, threshold=0.5)
    assert hits and hits[0]["measure_name"] == "Fuel Total"
    assert await store.search((await emb.embed(["bunker"]))[0], top_k=5, dataset_id="other", threshold=0.5) == []
    await store.delete_dataset(DS)
    assert await store.search((await emb.embed(["bunker"]))[0], top_k=5, dataset_id=DS, threshold=0.5) == []


async def test_agent_answers_from_the_keyword_index_without_reading_the_schema(monkeypatch):
    settings = SemantiqSettings(_env_file=None, keyword_router_min_score=0.3, qdrant_url="http://q", embedding_model="e")
    store = MemoryKeywordStore()
    emb = FakeEmbedder()
    items = [{"kind": "measure", "table": "IMO_MASTER_LIST", "name": "Vessel Count", "description": "", "format": "#,0"}]
    kw_rows = build_points(WS, DS, ["r1"], items, [["number of vessels"]])
    kw_rows += build_value_points(WS, DS, ["r1"], {("IMO_MASTER_LIST", "SUB_TYPE"): ["Handymax"]})
    vecs = await emb.embed([k for _, k, _ in kw_rows])
    await store.upsert([(key, vec, p) for (key, _, p), vec in zip(kw_rows, vecs)])

    agent, client = _agent(None, FakeLLM())
    agent.settings = settings
    agent._kw_router = KeywordRouter(settings, store, emb)  # type: ignore[assignment]
    loads = {"n": 0}

    async def no_schema(*_a, **_k):
        loads["n"] += 1
        raise AssertionError("the schema must not be read on the keyword path")

    agent.get_model = no_schema  # type: ignore[method-assign]
    client.rows = [{"IMO_MASTER_LIST[SUB_TYPE]": "Handymax", "Vessel Count": 42}]
    client.columns = ["IMO_MASTER_LIST[SUB_TYPE]", "Vessel Count"]
    result = await agent.answer("number of vessels handymax", WS, DS, "u@x.com")
    assert result["status"] == "ok" and result["route"]["dataset_id"] == DS
    assert "Handymax" in result["executed_dax"] and loads["n"] == 0


async def test_graph_reranks_close_measures_with_the_llm_and_runs_one_dax(monkeypatch):
    from pbi_semantiq_agent.agent import MeasurePick
    from pbi_semantiq_agent.keyword_router import measure_options

    settings = SemantiqSettings(_env_file=None, keyword_router_min_score=0.3, qdrant_url="http://q", embedding_model="e")
    store = MemoryKeywordStore()
    emb = FakeEmbedder()
    items = [
        {"kind": "measure", "table": "F", "name": "Vessel Count", "description": "count of vessels", "format": None},
        {"kind": "measure", "table": "F", "name": "Vessel Fleet Size", "description": "fleet size", "format": None},
    ]
    rows = build_points(WS, DS, ["r1"], items, [["number of vessels"], ["number of vessels"]])
    vecs = await emb.embed([k for _, k, _ in rows])
    await store.upsert([(key, vec, p) for (key, _, p), vec in zip(rows, vecs)])
    hits = await store.search((await emb.embed(["number of vessels"]))[0], top_k=10, dataset_id=DS, threshold=0.1)
    route = _pick_route(hits, DS, 0.3, "number of vessels")
    options = measure_options(route, hits)
    assert {o["name"] for o in options} == {"Vessel Count", "Vessel Fleet Size"}

    llm = FakeLLM({"MeasurePick": [MeasurePick(measure="Vessel Fleet Size")]})
    agent, client = _agent(None, llm)
    agent.settings = settings
    agent._kw_router = KeywordRouter(settings, store, emb)  # type: ignore[assignment]
    client.rows = [{"Vessel Fleet Size": 7}]
    client.columns = ["Vessel Fleet Size"]
    result = await agent.answer("number of vessels", WS, DS, "u@x.com")
    assert result["status"] == "ok"
    assert result["route"]["measures"] == ["Vessel Fleet Size"]
    assert [name for name, _ in llm.calls] == ["MeasurePick"]  # the LLM was asked once, to re-rank


async def test_no_confident_keyword_match_falls_back_to_the_full_pipeline(model):
    from tests.test_semantiq_agent import GOOD

    settings = SemantiqSettings(_env_file=None, keyword_router_min_score=0.9, qdrant_url="http://q", embedding_model="e")
    agent, _client = _agent(model, FakeLLM({"DaxPlan": [GOOD]}))
    agent.settings = settings
    agent._kw_router = KeywordRouter(settings, MemoryKeywordStore(), FakeEmbedder())  # type: ignore[assignment]

    result = await agent.answer("spend by vendor", WS, DS, "u@x.com")
    assert result["status"] == "ok" and "route" not in result
