"""SMART supervisor graph (LangGraph).

classify -> (greeting | out_of_scope | open_report | retrieve_context | resume)
analytical: retrieve_context (menu + workspace discovery -> environment filter -> hybrid search
            -> rerank -> decision) -> cache_lookup -> query (SemantIQ) -> stats -> visualize
            (N.O.V.A.) -> summarize -> verify -> respond (cache store)
schema:     retrieve_context -> schema (SemantIQ search) -> respond
resume:     a reply to a pending question (which model? monthly or vessel-wise?) continues the
            saved workflow with its original question, model and context.

Conversation memory is a checkpointer keyed by "<email>:<conversation_id>", so a user can
never load another user's thread. Turns in one thread run one at a time.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from smart_common.grounding import Confidence, allowed_values_from_rows, check_grounding, numeric_values
from smart_common.llm import LLMClient, LLMUnavailable
from smart_common.logging import log

from .analytics import Analytics
from .catalog_match import pick_report
from .conversation import Pending, cancelled, expired, looks_like_answer, match_option, merge_reply, new_pending
from .instruction_parser import parse_user_message
from .learned_hints import LearnedHints, merge_hints
from .embeddings import build_embedder
from .environment import PROD, EnvironmentPolicy
from .debug_trace import debug_log
from .errors import REPORT_DATABASE_DOWN, SMART_DOWN, model_unreadable_message
from .metadata_retrieval import fetch_catalog_metadata_hints
from .hybrid_index import HybridIndex
from .ingestion import ModelMetadataIndexer, item_key
from .llm_rerank import llm_rerank, should_rerank
from .mcp_clients import AgentCallError, ToolCaller
from .query_norm import default_glossary_path, load_glossary, normalized_text, signature
from .ranking import ENV_LABEL, CatalogRetriever, Decision
from .retrieval import InventoryCache, authorize_workspace_items, enrich_menu_items, pool_for_user
from .semantic_cache import SemanticCache, security_scope
from .settings import OrchestratorSettings
from .stats import compute_stats, deterministic_summary, stat_cards
from .vector_store import build_remote_store

logger = logging.getLogger(__name__)

SEMANTIQ = "pbi_semantiq_agent"
NOVA = "pbi_nova_visual_generator"

CAPABILITIES = (
    "I'm SMART. I can answer questions about the data in your reports (SemantIQ writes and checks the DAX "
    "under your own row-level security), explain which tables, columns and measures exist, and build charts with "
    "N.O.V.A. You do not need to open a report first. Try: \"Top 5 vendors by spend this year\" or "
    "\"What measures are available for PO amount?\""
)
RESUME_PROMPT = (
    "SMART asked the user a clarifying question about a Power BI data request. Decide whether the user's reply "
    "answers that question. If it does, rewrite the original request into one standalone request that includes "
    "the answer. If the reply is a new, unrelated request, set answers_pending to false. Return JSON only."
)


@lru_cache
def _prompt(name: str) -> str:
    return (Path(__file__).parent / "prompts" / f"{name}.md").read_text(encoding="utf-8")


def _business_context() -> str:
    path = Path(__file__).resolve().parents[1] / "pbi_semantiq_agent" / "prompts" / "context.md"
    return path.read_text(encoding="utf-8")


def _keep_recent(current: list[dict[str, str]] | None, new: list[dict[str, str]] | None) -> list[dict[str, str]]:
    return ((current or []) + (new or []))[-12:]


class IntentResult(BaseModel):
    intent: Literal["data_question", "schema_question", "greeting", "out_of_scope", "open_report", "note"]
    wants_visual: bool = False
    preferred_visual: str | None = None
    standalone_question: str


class SummaryResult(BaseModel):
    summary: str
    highlights: list[str] = Field(default_factory=list)


class ResumeResult(BaseModel):
    answers_pending: bool
    merged_question: str = ""


class SmartState(TypedDict, total=False):
    history: Annotated[list[dict[str, str]], _keep_recent]
    question: str
    user_email: str
    request_id: str
    conversation_id: str
    context: dict[str, Any]
    intent: dict[str, Any]
    dataset: dict[str, Any] | None
    semantiq: dict[str, Any] | None
    stats: dict[str, Any] | None
    visual: dict[str, Any] | None
    summary: dict[str, Any] | None
    confidence: dict[str, Any] | None
    response: dict[str, Any]
    timings: dict[str, float]
    needs_discovery: bool
    retry_query: bool
    workspace_searched: bool
    failed_datasets: list[str]
    model_candidates: list[dict[str, Any]]
    model_options: list[dict[str, Any]]
    authorized_keys: list[str]
    scope: str
    retrieval: dict[str, Any] | None
    cache: dict[str, Any] | None
    outcome: str
    resumed: bool
    clarifications: int
    # Carried across turns on purpose: the workflow waiting for the user's answer.
    pending: Pending | None
    learned_hints: dict[str, Any] | None
    # Carried across turns: the last answered DAX on a model, for follow-up questions.
    last_turn: dict[str, Any] | None


def _emit(step: str, status: str, **detail: Any) -> None:
    try:
        writer = get_stream_writer()
    except RuntimeError:
        return
    writer({"step": step, "status": status, **detail})


def _emit_delta(text: str) -> None:
    if not text:
        return
    try:
        writer = get_stream_writer()
    except RuntimeError:
        return
    writer({"event": "delta", "text": text})


def _stream_text(text: str) -> None:
    for i in range(0, len(text or ""), 48):
        _emit_delta(text[i : i + 48])


def _memory_turns(state: SmartState) -> list[dict[str, str]]:
    history = list(state.get("history") or [])
    if history:
        return history
    raw = (state.get("context") or {}).get("memory") or []
    turns: list[dict[str, str]] = []
    if not isinstance(raw, list):
        return turns
    for turn in raw[-12:]:
        if not isinstance(turn, dict):
            continue
        role = turn.get("role")
        content = str(turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            turns.append({"role": role, "content": content[:800]})
    return turns


def _heuristic_preferred_visual(question: str) -> str | None:
    q = question.strip().lower()
    type_words = (
        ("donut", r"\b(donut|doughnut)\b"),
        ("map", r"\b(map|choropleth)\b"),
        ("geo-scatter", r"\b(geo\s*scatter|map\s*points?)\b"),
        ("geo-lines", r"\b(route|flow\s*map|geo\s*lines)\b"),
        ("funnel", r"\bfunnel\b"),
        ("gauge", r"\bgauge\b"),
        ("radar", r"\bradar\b"),
        ("sankey", r"\bsankey\b"),
        ("treemap", r"\btreemap\b"),
        ("scatter", r"\bscatter\b"),
        ("area", r"\barea\s*(chart|graph)\b"),
        ("stacked-bar", r"\bstacked\s*bar\b"),
        ("horizontal-bar", r"\bhorizontal\s*bar\b"),
    )
    for kind, pat in type_words:
        if re.search(pat, q):
            return kind
    if re.search(r"\b(pie|donut|doughnut)\b", q):
        return "pie"
    if re.search(r"\bline\s*(chart|graph)\b", q) or (re.search(r"\bline\b", q) and re.search(r"\b(chart|graph)\b", q)):
        return "line"
    if re.search(r"\bbar\s*(chart|graph)\b", q) or (re.search(r"\bbar\b", q) and re.search(r"\b(chart|graph)\b", q)):
        return "bar"
    if re.search(r"\bkpi\b", q):
        return "kpi"
    if re.search(r"\b(matrix|pivot|crosstab)\b", q):
        return "matrix"
    if re.search(
        r"\bas\s+a\s+table\b|\btable\s+visual\b|\bgive\s+(me\s+)?(a\s+)?table\b|\bshow\s+(me\s+)?(the\s+)?table\b",
        q,
    ):
        return "table"
    return None


_NOTE_COMMAND = re.compile(
    r"^\s*(?:please\s+)?(?:(?:make|create|add|take|write|start|new)\s+(?:a\s+|an\s+|my\s+)?notes?|notes?\s*[:\-])\s*(?P<rest>.*)$",
    re.IGNORECASE | re.DOTALL,
)
_NOTE_TITLED = re.compile(r"^(?:titled|title|called|named)\s*[:\-]?\s*[\"']?(?P<title>[^\"'\n:]{1,80}?)[\"']?\s*(?:[:\-]\s*|\n\s*)(?P<body>.*)$", re.IGNORECASE | re.DOTALL)


def note_request(question: str) -> dict[str, str] | None:
    """'make a note titled Fleet: check IMO list' -> {title, text}. None when the message is not a note command."""
    match = _NOTE_COMMAND.match(question or "")
    if not match:
        return None
    rest = match.group("rest").strip()
    titled = _NOTE_TITLED.match(rest)
    if titled:
        return {"title": titled.group("title").strip(), "text": titled.group("body").strip()}
    if ":" in rest and len(rest.split(":", 1)[0]) <= 80:
        head, body = rest.split(":", 1)
        return {"title": head.strip() or "Note", "text": body.strip()}
    words = rest.split()
    return {"title": " ".join(words[:6]) or "Note", "text": rest}


def _heuristic_intent(question: str) -> IntentResult:
    q = question.strip().lower()
    if re.fullmatch(r"(hi|hello|hey|thanks|thank you|help|what can you do\??)[.! ]*", q):
        return IntentResult(intent="greeting", standalone_question=question)
    analytical = re.search(r"\b(total|count|trend|compare|amount|number|how many|sum|average|top \d+)\b", q)
    if re.search(r"\b(open|launch|go to|navigate to|take me to)\b", q):
        return IntentResult(intent="open_report", standalone_question=question)
    if not analytical and re.search(r"\b(show|display)\b", q) and re.search(r"\b(report|dashboard)\b", q):
        return IntentResult(intent="open_report", standalone_question=question)
    if re.search(r"\b(which|what) (tables|columns|measures|fields|metrics)\b|\bavailable\b|\bmeaning of\b|\bdefine\b", q):
        return IntentResult(intent="schema_question", standalone_question=question)
    preferred = _heuristic_preferred_visual(question)
    wants = bool(
        re.search(r"\b(chart|graph|plot|visual|trend|compare|top \d+|breakdown|by month|by year)\b", q)
        or preferred is not None
    )
    return IntentResult(intent="data_question", wants_visual=wants, preferred_visual=preferred, standalone_question=question)


class SmartGraph:
    def __init__(self, settings: OrchestratorSettings, agents: ToolCaller, llm: LLMClient, checkpointer=None, analytics: Analytics | None = None):
        self.settings = settings
        self.agents = agents
        self.llm = llm
        self._inventory = InventoryCache(settings.workspace_inventory_ttl_s)
        self.glossary = load_glossary(str(settings.glossary_path or default_glossary_path()))
        self.policy = EnvironmentPolicy.from_settings(settings)
        self.embedder = build_embedder(settings)
        self.index = HybridIndex(self.embedder, build_remote_store(settings), prune_after_s=max(settings.index_metadata_ttl_s * 24, 3600.0))
        self.metadata = ModelMetadataIndexer(
            agents,
            enabled=settings.index_model_metadata,
            concurrency=settings.index_metadata_concurrency,
            max_models=settings.index_metadata_max_models,
            ttl_s=settings.index_metadata_ttl_s,
        )
        self.retriever = CatalogRetriever(settings, index=self.index, policy=self.policy, glossary=self.glossary, metadata=self.metadata)
        self.cache = SemanticCache(
            self.embedder,
            enabled=settings.semantic_cache_enabled,
            ttl_s=settings.semantic_cache_ttl_s,
            unknown_ttl_s=settings.semantic_cache_unknown_freshness_ttl_s,
            similarity=settings.semantic_cache_similarity,
            max_entries=settings.semantic_cache_max_entries,
        )
        self.analytics = analytics or Analytics(settings.analytics_db_path, repeat_similarity=settings.repeat_similarity, repeat_window=settings.repeat_window)
        self._freshness: dict[str, tuple[str | None, float]] = {}
        self._thread_locks: dict[str, list[Any]] = {}
        self.graph = self._build(checkpointer or MemorySaver())

    def use_checkpointer(self, checkpointer) -> None:
        self.graph = self._build(checkpointer)

    async def aclose(self) -> None:
        await self.metadata.aclose()
        await self.index.aclose()

    # ------------------------------------------------------------ nodes
    async def _capture_learning(self, state: SmartState) -> dict[str, Any]:
        ctx = state.get("context") or {}
        catalog = ctx.get("catalog") if isinstance(ctx.get("catalog"), list) else []
        events = parse_user_message(state["question"], catalog=catalog)
        if not events:
            return {}
        learned = merge_hints(state.get("learned_hints"), events)
        for ev in events:
            await self.analytics.record_correction(
                user_email=state["user_email"],
                source=str(ev.get("source") or "instruction_parse"),
                question=state["question"],
                conversation=state.get("conversation_id"),
                phrase=ev.get("phrase"),
                concept_id=ev.get("concept_id"),
                chosen_title=ev.get("chosen_title"),
                chosen_dataset_id=ev.get("chosen_dataset_id"),
                detail=ev,
            )
        return {"learned_hints": learned}

    async def classify(self, state: SmartState) -> SmartState:
        _emit("classify", "running", label="Understanding your question")
        question = state["question"]
        pending = state.get("pending")
        if pending and not expired(pending, self.settings.pending_ttl_s):
            if cancelled(question):
                return {"pending": None, "intent": {"intent": "greeting", "standalone_question": question}, "outcome": "info", "response": self._message("OK, I have dropped that request.", kind="info", confidence=1.0)}
            resumed = await self._resume(state, pending, question)
            if resumed is not None:
                return resumed
        learning_patch = await self._capture_learning(state)
        history = _memory_turns(state)
        result: IntentResult
        if self.llm.configured:
            convo = "\n".join(f"{m['role']}: {m['content'][:400]}" for m in history[-self.settings.history_turns * 2 :])
            try:
                result = await self.llm.complete_json(_prompt("intent") + "\n\nBUSINESS CONTEXT:\n" + _business_context(), f"HISTORY:\n{convo or '(none)'}\n\nLATEST:\n{question}", IntentResult, max_tokens=400)
            except LLMUnavailable:
                result = _heuristic_intent(question)
        else:
            result = _heuristic_intent(question)
        if note_request(question) is not None:
            # A note is created by N.O.V.A. from the words the user wrote, whatever the model guessed.
            result = IntentResult(intent="note", standalone_question=question)
        _emit("classify", "done", label=f"Intent: {result.intent.replace('_', ' ')}")
        debug_log(
            hypothesis_id="S5",
            location="graph.py:classify",
            message="intent classified",
            data={
                "raw_question": question[:200],
                "standalone_question": (result.standalone_question or "")[:200],
                "intent": result.intent,
            },
        )
        return {**learning_patch, "intent": result.model_dump(), "timings": {}, "pending": None, "resumed": False, "clarifications": 0}

    async def _resume(self, state: SmartState, pending: Pending, reply: str) -> SmartState | None:
        """Continue the saved workflow when the reply answers it; None means a new question."""
        options = list(pending.get("options") or [])
        ctx = {**(state.get("context") or {}), **(pending.get("context") or {})}
        intent = dict(pending.get("intent") or {})
        if pending.get("kind") == "choose_model":
            index = match_option(reply, options)
            picked_item: dict[str, Any] | None = None
            option: dict[str, Any] | None = None
            if index is not None:
                option = options[index]
            else:
                catalog = ctx.get("catalog") if isinstance(ctx.get("catalog"), list) else []
                merged = f"{pending.get('question') or ''} {reply}".strip()
                picked_item = pick_report(merged, catalog, min_score=2.0, prefer_best=True)
                if not picked_item:
                    hits = await fetch_catalog_metadata_hints(self.agents, merged)
                    for row in hits:
                        rid = str(row.get("report_id") or "").lower()
                        if not rid:
                            continue
                        for menu_item in catalog:
                            if str(menu_item.get("report_id") or "").lower() == rid:
                                picked_item = menu_item
                                break
                        if picked_item:
                            break
                debug_log(
                    hypothesis_id="B",
                    location="graph.py:_resume",
                    message="choose_model reply not in options",
                    data={
                        "reply": reply[:80],
                        "resolved": bool(picked_item),
                        "title": str((picked_item or {}).get("title") or "")[:80],
                    },
                )
                if not picked_item:
                    return None
                option = {
                    "title": picked_item.get("title"),
                    "workspace_id": picked_item.get("workspace_id"),
                    "dataset_id": picked_item.get("dataset_id"),
                    "report_id": picked_item.get("report_id"),
                    "source": picked_item.get("source") or "portal",
                    "environment": PROD,
                }
            assert option is not None
            base_item = picked_item or {k: option.get(k) for k in ("title", "workspace_id", "dataset_id", "report_id", "source")}
            item = await self._ensure_dataset(base_item)
            if not item:
                debug_log(
                    hypothesis_id="C",
                    location="graph.py:_resume",
                    message="ensure_dataset failed after model choice",
                    data={"title": str(option.get("title") or "")[:80], "report_id": option.get("report_id")},
                )
                return {"pending": None, "resumed": True, "intent": intent, "outcome": "failed", "response": self._message(SMART_DOWN, kind="error", confidence=0.0)}
            title = str(option.get("title") or "semantic model")
            ctx.update(
                {
                    "workspace_id": item["workspace_id"],
                    "dataset_id": item["dataset_id"],
                    "report_id": item.get("report_id"),
                    "report_name": title,
                    "matched_report_title": title,
                    "matched_from": "choice",
                    "matched_environment": option.get("environment") or PROD,
                }
            )
            key = item_key(item)
            remaining = [o for i, o in enumerate(options) if i != index]
            _emit("classify", "done", label=f"Using your choice: {title[:48]}")
            log(logger, logging.INFO, "pending_resumed", kind="choose_model", choice=title[:80], environment=option.get("environment"))
            pick_events = [
                {
                    "kind": "preferred_report",
                    "source": "clarification_pick",
                    "chosen_title": title,
                    "chosen_dataset_id": str(item.get("dataset_id") or ""),
                    "question": str(pending.get("question") or state["question"]),
                }
            ]
            learned = merge_hints(state.get("learned_hints"), pick_events)
            await self.analytics.record_correction(
                user_email=state["user_email"],
                source="clarification_pick",
                question=str(pending.get("question") or state["question"]),
                conversation=state.get("conversation_id"),
                chosen_title=title,
                chosen_dataset_id=str(item.get("dataset_id") or ""),
                detail={"options": [o.get("title") for o in options[:6]]},
            )
            return {
                "pending": None,
                "resumed": True,
                "intent": intent,
                "context": ctx,
                "dataset": _dataset_from_item(item),
                "model_candidates": [item],
                "model_options": remaining,
                "authorized_keys": [key],
                "scope": security_scope(state["user_email"], option, catalog_unavailable=bool(ctx.get("catalog_unavailable"))),
                "workspace_searched": True,
                "clarifications": int(pending.get("asked") or 0),
                "timings": {},
                "learned_hints": learned,
            }
        if pending.get("kind") == "clarify_query":
            original = str(pending.get("question") or "")
            index = match_option(reply, options) if options else None
            answer = str(options[index]) if index is not None and isinstance(options[index], str) else reply
            merged: str | None = None
            if index is not None or looks_like_answer(reply):
                merged = merge_reply(original, answer)
            if self.llm.configured:
                try:
                    out = await self.llm.complete_json(
                        RESUME_PROMPT + "\n\nBUSINESS CONTEXT:\n" + _business_context(),
                        f"ORIGINAL REQUEST:\n{original}\n\nSMART ASKED:\n{pending.get('prompt')}\n\nUSER REPLY:\n{reply}",
                        ResumeResult,
                        max_tokens=300,
                    )
                    if out.answers_pending and out.merged_question.strip():
                        merged = out.merged_question.strip()
                    elif not out.answers_pending and index is None:
                        merged = None
                except LLMUnavailable:
                    pass
            if merged is None or not pending.get("dataset"):
                return None
            intent["standalone_question"] = merged
            _emit("classify", "done", label="Continuing your earlier question")
            log(logger, logging.INFO, "pending_resumed", kind="clarify_query", asked=pending.get("asked"))
            dataset = dict(pending["dataset"])
            return {
                "pending": None,
                "resumed": True,
                "intent": intent,
                "context": ctx,
                "dataset": dataset,
                "model_candidates": [{**dataset, "title": ctx.get("matched_report_title")}],
                "model_options": [],
                "authorized_keys": [_dataset_key(dataset)],
                "scope": str(ctx.get("_scope") or f"user:{state['user_email'].lower()}"),
                "workspace_searched": True,
                "clarifications": int(pending.get("asked") or 0),
                "timings": {},
            }
        return None

    async def retrieve_context(self, state: SmartState) -> SmartState:
        """Menu catalog, Power BI workspace discovery and portal metadata hints in parallel, then
        hybrid search -> rerank -> LLM reasoning -> decision."""
        ctx = dict(state.get("context") or {})
        catalog = ctx.get("catalog") if isinstance(ctx.get("catalog"), list) else []
        catalog_down = bool(ctx.get("catalog_unavailable"))
        question = state["intent"].get("standalone_question") or state["question"]
        override = bool(ctx.get("include_nonprod")) and state["user_email"].lower() in self.settings.nonprod_users()
        _emit("retrieve", "running", label="Finding the appropriate Power BI report and semantic model")

        # Created first so the portal metadata search is the first agent call (it does not depend on the others).
        hints_task = asyncio.create_task(fetch_catalog_metadata_hints(self.agents, question))
        open_task = asyncio.create_task(self._open_item(ctx))
        workspace_task = asyncio.create_task(self._workspace_inventory())
        metadata_hits, open_item, (inventory, workspace_error) = await asyncio.gather(hints_task, open_task, workspace_task)
        allowed = authorize_workspace_items(inventory, catalog, catalog_unavailable=catalog_down)
        menu = enrich_menu_items(catalog, inventory)
        pool = [*menu, *pool_for_user(inventory, allowed, self.policy, catalog_unavailable=catalog_down)]
        if inventory:
            self.metadata.schedule(inventory, self.policy, lambda key: self.cache.invalidate(key, reason="metadata_changed"))
        metadata_hits = metadata_hits if isinstance(metadata_hits, list) else []
        decision = await self.retriever.retrieve(
            question,
            pool,
            override=override,
            open_item=open_item,
            metadata_hits=metadata_hits,
            learned_hints=state.get("learned_hints"),
        )
        if should_rerank(decision, self.settings, self.llm):
            _emit("rerank", "running", label="Reasoning over the best-matching reports")
            decision = await llm_rerank(
                self.llm,
                self.settings,
                _prompt("rerank"),
                question,
                _memory_turns(state),
                decision,
                self.metadata.text_for,
            )
            if decision.llm:
                _emit("rerank", "done", label=f"Chose {decision.selected.title[:40]}" if decision.selected and decision.llm.get("outcome") in {"changed", "confirmed"} else "Kept the ranked choice")
        authorized = sorted({item_key(item) for item in pool if item_key(item)} | ({item_key(open_item)} if open_item else set()))
        base: SmartState = {
            "needs_discovery": False,
            "retry_query": False,
            "workspace_searched": True,
            "retrieval": {**decision.trace(), "vector_store": decision.vector_store, **decision.timings},
            "authorized_keys": authorized,
        }

        if decision.action == "select" and decision.selected is not None:
            chosen = [decision.selected, *decision.retry]
            for candidate in chosen:
                item = await self._ensure_dataset(candidate.item)
                if not item:
                    continue
                return self._use_model(state, ctx, item, candidate.environment, decision, base, chosen)
            # A selected model has already passed the environment hard filter. Do not
            # turn excluded or lower-ranked keyword matches into a user choice here.
            # In particular, a missing production model must not surface a draft.
            return {**base, **self._down("selected model could not be resolved")}

        if decision.action == "ask":
            _emit("retrieve", "done", label="Several models match")
            return {**base, **self._ask_model(state, ctx, [c.option() for c in decision.options], decision.reason)}

        _emit("retrieve", "done", label="No matching semantic model")
        if workspace_error and not menu and not open_item:
            return {**base, **self._down(workspace_error)}
        if catalog_down and workspace_error:
            return {**base, **self._down(workspace_error)}
        return {
            **base,
            "model_candidates": [],
            "outcome": "retrieval_miss",
            "response": self._message(self._unmatched_message(catalog_down), kind="info"),
        }

    def _use_model(
        self,
        state: SmartState,
        ctx: dict[str, Any],
        item: dict[str, Any],
        environment: str,
        decision: Decision,
        base: SmartState,
        chosen: list[Any],
    ) -> SmartState:
        title = str(item.get("title") or item.get("report_name") or "semantic model")
        ctx = {
            **ctx,
            "workspace_id": item.get("workspace_id"),
            "dataset_id": item.get("dataset_id"),
            "report_id": item.get("report_id"),
            "report_name": title,
            "matched_report_title": title,
            "matched_from": item.get("source") or "workspace",
            "matched_environment": environment,
        }
        if decision.request.explicit and environment == PROD and decision.reason != "open_report":
            asked_for = ", ".join(sorted({ENV_LABEL.get(e, e.lower()) for e in decision.request.requested_envs}))
            ctx["env_note"] = f"I found no {asked_for} version for that, so this uses {title}."
        scope = security_scope(state["user_email"], item, catalog_unavailable=bool(ctx.get("catalog_unavailable")))
        ctx["_scope"] = scope
        _emit("retrieve", "done", label=f"Using model for {title[:48]}")
        return {
            **base,
            "authorized_keys": sorted(set(base.get("authorized_keys") or []) | {item_key(item)}),
            "model_candidates": [c.item for c in chosen],
            "model_options": [c.option() for c in decision.alternatives],
            "context": ctx,
            "scope": scope,
            "dataset": _dataset_from_item(item),
        }

    def _ask_model(self, state: SmartState, ctx: dict[str, Any], options: list[dict[str, Any]], reason: str, failed_title: str | None = None) -> SmartState:
        options = options[: max(2, self.settings.retrieval_max_options)]
        asked = int(state.get("clarifications") or 0) + 1
        if asked > self.settings.max_clarifications:
            return {
                "pending": None,
                "outcome": "clarification_loop",
                "response": self._message(
                    "I still can't tell which report to use. Please ask again and include the report name from the menu.",
                    kind="info",
                    confidence=0.0,
                ),
            }
        lines = [f"{i}. {o['label']}" for i, o in enumerate(options, 1)]
        if failed_title:
            intro = f"I couldn't query {failed_title} in Power BI. These models also match:"
        elif reason == "only_nonprod":
            intro = "I found only non-production versions for that. Pick one if you want me to use it:"
        elif reason == "several_requested_versions":
            intro = "Several versions match. Which one should I use?"
        else:
            intro = "More than one report matches. Which one should I use?"
        text = intro + "\n" + "\n".join(lines) + "\n\nReply with the number or the name."
        pending = new_pending(
            "choose_model",
            question=state["intent"].get("standalone_question") or state["question"],
            intent=state["intent"],
            options=options,
            dataset=None,
            context={k: v for k, v in ctx.items() if k not in ("catalog", "memory")},
            asked=asked,
            prompt=text,
        )
        log(logger, logging.INFO, "model_choice_requested", reason=reason, options=[o["label"][:60] for o in options])
        return {
            "pending": pending,
            "outcome": "model_choice",
            "dataset": None,
            "semantiq": None,
            "response": self._message(text, kind="clarification", confidence=0.0, candidates=[o["label"] for o in options], awaiting="choose_model"),
        }

    def _offer_alternatives(self, state: SmartState, ctx: dict[str, Any], options: list[dict[str, Any]] | None, failed_title: str | None) -> SmartState:
        if options:
            return self._ask_model(state, ctx, options, "unreadable", failed_title=failed_title or "that model")
        return self._down("selected model unreadable and no alternatives")

    async def _open_item(self, ctx: dict[str, Any]) -> dict[str, Any] | None:
        if ctx.get("workspace_id") and ctx.get("dataset_id"):
            return {
                "title": ctx.get("report_name") or "Open report",
                "workspace_id": ctx.get("workspace_id"),
                "dataset_id": ctx.get("dataset_id"),
                "report_id": ctx.get("report_id"),
                "source": "open",
            }
        if ctx.get("workspace_id") and ctx.get("report_id"):
            return await self._with_dataset(
                {"title": ctx.get("report_name") or "Open report", "workspace_id": ctx.get("workspace_id"), "report_id": ctx.get("report_id"), "source": "open"}
            )
        return None

    async def _ensure_dataset(self, item: dict[str, Any]) -> dict[str, Any] | None:
        if item.get("dataset_id") and item.get("workspace_id"):
            return item
        return await self._with_dataset(item)

    async def _with_dataset(self, item: dict[str, Any]) -> dict[str, Any] | None:
        if item.get("dataset_id") and item.get("workspace_id"):
            return item
        if not item.get("workspace_id") or not item.get("report_id"):
            return None
        try:
            from pbi_semantiq_agent.catalog_disk import get_catalog_store

            disk = get_catalog_store().resolve_report_dataset(str(item["workspace_id"]), str(item["report_id"]))
            if disk and disk.get("dataset_id"):
                return {
                    **item,
                    "dataset_id": disk["dataset_id"],
                    "workspace_id": disk.get("dataset_workspace_id") or item["workspace_id"],
                    "dataset_workspace_id": disk.get("dataset_workspace_id"),
                    "resolution_source": disk.get("source"),
                }
        except Exception:
            disk = None
        try:
            found = await self.agents.call(
                SEMANTIQ,
                "resolve_report_model",
                {"workspace_id": item["workspace_id"], "report_id": item["report_id"]},
            )
        except AgentCallError:
            return None
        report = found.get("report") if found.get("status") == "ok" else None
        dataset_id = (report or {}).get("datasetId")
        if not dataset_id:
            return None
        return {
            **item,
            "dataset_id": dataset_id,
            "workspace_id": (report or {}).get("datasetWorkspaceId") or item["workspace_id"],
            "title": item.get("title") or (report or {}).get("name"),
        }

    async def _workspace_inventory(self) -> tuple[list[dict[str, Any]], str | None]:
        cached = self._inventory.get()
        if cached is not None:
            return cached, None
        try:
            listed = await self.agents.call(SEMANTIQ, "list_workspaces", {})
        except AgentCallError as exc:
            log(logger, logging.ERROR, "workspace_discovery_failed", error=str(exc)[:300])
            return [], "unreachable"
        if listed.get("status") != "ok":
            return [], "unavailable"
        workspaces = [ws for ws in (listed.get("workspaces") or []) if isinstance(ws, dict) and ws.get("id")]

        async def scan(ws: dict[str, Any]) -> tuple[str, Any, Any]:
            wid = str(ws["id"])
            models, reports = await asyncio.gather(
                self.agents.call(SEMANTIQ, "list_semantic_models", {"workspace_id": wid}),
                self.agents.call(SEMANTIQ, "list_reports", {"workspace_id": wid}),
                return_exceptions=True,
            )
            return str(ws.get("name") or ""), models, reports

        try:
            scanned = await asyncio.gather(*(scan(ws) for ws in workspaces))
        except AgentCallError as exc:
            log(logger, logging.ERROR, "workspace_discovery_failed", error=str(exc)[:300])
            return [], "unreachable"
        items: list[dict[str, Any]] = []
        flags: dict[str, dict[str, Any]] = {}
        for wname, models, reports in scanned:
            if isinstance(models, dict) and models.get("status") == "ok":
                for model in models.get("models") or []:
                    if isinstance(model, dict) and model.get("id") and model.get("name"):
                        rls = {
                            "rls_required": model.get("isEffectiveIdentityRequired"),
                            "rls_roles_required": model.get("isEffectiveIdentityRolesRequired"),
                        }
                        flags[str(model["id"]).lower()] = rls
                        items.append(
                            {
                                "title": model.get("name"),
                                "menu_path": wname,
                                "workspace_name": wname,
                                "description": model.get("description"),
                                "workspace_id": model.get("workspaceId"),
                                "dataset_id": model.get("id"),
                                "source": "workspace",
                                **rls,
                            }
                        )
            if isinstance(reports, dict) and reports.get("status") == "ok":
                for report in reports.get("reports") or []:
                    if isinstance(report, dict) and report.get("datasetId") and report.get("name"):
                        items.append(
                            {
                                "title": report.get("name"),
                                "menu_path": wname,
                                "workspace_name": wname,
                                "description": report.get("description"),
                                "workspace_id": report.get("datasetWorkspaceId") or report.get("workspaceId"),
                                "dataset_id": report.get("datasetId"),
                                "report_id": report.get("id"),
                                "source": "workspace",
                            }
                        )
        for item in items:
            if "rls_required" not in item:
                item.update(flags.get(str(item.get("dataset_id")).lower(), {}))
        self._inventory.put(items)
        return items, None

    async def _dataset_freshness(self, ds: dict[str, Any]) -> str | None:
        key = _dataset_key(ds)
        cached = self._freshness.get(key)
        if cached and time.monotonic() - cached[1] < self.settings.freshness_ttl_s:
            return cached[0]
        marker: str | None = None
        try:
            async with asyncio.timeout(5):
                out = await self.agents.call(SEMANTIQ, "get_dataset_freshness", {"workspace_id": ds["workspace_id"], "dataset_id": ds["dataset_id"]})
            fresh = out.get("freshness") if isinstance(out, dict) and out.get("status") == "ok" else None
            if fresh:
                marker = str(fresh.get("refreshedAt") or fresh.get("refreshId") or "") or None
        except (AgentCallError, TimeoutError) as exc:
            log(logger, logging.INFO, "freshness_unknown", dataset=key, error=type(exc).__name__)
        self._freshness[key] = (marker, time.monotonic())
        return marker

    def _cache_signature(self, state: SmartState) -> tuple[str, str]:
        intent = state["intent"]
        question = intent.get("standalone_question") or state["question"]
        sig = signature(question, datetime.now().date(), self.glossary, visual=intent.get("preferred_visual") or ("auto" if intent.get("wants_visual") else ""))
        return sig.key(), sig.filter_text() or normalized_text(question, self.glossary)

    async def cache_lookup(self, state: SmartState) -> SmartState:
        ds = state.get("dataset") or {}
        if not self.cache.enabled or not ds.get("dataset_id"):
            return {"cache": {"hit": False, "reason": "disabled"}}
        key = _dataset_key(ds)
        scope = state.get("scope") or f"user:{state['user_email'].lower()}"
        freshness = await self._dataset_freshness(ds)
        sig, text = self._cache_signature(state)
        found = await self.cache.lookup(
            scope=scope,
            dataset_key=key,
            authorized_keys=set(state.get("authorized_keys") or []),
            signature=sig,
            text=text,
            freshness=freshness,
            metadata_digest="",
        )
        info = {"hit": found.entry is not None, "reason": found.reason, "similarity": round(found.similarity, 3), "ms": found.ms, "scope": scope.split(":")[0], "freshness": freshness}
        log(logger, logging.INFO, "semantic_cache", dataset=key, **info)
        state_intent = state.get("intent") or {}
        debug_log(
            hypothesis_id="S1",
            location="graph.py:cache_lookup",
            message="semantic cache lookup",
            data={
                "signature": sig,
                "filter_text": text,
                "question": (state_intent.get("standalone_question") or state.get("question") or "")[:200],
                **info,
            },
        )
        if found.entry is None:
            return {"cache": {**info, "signature": sig, "text": text}}
        response = copy.deepcopy(found.entry.response)
        if scope == "shared":
            response.pop("rlsUser", None)
        else:
            response["rlsUser"] = state["user_email"]
        response["cache"] = {"hit": True, "ageS": round(time.monotonic() - found.entry.created), "similarity": round(found.similarity, 3)}
        _emit("cache", "done", label="Answered from a recent identical query")
        _stream_text(response.get("content") or "")
        return {"cache": info, "response": response, "semantiq": copy.deepcopy(found.entry.semantiq), "outcome": "answered_cached"}

    async def schema(self, state: SmartState) -> SmartState:
        ds = state["dataset"]
        _emit("schema", "running", label="Searching the semantic model", agent=SEMANTIQ)
        try:
            found = await self.agents.call(
                SEMANTIQ,
                "search_model",
                {**ds, "query": state["intent"]["standalone_question"], "user_email": state["user_email"], "limit": 12},
            )
        except AgentCallError as exc:
            return self._down(str(exc))
        if _semantiq_load_failure(found):
            return await self._unread_model(state, ds)
        matches = found.get("matches", []) if found.get("status") == "ok" else []
        _emit("schema", "done", label=f"{len(matches)} matching fields", agent=SEMANTIQ)
        if not matches:
            stats = found.get("stats") or {}
            text = "I could not find fields matching that in this model."
            if stats:
                text += f" The model has {stats.get('tables')} tables, {stats.get('measures')} measures and {stats.get('columns')} columns."
            return {"response": self._message(text, kind="info", confidence=1.0), "retry_query": False, "needs_discovery": False, "outcome": "unanswerable"}
        lines = []
        for m in matches[:10]:
            desc = f" - {m['description']}" if m.get("description") else ""
            where = m["name"] if m["kind"] == "table" else f"{m['table']}[{m['name']}]"
            lines.append(f"- {m['kind'].title()}: {where}{desc}")
        text = "Here is what the model contains for that:\n" + "\n".join(lines)
        citations = [{"kind": m["kind"], "table": m["table"], "name": m["name"]} for m in matches[:10]]
        return {"response": self._message(text, citations=citations, confidence=1.0, agents=[SEMANTIQ]), "retry_query": False, "needs_discovery": False, "outcome": "answered"}

    async def query(self, state: SmartState) -> SmartState:
        ds = state["dataset"]
        _emit("query", "running", label="Preparing, validating, and executing the analysis", agent=SEMANTIQ)
        started = time.perf_counter()
        sq = state["intent"]["standalone_question"]
        arguments = {
            "question": sq,
            **ds,
            "user_email": state["user_email"],
        }
        debug_log(
            hypothesis_id="S5",
            location="graph.py:query",
            message="semantiq question dispatched",
            data={
                "raw_question": (state.get("question") or "")[:200],
                "standalone_question": (sq or "")[:200],
                "cache_hit": bool((state.get("cache") or {}).get("hit")),
                "report_id": ds.get("report_id"),
            },
        )
        if ds.get("report_id"):
            arguments["report_id"] = ds["report_id"]
        last = state.get("last_turn")
        if last and last.get("dataset_key") == _dataset_key(ds) and last.get("dax"):
            # Same model as the previous answer: let the DAX planner reuse its grouping and filters on follow-ups.
            arguments["prior_turn"] = {"question": last.get("question"), "dax": last.get("dax")}
        hints = LearnedHints.from_dict(state.get("learned_hints")).ontology_hint_payload()
        if hints:
            arguments["ontology_hints"] = hints
        cache_info = state.get("cache") or {}

        async def ask() -> dict[str, Any]:
            return await self.agents.call(SEMANTIQ, "answer_question", arguments)

        try:
            if self.cache.enabled and cache_info.get("signature") is not None:
                scope = state.get("scope") or f"user:{state['user_email'].lower()}"
                flight = f"{scope}|{_dataset_key(ds)}|{cache_info['signature']}|{cache_info.get('text')}"
                result = await self.cache.single_flight(flight, ask)
            else:
                result = await ask()
        except AgentCallError as exc:
            return self._down(str(exc))
        status = result.get("status")
        timings = {**(state.get("timings") or {}), "semantiq_ms": _ms(started)}
        if status == "ok":
            _emit("query", "done", label=f"Query returned {result.get('row_count', 0)} rows", agent=SEMANTIQ, ms=_ms(started))
            return {"semantiq": result, "retry_query": False, "needs_discovery": False, "timings": timings}
        if status == "llm_unavailable":
            return self._down(str(result.get("message") or status))
        if _semantiq_load_failure(result):
            _emit("query", "done", label="Model unreadable", agent=SEMANTIQ)
            return await self._unread_model(state, ds)
        _emit("query", "done", label="SemantIQ needs more detail", agent=SEMANTIQ)
        if status == "needs_clarification":
            text = result.get("clarifying_question") or "Could you be more specific?"
            asked = int(state.get("clarifications") or 0) + 1
            if asked > self.settings.max_clarifications:
                return {
                    "response": self._message(
                        "I still need more detail than I can get from these replies. Please ask the full question again with the measure and the period.",
                        kind="info",
                        confidence=0.0,
                        agents=[SEMANTIQ],
                    ),
                    "pending": None,
                    "outcome": "clarification_loop",
                    "retry_query": False,
                    "needs_discovery": False,
                }
            pending = new_pending(
                "clarify_query",
                question=state["intent"]["standalone_question"],
                intent=state["intent"],
                options=[str(c) for c in result.get("candidates", [])][:8],
                dataset=dict(ds),
                context={k: v for k, v in (state.get("context") or {}).items() if k not in ("catalog", "memory")},
                asked=asked,
                prompt=text,
            )
            return {
                "response": self._message(text, kind="clarification", candidates=result.get("candidates", []), confidence=0.0, agents=[SEMANTIQ]),
                "pending": pending,
                "outcome": "clarification",
                "retry_query": False,
                "needs_discovery": False,
            }
        if status == "unanswerable":
            text = "This model does not contain the data needed for that question."
            if result.get("missing"):
                text += f" Missing: {result['missing']}."
            return {"response": self._message(text, kind="info", candidates=result.get("candidates", []), confidence=0.0, agents=[SEMANTIQ]), "retry_query": False, "needs_discovery": False, "outcome": "unanswerable"}
        if status != "query_failed":
            log(logger, logging.ERROR, "semantiq_unavailable", status=status, detail=str(result.get("message"))[:500])
            outcome = "invalid_dax" if status == "rejected" else "failed"
            return {"response": self._message(_semantiq_failure_message(status, result), kind="error", confidence=0.0, agents=[SEMANTIQ]), "retry_query": False, "needs_discovery": False, "outcome": outcome}
        text = result.get("message") or "I could not answer that confidently."
        return {"response": self._message(text, kind="low_confidence", candidates=result.get("candidates", []), confidence=0.0, query=result.get("dax"), agents=[SEMANTIQ]), "retry_query": False, "needs_discovery": False, "outcome": "invalid_dax"}

    async def compute(self, state: SmartState) -> SmartState:
        result = state["semantiq"] or {}
        return {"stats": compute_stats(result.get("columns", []), result.get("rows", []))}

    async def visualize(self, state: SmartState) -> SmartState:
        result = state["semantiq"] or {}
        rows = result.get("rows", [])
        intent = state["intent"]
        if not rows or (not intent.get("wants_visual") and len(rows) < 2 and intent.get("preferred_visual") is None):
            return {"visual": None}
        _emit("visualize", "running", label="N.O.V.A. is designing the visual", agent=NOVA)
        try:
            out = await self.agents.call(
                NOVA,
                "generate_visual",
                _nova_arguments(state, result, rows, intent),
            )
        except AgentCallError as exc:
            log(logger, logging.WARNING, "nova_unavailable", error=str(exc))
            _emit("visualize", "skipped", label="N.O.V.A. unavailable; showing table", agent=NOVA)
            return {"visual": None}
        visual = out.get("visual") if out.get("status") == "ok" else None
        _emit("visualize", "done", label=f"Visual: {visual.get('kind') if visual else 'none'}", agent=NOVA)
        return {"visual": visual}

    async def summarize(self, state: SmartState) -> SmartState:
        _emit("summarize", "running", label="Summarising the result")
        result = state["semantiq"] or {}
        stats = state["stats"] or {}
        rows = result.get("rows", [])
        fallback = {"summary": deterministic_summary(state["question"], stats), "highlights": [], "source": "template"}
        if not rows or not self.llm.configured:
            return {"summary": fallback}
        user = (
            f"QUESTION:\n{state['intent']['standalone_question']}\n\n"
            f"RESULT_COLUMNS: {result.get('result_description') or ', '.join(result.get('columns', []))}\n\n"
            f"COLUMN_MEANING (from the semantic model): {json.dumps([{k: m[k] for k in ('name', 'role', 'unit') if m.get(k)} for m in (result.get('column_meta') or [])][:12])}\n\n"
            f"STATS:\n{json.dumps(stats, default=str)}\n\n"
            f"ROWS (first 20 of {len(rows)}):\n{json.dumps(rows[:20], default=str)}\n\n"
            f"ASSUMPTIONS: {json.dumps(result.get('assumptions', []))}"
        )
        try:
            out = await self.llm.complete_json(_prompt("summarize") + "\n\nBUSINESS CONTEXT:\n" + _business_context(), user, SummaryResult, max_tokens=600, stream=True)
        except (LLMUnavailable, Exception):
            return {"summary": fallback}
        return {"summary": {**out.model_dump(), "source": "llm"}}

    async def verify(self, state: SmartState) -> SmartState:
        _emit("verify", "running", label="Checking every number against the data")
        result = state["semantiq"] or {}
        stats = state["stats"] or {}
        summary = dict(state["summary"] or {})
        rows = result.get("rows", [])
        allowed = allowed_values_from_rows(rows) + numeric_values(_flatten(stats))
        free_text = state["question"] + " " + " ".join(result.get("assumptions", []))
        text = summary.get("summary", "") + " " + " ".join(summary.get("highlights", []))
        report = check_grounding(text, allowed, also_allowed_text=free_text + " " + json.dumps(rows, default=str))
        if report.coverage < 1.0:
            log(logger, logging.WARNING, "summary_ungrounded", ungrounded=report.ungrounded[:10])
            summary = {"summary": deterministic_summary(state["question"], stats), "highlights": [], "source": "template", "replaced_ungrounded": report.ungrounded[:10]}
            report = check_grounding(summary["summary"], allowed, also_allowed_text=free_text + " " + json.dumps(rows, default=str))
        components = dict(result.get("confidence_components") or {})
        components["grounding"] = report.coverage
        confidence = Confidence(components)
        _emit("verify", "done", label=f"Confidence {confidence.score:.0%}")
        return {"summary": summary, "confidence": confidence.as_dict()}

    async def respond(self, state: SmartState) -> SmartState:
        result = state["semantiq"] or {}
        confidence = state["confidence"] or {"score": 0.0}
        summary = state["summary"] or {}
        if confidence["score"] < self.settings.confidence_threshold:
            response = self._message(
                "I can't answer that with enough confidence. Could you name the measure or period you mean?",
                kind="low_confidence",
                confidence=confidence["score"],
                candidates=result.get("candidates", []),
                query=result.get("dax"),
                agents=[SEMANTIQ],
            )
            response["confidenceDetail"] = confidence
            return {"response": response, "outcome": "low_confidence"}
        visual = state.get("visual")
        rows = result.get("rows") or []
        row_count = len(rows)
        compact = row_count <= 1 and not visual

        response = self._message(
            summary.get("summary", ""),
            kind="answer",
            confidence=confidence["score"],
            agents=[SEMANTIQ] + ([NOVA] if visual else []),
            query=result.get("dax") if not compact else None,
        )
        extras: dict[str, Any] = {
            "assumptions": result.get("assumptions", []),
            "confidenceDetail": confidence,
            "rlsUser": result.get("rls_user"),
        }
        if not compact:
            extras.update(
                {
                    "highlights": summary.get("highlights", []),
                    "stats": stat_cards(state.get("stats") or {}),
                    "table": {
                        "columns": result.get("columns", []),
                        "rows": rows[:50],
                        "truncated": result.get("truncated") or row_count > 50,
                    },
                    "citations": [{"kind": "reference", "name": r} for r in result.get("references", [])][:20],
                }
            )
        ctx = state.get("context") or {}
        matched = ctx.get("matched_report_title")
        environment = ctx.get("matched_environment") or PROD
        if state.get("failed_datasets") and matched:
            note = f"The first matching model could not be queried in Power BI, so this figure is from {matched}."
            if note not in response["content"]:
                response["content"] = f"{note}\n\n{response['content']}"
        if ctx.get("env_note"):
            response["content"] = f"{ctx['env_note']}\n\n{response['content']}"
        if ctx.get("matched_from") in ("portal", "workspace", "choice") and matched and matched not in response["content"]:
            label = matched if environment == PROD else f"{matched}, {ENV_LABEL.get(environment, environment.lower())}"
            response["content"] = f"{response['content']}\n\n(Source: {label})"
        response.update({k: v for k, v in extras.items() if v not in (None, [], "")})
        if visual:
            response["visual"] = visual
        if environment != PROD:
            response["environment"] = environment
        await self._store_cache(state, response, result)
        _stream_text(response.get("content") or "")
        out: SmartState = {"response": response, "outcome": "answered"}
        turn = _last_turn(state, result)
        if turn:
            out["last_turn"] = turn
        return out

    async def _store_cache(self, state: SmartState, response: dict[str, Any], result: dict[str, Any]) -> None:
        info = state.get("cache") or {}
        ds = state.get("dataset") or {}
        if not self.cache.enabled or info.get("signature") is None or not ds.get("dataset_id"):
            return
        if state.get("failed_datasets"):
            return
        stored = await self.cache.store(
            scope=state.get("scope") or f"user:{state['user_email'].lower()}",
            dataset_key=_dataset_key(ds),
            signature=info["signature"],
            text=info.get("text") or "",
            question=state["intent"].get("standalone_question") or state["question"],
            response=response,
            semantiq=result,
            freshness=info.get("freshness"),
        )
        log(logger, logging.INFO, "semantic_cache_store", dataset=_dataset_key(ds), stored=stored)

    async def open_report(self, state: SmartState) -> SmartState:
        ctx = state.get("context") or {}
        if ctx.get("catalog_unavailable"):
            return {"response": self._message(REPORT_DATABASE_DOWN, kind="error", confidence=0.0), "outcome": "failed"}
        catalog = [c for c in (ctx.get("catalog") or []) if isinstance(c, dict)]
        question = state["intent"].get("standalone_question") or state["question"]
        override = bool(ctx.get("include_nonprod")) and state["user_email"].lower() in self.settings.nonprod_users()
        envs = [(str(c.get("title") or ""), self.policy.classify_item(c).environment) for c in catalog]
        request = self.policy.requested(question, envs, override=override)
        eligible = [c for c, (_, env) in zip(catalog, envs) if env in request.allowed]
        picked = pick_report(question, eligible, min_score=1.0, prefer_best=True)
        if not picked or not picked.get("portal_id"):
            return {"response": self._message("I could not find that report in your menu. Use the report name from the left panel.", kind="info"), "outcome": "retrieval_miss"}
        title = picked.get("title") or "that report"
        return {
            "response": self._message(
                f"Opening {title}.",
                kind="info",
                confidence=1.0,
                openReportId=str(picked["portal_id"]),
            ),
            "outcome": "info",
        }

    async def note(self, state: SmartState) -> SmartState:
        """N.O.V.A. writes the note (title, text, look). It is then saved to the Visual box from the reply."""
        request = note_request(state["question"]) or {"title": "Note", "text": ""}
        _emit("note", "running", label="N.O.V.A. is writing your note", agent=NOVA)
        try:
            out = await self.agents.call(NOVA, "generate_note", request)
        except AgentCallError as exc:
            log(logger, logging.WARNING, "nova_note_unavailable", error=str(exc)[:160])
            return {"response": self._message("I couldn't create the note right now. Please try again in a moment.", kind="error", confidence=0.0, agents=[NOVA]), "outcome": "failed"}
        if out.get("status") != "ok" or not isinstance(out.get("note"), dict):
            return {"response": self._message("I couldn't create the note from that. Try: \"make a note titled Fleet check: review IMO list\".", kind="error", confidence=0.0, agents=[NOVA]), "outcome": "failed"}
        note = out["note"]
        _emit("note", "done", label="Note ready", agent=NOVA)
        return {
            "response": self._message(
                f"Note \"{note['title']}\" is ready. Save it to the Visual box, or pin it to the home screen.",
                kind="answer",
                confidence=1.0,
                agents=[NOVA],
                note=note,
            ),
            "outcome": "answered",
        }

    async def greeting(self, state: SmartState) -> SmartState:
        return {"response": self._message(CAPABILITIES, kind="info", confidence=1.0), "outcome": "info"}

    async def out_of_scope(self, state: SmartState) -> SmartState:
        return {"response": self._message("I can only help with figures, trends, and fields in your reports and semantic models.", kind="info", confidence=1.0), "outcome": "info"}

    async def remember(self, state: SmartState) -> SmartState:
        response = state.get("response") or {}
        text = response.get("content", "")
        outcome = state.get("outcome") or _outcome_from(response)
        ctx = state.get("context") or {}
        ds = state.get("dataset") or {}
        cache = state.get("cache") or {}
        try:
            pattern = await self.analytics.record(
                interaction_id=state.get("request_id") or uuid.uuid4().hex,
                user_email=state["user_email"],
                conversation=state.get("conversation_id") or "",
                question=state["question"],
                intent=str((state.get("intent") or {}).get("intent") or ""),
                outcome=outcome,
                dataset_key=_dataset_key(ds) or None,
                model_title=ctx.get("matched_report_title") if ds else None,
                environment=ctx.get("matched_environment") if ds else None,
                cache_hit=bool(cache.get("hit")),
                confidence=response.get("confidence"),
                retrieval=state.get("retrieval"),
                timings=state.get("timings"),
            )
        except Exception as exc:  # noqa: BLE001 - analytics must never break an answer
            log(logger, logging.WARNING, "analytics_failed", error=type(exc).__name__)
            pattern = None
        log(
            logger,
            logging.INFO,
            "turn_done",
            outcome=outcome,
            selected=ctx.get("matched_report_title") if ds else None,
            environment=ctx.get("matched_environment") if ds else None,
            cache_hit=bool(cache.get("hit")),
            retrieval=state.get("retrieval"),
            timings=state.get("timings"),
            repeat_cause=(pattern or {}).get("cause"),
        )
        return {"outcome": outcome, "history": [{"role": "user", "content": state["question"]}, {"role": "assistant", "content": text[:800]}]}

    # ------------------------------------------------------------ helpers
    @staticmethod
    def _message(content: str, *, kind: str = "answer", confidence: float | None = None, **extra: Any) -> dict[str, Any]:
        msg: dict[str, Any] = {"content": content, "kind": kind}
        if confidence is not None:
            msg["confidence"] = confidence
        msg.update({k: v for k, v in extra.items() if v not in (None, [], "")})
        return msg

    def _error(self, text: str, exc: Exception) -> dict[str, Any]:
        log(logger, logging.ERROR, "agent_error", error=str(exc)[:500])
        return self._message(text, kind="error", confidence=0.0)

    def _down(self, detail: str) -> SmartState:
        debug_log(hypothesis_id="D", location="graph.py:_down", message="SMART_DOWN path", data={"detail": detail[:200]})
        log(logger, logging.ERROR, "smart_down", error=detail[:500])
        return {
            "needs_discovery": False,
            "retry_query": False,
            "workspace_searched": True,
            "dataset": None,
            "semantiq": None,
            "outcome": "failed",
            "response": self._message(SMART_DOWN, kind="error", confidence=0.0),
        }

    @staticmethod
    def _unmatched_message(catalog_down: bool) -> str:
        if catalog_down:
            return (
                "The report catalog is unavailable. I searched the Power BI workspaces and could not find a report "
                "or semantic model matching that question."
            )
        return (
            "I couldn't find a report or semantic model for that yet. Try asking about vessels directly "
            "(for example \"handymax tankers in SPPL for Oct 2026\"), or pick the report from the menu and ask again."
        )

    async def _unread_model(self, state: SmartState, ds: dict[str, Any] | None) -> SmartState:
        """Retry only equally-ranked models that passed the same environment filter."""
        failed = list(state.get("failed_datasets") or [])
        key = _dataset_key(ds or {})
        if key and key not in failed:
            failed.append(key)
        ctx = state.get("context") or {}
        failed_title = str(ctx.get("matched_report_title") or "that model")
        selected_environment = str(ctx.get("matched_environment") or PROD)
        log(logger, logging.WARNING, "model_unreadable", dataset=key, title=failed_title[:80])
        async def try_item(item: dict[str, Any]) -> SmartState | None:
            if len(failed) > 6:
                return None
            if _dataset_key(item) in failed:
                return None
            nxt = await self._ensure_dataset(item)
            if not nxt or _dataset_key(nxt) in failed:
                return None
            if self.policy.classify_item(nxt).environment != selected_environment:
                return None
            title = str(nxt.get("title") or "semantic model")
            new_ctx = {
                **ctx,
                "workspace_id": nxt.get("workspace_id"),
                "dataset_id": nxt.get("dataset_id"),
                "report_id": nxt.get("report_id"),
                "report_name": title,
                "matched_report_title": title,
                "matched_from": ctx.get("matched_from") or "workspace",
            }
            _emit("discover", "done", label=f"Trying model: {title[:48]}", agent=SEMANTIQ)
            return {
                "failed_datasets": failed,
                "needs_discovery": False,
                "retry_query": True,
                "context": new_ctx,
                "dataset": _dataset_from_item(nxt),
                "semantiq": None,
            }

        for candidate in state.get("model_candidates") or []:
            retry = await try_item(candidate)
            if retry:
                return retry
        for option in state.get("model_options") or []:
            if not isinstance(option, dict):
                continue
            retry = await try_item(option)
            if retry:
                return retry
        # `model_options` are retrieval alternatives. They must never override a
        # direct production selection after Power BI rejects it: an alternative
        # could be DEV/ARCHIVE or merely share a keyword with the question.
        log(logger, logging.ERROR, "model_unreadable_exhausted", title=failed_title[:80], failed=len(failed))
        return {
            "failed_datasets": failed,
            "needs_discovery": False,
            "retry_query": False,
            "workspace_searched": True,
            "dataset": None,
            "semantiq": None,
            "outcome": "model_unavailable",
            "response": self._message(model_unreadable_message(failed_title), kind="error", confidence=0.0),
        }

    # ------------------------------------------------------------ wiring
    def _build(self, checkpointer):
        g = StateGraph(SmartState)
        for name in (
            "classify",
            "retrieve_context",
            "cache_lookup",
            "schema",
            "query",
            "compute",
            "visualize",
            "summarize",
            "verify",
            "respond",
            "greeting",
            "out_of_scope",
            "open_report",
            "note",
            "remember",
        ):
            g.add_node(name, getattr(self, name))
        g.add_edge(START, "classify")

        def after_classify(s: SmartState) -> str:
            if s.get("response"):
                return "remember"
            if s.get("resumed"):
                return "schema" if s["intent"].get("intent") == "schema_question" else "cache_lookup"
            return {"greeting": "greeting", "out_of_scope": "out_of_scope", "open_report": "open_report", "note": "note"}.get(
                s["intent"]["intent"], "retrieve_context"
            )

        g.add_conditional_edges(
            "classify",
            after_classify,
            ["greeting", "out_of_scope", "open_report", "note", "retrieve_context", "cache_lookup", "schema", "remember"],
        )
        g.add_edge("note", "remember")
        g.add_conditional_edges(
            "retrieve_context",
            lambda s: (
                "remember"
                if s.get("response") and not s.get("dataset")
                else ("schema" if s["intent"]["intent"] == "schema_question" else "cache_lookup")
            ),
            ["remember", "schema", "cache_lookup"],
        )
        g.add_conditional_edges("cache_lookup", lambda s: "remember" if s.get("response") else "query", ["remember", "query"])
        g.add_conditional_edges(
            "schema",
            lambda s: "schema" if s.get("retry_query") else "remember",
            ["schema", "remember"],
        )
        g.add_conditional_edges(
            "query",
            lambda s: "query" if s.get("retry_query") else ("remember" if not s.get("semantiq") else "compute"),
            ["query", "remember", "compute"],
        )
        # N.O.V.A. and the summary LLM both only need rows + stats, so they run side by side.
        g.add_edge("compute", "visualize")
        g.add_edge("compute", "summarize")
        g.add_edge(["visualize", "summarize"], "verify")
        g.add_edge("verify", "respond")
        g.add_edge("respond", "remember")
        g.add_edge("greeting", "remember")
        g.add_edge("out_of_scope", "remember")
        g.add_edge("open_report", "remember")
        g.add_edge("remember", END)
        return g.compile(checkpointer=checkpointer)

    async def on_feedback(
        self,
        *,
        interaction_id: str,
        user_email: str,
        rating: int,
        reason: str | None,
        comment: str | None,
    ) -> None:
        row = await self.analytics.get_interaction(interaction_id)
        if not row:
            return
        question = str(row.get("question") or "")
        if rating > 0:
            await self.analytics.record_correction(
                user_email=user_email,
                source="upvote_confirm",
                question=question,
                interaction_id=interaction_id,
                conversation=str(row.get("conversation") or ""),
                chosen_title=str(row.get("model_title") or "") or None,
                reason="upvote",
            )
            return
        if reason == "wrong_report" and comment:
            from .query_norm import normalize_report_label

            title_guess = normalize_report_label(comment).strip()
            await self.analytics.record_correction(
                user_email=user_email,
                source="feedback_comment",
                question=question,
                interaction_id=interaction_id,
                conversation=str(row.get("conversation") or ""),
                chosen_title=title_guess[:300] if title_guess else None,
                reason=reason,
                detail={"comment": (comment or "")[:500], "wrong_model": row.get("model_title")},
            )
        elif reason:
            await self.analytics.record_correction(
                user_email=user_email,
                source="feedback_comment",
                question=question,
                interaction_id=interaction_id,
                conversation=str(row.get("conversation") or ""),
                reason=reason,
                detail={"comment": (comment or "")[:500] if comment else None},
            )

    @asynccontextmanager
    async def _thread_lock(self, thread_id: str):
        """One turn at a time per conversation; different conversations run concurrently."""
        entry = self._thread_locks.get(thread_id)
        if entry is None:
            entry = self._thread_locks[thread_id] = [asyncio.Lock(), 0]
        entry[1] += 1
        try:
            async with entry[0]:
                yield
        finally:
            entry[1] -= 1
            if entry[1] == 0:
                self._thread_locks.pop(thread_id, None)

    async def run(self, *, question: str, user_email: str, conversation_id: str, context: dict[str, Any], request_id: str | None = None):
        """Yield ("step", {...}) events and finally ("message", response)."""
        thread_id = f"{user_email.lower()}:{conversation_id}"
        config = {"configurable": {"thread_id": thread_id}}
        # Per-turn fields are reset explicitly; "history" and "pending" carry over between turns.
        inputs: SmartState = {
            "question": question,
            "user_email": user_email,
            "request_id": request_id or uuid.uuid4().hex,
            "conversation_id": conversation_id,
            "context": context,
            "dataset": None,
            "semantiq": None,
            "stats": None,
            "visual": None,
            "summary": None,
            "confidence": None,
            "response": {},
            "timings": {},
            "needs_discovery": False,
            "retry_query": False,
            "workspace_searched": False,
            "failed_datasets": [],
            "model_candidates": [],
            "model_options": [],
            "authorized_keys": [],
            "scope": "",
            "retrieval": None,
            "cache": None,
            "outcome": "",
            "resumed": False,
        }
        final: dict[str, Any] = {}
        async with self._thread_lock(thread_id):
            async for mode, chunk in self.graph.astream(inputs, config, stream_mode=["custom", "values"]):
                if mode == "custom":
                    if isinstance(chunk, dict) and chunk.get("event") == "delta":
                        yield "delta", {"text": chunk.get("text") or ""}
                    else:
                        yield "step", chunk
                else:
                    final = chunk
        yield "message", final.get("response") or self._message("Something went wrong.", kind="error", confidence=0.0)


def _nova_arguments(state: SmartState, result: dict[str, Any], rows: list[dict[str, Any]], intent: dict[str, Any]) -> dict[str, Any]:
    """What N.O.V.A. receives: the stand-alone question (so a follow-up like "and last month?" keeps its
    subject) plus what SemantIQ knows about the columns. Extra fields are optional on the NOVA side."""
    args: dict[str, Any] = {
        "question": (intent.get("standalone_question") or state.get("question") or "").strip(),
        "columns": result.get("columns", []),
        "rows": rows,
        "preferred_type": intent.get("preferred_visual"),
    }
    if result.get("column_meta"):
        args["column_meta"] = result["column_meta"]
    if result.get("result_description"):
        args["result_description"] = str(result["result_description"])[:300]
    if intent.get("intent"):
        args["intent"] = str(intent["intent"])
    return args


def _last_turn(state: SmartState, result: dict[str, Any]) -> dict[str, Any] | None:
    """Compact record of this answer, carried to the next turn of the same conversation."""
    ds = state.get("dataset") or {}
    dax = result.get("executed_dax") or result.get("dax")
    if not dax or not ds.get("dataset_id"):
        return None
    return {
        "dataset_key": _dataset_key(ds),
        "question": (state.get("intent") or {}).get("standalone_question") or state.get("question"),
        "dax": str(dax)[:1500],
        "columns": list(result.get("columns") or [])[:12],
    }


def _outcome_from(response: dict[str, Any]) -> str:
    kind = response.get("kind")
    return {"answer": "answered", "clarification": "clarification", "low_confidence": "low_confidence", "error": "failed"}.get(str(kind), "info")


def _dataset_from_item(item: dict[str, Any]) -> dict[str, Any]:
    workspace_id = str(item.get("dataset_workspace_id") or item.get("workspace_id") or "")
    dataset_id = str(item.get("dataset_id") or "")
    out: dict[str, Any] = {"workspace_id": workspace_id, "dataset_id": dataset_id}
    if item.get("report_id"):
        out["report_id"] = item["report_id"]
    if item.get("dataset_workspace_id"):
        out["dataset_workspace_id"] = item["dataset_workspace_id"]
    return out


def _dataset_key(item: dict[str, Any]) -> str:
    workspace_id = item.get("workspace_id") or item.get("workspaceId")
    dataset_id = item.get("dataset_id") or item.get("datasetId") or item.get("id")
    if not workspace_id or not dataset_id:
        return ""
    return f"{workspace_id}|{dataset_id}".lower()


def _flatten(value: Any) -> list[Any]:
    if isinstance(value, dict):
        return [x for v in value.values() for x in _flatten(v)]
    if isinstance(value, list):
        return [x for v in value for x in _flatten(v)]
    return [value]


def _ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 1)


def _semantiq_load_failure(result: dict[str, Any] | None) -> bool:
    if not result:
        return False
    status = str(result.get("status") or "")
    if status == "model_unavailable":
        return True
    if status != "error":
        return False
    detail = str(result.get("message") or "").lower()
    return any(
        token in detail
        for token in (
            "could not read the semantic model",
            "workspace_id and dataset_id are required",
            "model_unavailable",
        )
    )


def _semantiq_failure_message(status: str | None, result: dict[str, Any]) -> str:
    if status == "rejected":
        return "SemantIQ rejected the generated query for safety. Try rephrasing your question."
    msg = str(result.get("message") or "").strip()
    if msg and status in ("error", "query_failed"):
        return msg
    log(logger, logging.ERROR, "semantiq_failure", status=status, detail=msg[:300])
    return SMART_DOWN
