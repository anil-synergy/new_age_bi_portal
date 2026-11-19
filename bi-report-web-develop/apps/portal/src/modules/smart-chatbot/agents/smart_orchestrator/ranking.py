"""Catalog retrieval pipeline: environment filter -> hybrid search -> rerank -> decision.

1. Every item gets an environment at ingestion (environment.py). Items outside the
   environments the user asked for are removed before any score is computed.
2. Hybrid search (hybrid_index.py) scores only the remaining items: vector similarity and BM25.
3. Rerank adds title F1 and menu-path matches against the question's subject words.
4. Decision:
   - the plain model (every title word is in the question) wins, portal/menu reports over bare workspace names;
   - otherwise the top item is selected only when its score and its margin over the next
     item pass the configured thresholds and it matches lexically;
   - otherwise the report the user has open is used;
   - otherwise the user is asked to choose.
   Filtered DEV/ARCHIVE items are never selected. They are offered only as labelled options.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from smart_common.keywords import stem
from smart_common.logging import log

from .embeddings import Embedder
from .environment import ARCHIVE, DEV, PROD, Classification, EnvironmentPolicy, EnvironmentRequest, name_tokens
from .hybrid_index import HybridIndex, SearchHits
from .debug_trace import debug_log
from .ingestion import ModelMetadataIndexer, build_doc, doc_id, item_key
from .metadata_retrieval import metadata_match_keys
from .ontology_ranking import catalog_hard_veto, catalog_ontology_adjustment, strong_ontology_catalog_match, vessel_register_dataset_id
from .query_norm import (
    AGGREGATE_WORDS,
    GENERIC_TITLE_WORDS,
    STOP,
    Glossary,
    content_tokens,
    normalize_report_label,
    normalized_text,
    normalized_title_tokens,
    subject_tokens,
)

logger = logging.getLogger(__name__)

ENV_LABEL = {DEV: "draft/test", ARCHIVE: "archived"}


@dataclass
class Candidate:
    item: dict[str, Any]
    key: str
    doc: str
    environment: str
    markers: tuple[str, ...]
    title_core: set[str]
    title_joined: set[str] = field(default_factory=set)
    vector: float = 0.0
    bm25: float = 0.0
    bm25_norm: float = 0.0
    hybrid: float = 0.0
    title_f1: float = 0.0
    menu: float = 0.0
    marker: float = 0.0
    metadata: float = 0.0
    score: float = 0.0
    coverage: int = 0
    plain: bool = False
    core_hit: bool = False
    relevant: bool = False

    @property
    def title(self) -> str:
        return str(self.item.get("title") or self.item.get("report_name") or "semantic model")

    @property
    def lexical(self) -> bool:
        return self.core_hit or self.menu > 0 or self.bm25 > 0

    def option(self) -> dict[str, Any]:
        label = self.title if self.environment == PROD else f"{self.title} ({ENV_LABEL.get(self.environment, self.environment.lower())})"
        return {
            "label": label,
            "title": self.title,
            "environment": self.environment,
            "workspace_id": self.item.get("workspace_id"),
            "dataset_id": self.item.get("dataset_id"),
            "report_id": self.item.get("report_id"),
            "source": self.item.get("source"),
            "score": round(self.score, 3),
        }

    def trace(self) -> dict[str, Any]:
        return {
            "title": self.title[:80],
            "env": self.environment,
            "score": round(self.score, 3),
            "vector": round(self.vector, 3),
            "bm25": round(self.bm25_norm, 3),
            "title_f1": round(self.title_f1, 3),
            "plain": self.plain,
        }


@dataclass
class Decision:
    action: Literal["select", "ask", "none"]
    reason: str
    request: EnvironmentRequest
    selected: Candidate | None = None
    retry: list[Candidate] = field(default_factory=list)
    options: list[Candidate] = field(default_factory=list)
    alternatives: list[Candidate] = field(default_factory=list)
    excluded: list[Candidate] = field(default_factory=list)
    confidence: float = 0.0
    timings: dict[str, float] = field(default_factory=dict)
    vector_store: str = "none"
    # Relevant, environment-eligible candidates by score (input to the optional LLM re-rank step).
    ranked: list[Candidate] = field(default_factory=list)
    llm: dict[str, Any] | None = None

    def trace(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "reason": self.reason,
            "selected": self.selected.trace() if self.selected else None,
            "options": [c.trace() for c in self.options][:5],
            "excluded": len(self.excluded),
            "allowed_env": sorted(self.request.allowed),
            "confidence": round(self.confidence, 3),
            **({"llm_rerank": self.llm} if self.llm else {}),
        }


def _f1(question: set[str], title: set[str]) -> float:
    overlap = question & title
    if not overlap:
        return 0.0
    precision = len(overlap) / len(title)
    recall = len(overlap) / len(question)
    return 2 * precision * recall / (precision + recall)


class CatalogRetriever:
    def __init__(
        self,
        settings,
        *,
        index: HybridIndex,
        policy: EnvironmentPolicy,
        glossary: Glossary,
        metadata: ModelMetadataIndexer | None = None,
    ):
        self.settings = settings
        self.index = index
        self.policy = policy
        self.glossary = glossary
        self.metadata = metadata
        self._env_words = {stem(t) for t in policy.dev_terms | policy.archive_terms}

    @property
    def embedder(self) -> Embedder:
        return self.index.embedder

    def classify(self, item: dict[str, Any]) -> Classification:
        return self.policy.classify_item(item)

    def _core(self, text: str) -> set[str]:
        tokens = name_tokens(normalize_report_label(text))
        out = {
            stem(t)
            for t in tokens
            if t not in GENERIC_TITLE_WORDS and len(t) > 1 and not t.isdigit() and stem(t) not in self._env_words and not (t.startswith("v") and t[1:].isdigit())
        }
        return out | normalized_title_tokens(text) | self.glossary.canonical_tokens(text)

    def _joined(self, text: str) -> set[str]:
        """'RightShip' as one word, for questions that type it that way."""
        chunks = [c.lower() for c in _CHUNK.split(normalize_report_label(text) or "") if c and c.isalpha()]
        out = {stem(c) for c in chunks if c not in GENERIC_TITLE_WORDS and stem(c) not in self._env_words}
        return out | self.glossary.canonical_tokens(text)

    def _subject(self, question: str) -> set[str]:
        tokens = subject_tokens(question, self.glossary)
        split = {stem(t) for t in name_tokens(question) if len(t) > 1 and not t.isdigit() and t not in STOP and t not in GENERIC_TITLE_WORDS}
        return {t for t in tokens | (split & _camel_parts(question)) if t not in AGGREGATE_WORDS}

    def _candidates(self, items: list[dict[str, Any]]) -> list[Candidate]:
        out: list[Candidate] = []
        for item in items:
            key = item_key(item)
            if not key:
                continue
            env = self.classify(item)
            title = str(item.get("title") or "")
            out.append(Candidate(item, key, doc_id(item), env.environment, env.markers, self._core(title), self._joined(title)))
        return out

    async def retrieve(
        self,
        question: str,
        items: list[dict[str, Any]],
        *,
        override: bool = False,
        open_item: dict[str, Any] | None = None,
        metadata_hits: list[dict[str, Any]] | None = None,
        learned_hints: dict[str, Any] | None = None,
    ) -> Decision:
        started = time.perf_counter()
        metadata_keys = metadata_match_keys(metadata_hits or [])
        candidates = self._candidates(items)
        request = self.policy.requested(question, [(c.title, c.environment) for c in candidates], override=override)
        # Fast path: a plain vessel / IMO question goes straight to the vessel register. No index sync, no
        # hybrid search, no scoring of the whole pool (that cost 13-60 s per question before).
        if not request.explicit:
            register_id = vessel_register_dataset_id(question)
            hit = (
                next(
                    (c for c in candidates if c.environment in request.allowed and str(c.item.get("dataset_id") or "").lower() == register_id),
                    None,
                )
                if register_id
                else None
            )
            if hit is not None:
                elapsed = round((time.perf_counter() - started) * 1000, 1)
                decision = Decision(
                    "select",
                    "vessel_register",
                    request,
                    selected=hit,
                    confidence=1.0,
                    ranked=[hit],
                    timings={"candidates_ms": elapsed, "retrieval_ms": elapsed},
                    vector_store="skipped",
                )
                log(logger, logging.INFO, "catalog_retrieval", candidates=len(candidates), reason="vessel_register", **decision.timings)
                return decision
        docs = [
            build_doc(c.item, Classification(c.environment, c.markers), self.glossary, self.metadata.text_for(c.key) if self.metadata else "")
            for c in candidates
        ]
        await self.index.sync(docs)
        synced = time.perf_counter()

        eligible = [c for c in candidates if c.environment in request.allowed]
        filtered = [c for c in candidates if c.environment not in request.allowed]
        subject = self._subject(question)
        subject_core = {t for t in subject if t not in self._env_words} or subject
        hits = await self.index.search(
            normalized_text(question, self.glossary),
            content_tokens(question) + sorted(self.glossary.canonical_tokens(question)),
            ids={c.doc for c in eligible},
            environments=sorted(request.allowed),
            top_k=max(self.settings.retrieval_top_k, 1),
        )
        self._score(eligible, hits, subject_core, request, metadata_keys, question, learned_hints)
        self._score(filtered, SearchHits({}, {}, "none", 0.0), subject_core, request, metadata_keys, question, learned_hints)
        decision = self._decide(_best_per_key(eligible), _best_per_key(filtered), request, open_item, question)
        decision.vector_store = hits.vector_store
        decision.timings = {
            "index_sync_ms": round((synced - started) * 1000, 1),
            "search_ms": hits.ms,
            "retrieval_ms": round((time.perf_counter() - started) * 1000, 1),
        }
        debug_log(
            hypothesis_id="A",
            location="ranking.py:retrieve",
            message="retrieval decision",
            data={
                "question": question[:120],
                "action": decision.action,
                "reason": decision.reason,
                "metadata_hits": len(metadata_hits or []),
                "top": [
                    {
                        "title": c.title[:48],
                        "score": round(c.score, 3),
                        "metadata": round(c.metadata, 3),
                        "title_f1": round(c.title_f1, 3),
                    }
                    for c in sorted(eligible, key=lambda x: -x.score)[:5]
                ],
            },
        )
        log(
            logger,
            logging.INFO,
            "catalog_retrieval",
            candidates=len(candidates),
            eligible=len(eligible),
            env_filtered=len(filtered),
            vector_store=hits.vector_store,
            **decision.trace(),
            **decision.timings,
        )
        return decision

    def _metadata_boost(self, item: dict[str, Any], keys: dict[str, float]) -> float:
        if not keys:
            return 0.0
        boost = 0.0
        for field in ("report_id", "dataset_id", "portal_id"):
            value = str(item.get(field) or "").strip().lower()
            if value:
                boost = max(boost, keys.get(f"{field}:{value}", 0.0))
        title = normalize_report_label(str(item.get("title") or item.get("report_name") or ""))
        if title:
            boost = max(boost, keys.get(f"title:{title}", 0.0))
        menu_blob = normalize_report_label(" ".join(str(item.get(k) or "") for k in ("menu_path", "category_name", "description")))
        for token in menu_blob.split():
            boost = max(boost, keys.get(f"title:{token}", 0.0) * 0.2)
        return min(boost, 1.0)

    def _score(
        self,
        cands: list[Candidate],
        hits: SearchHits,
        subject: set[str],
        request: EnvironmentRequest,
        metadata_keys: dict[str, float] | None = None,
        question: str = "",
        learned_hints: dict[str, Any] | None = None,
    ) -> None:
        s = self.settings
        top_bm25 = max(hits.bm25.values(), default=0.0)
        requested_markers = set(request.markers)
        for c in cands:
            c.vector = max(0.0, hits.vector.get(c.doc, 0.0))
            c.bm25 = hits.bm25.get(c.doc, 0.0)
            c.bm25_norm = c.bm25 / top_bm25 if top_bm25 else 0.0
            c.hybrid = s.retrieval_vector_weight * c.vector + s.retrieval_bm25_weight * c.bm25_norm
            c.title_f1 = max(_f1(subject, c.title_core), _f1(subject, c.title_joined)) if subject and c.title_core else 0.0
            menu_tokens = self._core(" ".join(str(c.item.get(k) or "") for k in ("menu_path", "category_name", "description")))
            c.menu = len(subject & menu_tokens) / len(subject) if subject else 0.0
            if c.environment == PROD:
                c.marker = 0.0
            elif set(c.markers) & requested_markers:
                c.marker = 1.0
            else:
                c.marker = 0.5 if c.environment in request.requested_envs else 0.0
            c.metadata = self._metadata_boost(c.item, metadata_keys or {})
            ontology = catalog_ontology_adjustment(question, c.item, learned_hints=learned_hints)
            c.score = (
                s.rerank_hybrid_weight * c.hybrid
                + s.rerank_title_weight * c.title_f1
                + s.rerank_menu_weight * c.menu
                + s.rerank_marker_weight * c.marker
                + 0.25 * c.metadata
                + ontology
            )
            c.coverage = max(len(c.title_core & subject), len(c.title_joined & subject))
            c.core_hit = c.coverage > 0
            c.plain = bool(c.title_core) and (c.title_core <= subject or (bool(c.title_joined) and c.title_joined <= subject))
            semantic = c.vector >= s.retrieval_vector_floor
            keyword = c.bm25 > 0 and c.bm25_norm >= 0.5
            veto = catalog_hard_veto(question, c.item)
            c.relevant = (
                not veto
                and (c.core_hit or c.menu > 0 or keyword or semantic)
                and c.score >= s.retrieval_min_relevance
            )
            if veto:
                c.score = min(c.score, 0.05)

    def _decide(
        self,
        eligible: list[Candidate],
        filtered: list[Candidate],
        request: EnvironmentRequest,
        open_item: dict[str, Any] | None,
        question: str,
    ) -> Decision:
        s = self.settings
        relevant = sorted((c for c in eligible if c.relevant), key=lambda c: -c.score)
        excluded = sorted((c for c in filtered if c.core_hit), key=lambda c: (-c.coverage, -c.title_f1, len(c.title)))
        max_options = max(2, s.retrieval_max_options)

        def done(action, reason, selected=None, retry=(), options=(), confidence=0.0) -> Decision:
            chosen = {c.key for c in [selected, *retry] if c}
            alternatives = [c for c in relevant if c.key not in chosen] + [c for c in excluded if c.key not in chosen]
            return Decision(
                action,
                reason,
                request,
                selected,
                list(retry),
                list(options),
                alternatives[:max_options],
                excluded,
                confidence,
                ranked=list(relevant[: max(2, s.llm_rerank_top_k)]),
            )

        if request.explicit:
            wanted = request.requested_envs
            preferred = [c for c in relevant if c.environment in wanted and c.core_hit]
            if preferred:
                preferred.sort(key=lambda c: (-c.marker, -int(c.plain), -c.coverage, -c.score, len(c.title)))
                top = preferred[0]
                tied = [
                    c for c in preferred[1:]
                    if (c.marker, c.plain, c.coverage) == (top.marker, top.plain, top.coverage)
                    and (top.plain or abs(c.score - top.score) < s.retrieval_select_margin)
                ]
                if tied:
                    return done("ask", "several_requested_versions", options=[top, *tied][:max_options], confidence=top.score)
                return done("select", "requested_environment", top, confidence=max(top.score, 0.9))
            relevant = [c for c in relevant if c.environment == PROD]

        # Plain vessel / IMO questions (no module named) go to the vessel register, even when the words
        # do not overlap its title: that report is the dump of every IMO and its attributes.
        if not request.explicit:
            register_id = vessel_register_dataset_id(question)
            hit = next((c for c in eligible if str(c.item.get("dataset_id") or "").lower() == register_id), None) if register_id else None
            if hit is not None:
                return done("select", "vessel_register", hit, confidence=1.0)

        plain = [c for c in relevant if c.plain]
        if plain:
            best = max(c.coverage for c in plain)
            tied = [c for c in plain if c.coverage == best]
            chosen = sorted(
                tied,
                key=lambda c: (
                    _source_rank(c),
                    -int(bool(c.item.get("report_id"))),
                    -c.metadata,
                    -c.score,
                    len(c.title),
                ),
            )
            return done("select", "plain_model", chosen[0], chosen[1:], confidence=1.0)

        if relevant:
            top = relevant[0]
            margin = top.score - (relevant[1].score if len(relevant) > 1 else 0.0)
            if top.score >= s.retrieval_select_threshold and margin >= s.retrieval_select_margin and top.lexical:
                return done("select", "confident_match", top, confidence=top.score)
        if open_item:
            if relevant:
                top = relevant[0]
                if strong_ontology_catalog_match(question, top.score, top.metadata):
                    return done("select", "ontology_catalog_match", top, confidence=top.score)
                if (
                    top.score >= s.retrieval_select_threshold
                    and top.metadata >= 0.4
                    and (top.lexical or top.metadata >= 0.55)
                ):
                    return done("select", "confident_match", top, confidence=top.score)
            return Decision("select", "open_report", request, _open_candidate(open_item), [], [], relevant[:max_options] + excluded[:max_options], excluded, 1.0)
        if len(relevant) >= 2:
            return done("ask", "ambiguous", options=relevant[:max_options], confidence=relevant[0].score)
        if len(relevant) == 1:
            top = relevant[0]
            if top.lexical:
                return done("select", "single_match", top, confidence=top.score)
            return done("ask", "weak_match", options=[top], confidence=top.score)
        if excluded:
            return done("ask", "only_nonprod", options=excluded[:max_options], confidence=0.0)
        return done("none", "no_match")


_CHUNK = re.compile(r"[^A-Za-z0-9]+")
_CAMEL_WORD = re.compile(r"\b[A-Za-z]*[a-z][A-Z][A-Za-z]*\b")


def _camel_parts(text: str) -> set[str]:
    """Stems of the parts of CamelCase words the user typed ('RightShip' -> right, ship)."""
    return {stem(t) for word in _CAMEL_WORD.findall(text or "") for t in name_tokens(word)}


def _source_rank(c: Candidate) -> int:
    return {"portal": 0, "workspace": 1}.get(str(c.item.get("source") or "workspace"), 2)


def _best_per_key(cands: list[Candidate]) -> list[Candidate]:
    best: dict[str, Candidate] = {}
    for c in cands:
        current = best.get(c.key)
        if current is None or (c.score, -_source_rank(c)) > (current.score, -_source_rank(current)):
            best[c.key] = c
    return list(best.values())


def _open_candidate(item: dict[str, Any]) -> Candidate:
    return Candidate(item, item_key(item), doc_id(item), PROD, (), set(), score=1.0, relevant=True)
