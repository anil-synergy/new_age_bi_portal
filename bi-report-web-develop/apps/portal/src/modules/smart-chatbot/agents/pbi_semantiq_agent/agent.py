"""SemantIQ question-answering sub-graph (LangGraph).

catalog_meta -> load -> bind_concepts -> slice -> plan -> guard -> execute -> validate_result -> done
                                  ^          |         |
                                  +-- repair (max 1) --+
"""

from __future__ import annotations

import logging
import asyncio
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from smart_common.llm import LLMClient, LLMUnavailable
from smart_common.logging import log

from . import dax_guard
from .cache import AsyncTTLCache
from .dax_recovery import MAX_TOTAL_REPAIRS, can_retry, classify_dax_error
from .dax_sanitize import sanitize_group_column_filters
from .dax_skeleton import try_grouped_breakdown_dax
from .filter_preservation import check_filter_preservation
from .catalog_disk import get_catalog_store
from .metadata import SemanticModel, SchemaSlice, load_model, select_slice
from .ontology import (
    bind_concepts,
    classify_execution,
    extract_primary_value,
    reconcile_values,
    validation_dax,
    ValidationOutcome,
)
from .query_plan import QueryPlan, build_query_plan, coerce_query_plan
from .result_meta import build_column_meta
from .powerbi_client import PowerBIClient, PowerBIError

_LOAD_SOURCE: dict[str, str] = {}
from .settings import SemantiqSettings

logger = logging.getLogger(__name__)

INTENT_CLARITY = {"clear": 1.0, "assumed": 0.99, "ambiguous": 0.0, "unanswerable": 0.0}


@lru_cache
def _prompt() -> str:
    return (Path(__file__).parent / "prompts" / "semantiq_dax.md").read_text(encoding="utf-8")


class DaxPlan(BaseModel):
    intent: Literal["clear", "assumed", "ambiguous", "unanswerable"]
    dax: str = ""
    assumptions: list[str] = Field(default_factory=list)
    clarifying_question: str | None = None
    candidates: list[str] = Field(default_factory=list)
    missing: str | None = None
    result_description: str = Field("", description="One line: what each result column means")


class SemantiqState(TypedDict, total=False):
    question: str
    workspace_id: str
    dataset_id: str
    report_id: str | None
    user_email: str | None
    model: SemanticModel
    slice: SchemaSlice
    plan: DaxPlan
    guard: dax_guard.GuardResult
    error: str | None
    attempts: int
    date_retried: bool
    result: dict[str, Any]
    timings: dict[str, float]
    catalog_entry: dict[str, Any]
    data_connections: str
    bindings: Any
    query_plan: QueryPlan
    error_class: str | None
    repair_counts: dict[str, int]
    ontology_hints: dict[str, Any]
    # Previous turn of the same conversation on this model: {question, dax, filters, columns}.
    prior_turn: dict[str, Any] | None
    value_resolution: Any
    # Vector DB step: candidate route from the keyword index, and the measures to re-rank between.
    kw_route: Any
    kw_options: list[dict[str, Any]]


class MeasurePick(BaseModel):
    measure: str = Field(description="Exact name of the candidate measure that answers the question.")


RERANK_SYSTEM = (
    "You choose which measure answers a business question about vessels. Pick exactly one name from the candidate "
    "list. Vessel counts are 'vessels'; tankers and carriers are vessels. Return JSON only."
)


class SemantiqAgent:
    def __init__(self, settings: SemantiqSettings, client: PowerBIClient, llm: LLMClient):
        self.settings = settings
        self.client = client
        self.llm = llm
        self.models: AsyncTTLCache[SemanticModel] = AsyncTTLCache(
            settings.metadata_cache_ttl_s, max_entries=settings.metadata_cache_max_entries
        )
        self.graph = self._build()

    # ------------------------------------------------------------ public
    async def get_model(self, workspace_id: str, dataset_id: str, user: str | None) -> SemanticModel:
        cache_key = (workspace_id.lower(), dataset_id.lower())
        store = get_catalog_store()
        # region agent log
        from .xmla_client import _agent_log
        _agent_log(hypothesis_id="D,F", location="agent.py:get_model:entry", message="get_model called", data={"workspace_id": workspace_id, "dataset_id": dataset_id, "module_file": __file__, "pbi_configured": self.settings.pbi_configured, "prefer_live_xmla": self.settings.metadata_prefer_live_xmla, "uses_fabric_principal": getattr(self.settings, "uses_fabric_principal", None), "allowed_workspaces": sorted(self.settings.allowed_workspaces or [])})
        # endregion

        async def live() -> SemanticModel:
            return await load_model(self.client, workspace_id, dataset_id, user=user)

        if self.settings.pbi_configured and self.settings.metadata_prefer_live_xmla:
            try:
                model = await self.models.get_or_load(cache_key, live)
                _LOAD_SOURCE[":".join(cache_key)] = "xmla"
                return model
            except PowerBIError as exc:
                disk = store.load_model_from_disk(workspace_id, dataset_id)
                if disk:
                    log(
                        logger,
                        logging.WARNING,
                        "metadata_disk_fallback",
                        workspace_id=workspace_id,
                        dataset_id=dataset_id,
                        error=str(exc)[:200],
                    )
                    _LOAD_SOURCE[":".join(cache_key)] = "disk"
                    return disk
                raise

        disk = store.load_model_from_disk(workspace_id, dataset_id)
        if disk:
            _LOAD_SOURCE[":".join(cache_key)] = "disk"
            return disk
        model = await self.models.get_or_load(cache_key, live)
        _LOAD_SOURCE[":".join(cache_key)] = "xmla"
        return model

    async def answer(
        self,
        question: str,
        workspace_id: str,
        dataset_id: str,
        user_email: str | None,
        *,
        report_id: str | None = None,
        ontology_hints: dict[str, Any] | None = None,
        prior_turn: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        state: SemantiqState = {
            "question": question,
            "workspace_id": workspace_id,
            "dataset_id": dataset_id,
            "report_id": report_id,
            "user_email": user_email,
            "attempts": 0,
            "timings": {},
            "repair_counts": {},
        }
        if ontology_hints:
            state["ontology_hints"] = ontology_hints
        if prior_turn:
            state["prior_turn"] = prior_turn
        try:
            final = await self.graph.ainvoke(state)
        except Exception as exc:
            log(logger, logging.ERROR, "semantiq_graph_failed", error=type(exc).__name__, message=str(exc)[:500])
            return _failure("error", f"The analysis pipeline failed: {exc}")
        result = final.get("result")
        if not result:
            return _failure("error", "The analysis pipeline did not produce a result.")
        return result

    # ------------------------------------------------------------ keyword fast path
    def _keyword_router(self):
        """Built once when the keyword index is configured (QDRANT_URL and EMBEDDING_MODEL); otherwise None."""
        if not self.settings.keyword_router_enabled:
            return None
        if getattr(self, "_kw_router", None) is None:
            from .keyword_index import build_keyword_embedder
            from .keyword_router import KeywordRouter
            from .keyword_store import build_keyword_store

            try:
                store = build_keyword_store(self.settings)
                if store is None:
                    return None
                self._kw_router = KeywordRouter(
                    self.settings,
                    store,
                    build_keyword_embedder(self.settings),
                )
            except Exception as exc:  # noqa: BLE001 - misconfiguration falls back to the full pipeline
                log(logger, logging.WARNING, "keyword_router_unavailable", error=type(exc).__name__, message=str(exc)[:160])
                self._kw_router = None
        return self._kw_router

    # Graph node 1 - vector DB: keyword search over measures, dimensions and stored values.
    async def _kw_search(self, state: SemantiqState) -> SemantiqState:
        from .keyword_router import measure_options

        started = time.perf_counter()
        router = self._keyword_router()
        if router is None:
            return {"kw_route": None, "kw_options": []}
        dataset_id = (state.get("dataset_id") or "").strip() or None
        try:
            question, hits = await asyncio.wait_for(
                router.search(state["question"], dataset_id), timeout=self.settings.keyword_router_timeout_s
            )
        except Exception as exc:  # noqa: BLE001 - the vector DB is an accelerator, never a blocker
            log(logger, logging.INFO, "keyword_search_skipped", error=type(exc).__name__)
            return {"kw_route": None, "kw_options": []}
        route = router.pick(question, hits, dataset_id)
        options = measure_options(route, hits) if route else []
        return {
            "kw_route": route,
            "kw_options": options,
            "timings": {**state["timings"], "keyword_search_ms": _ms(started)},
        }

    # Graph node 2 - re-rank: only when several measures are about equally close. The LLM picks the one the
    # question means; without an LLM the best keyword score is used.
    async def _kw_rerank(self, state: SemantiqState) -> SemantiqState:
        from dataclasses import replace

        route = state["kw_route"]
        options = state["kw_options"]
        chosen = options[0]
        if self.llm.configured:
            listing = "\n".join(f"- {o['name']} (table {o['table']}): {o['description'] or 'no description'}" for o in options)
            user = f"QUESTION:\n{state['question']}\n\nCANDIDATE MEASURES:\n{listing}"
            try:
                pick = await self.llm.complete_json(RERANK_SYSTEM, user, MeasurePick, max_tokens=200)
                chosen = next((o for o in options if o["name"] == pick.measure), chosen)
            except LLMUnavailable as exc:
                log(logger, logging.INFO, "keyword_rerank_fallback", error=str(exc)[:120])
        new_route = replace(route, measures=[{"name": chosen["name"], "table": chosen["table"]}], confidence=max(route.confidence, chosen["score"]))
        return {"kw_route": new_route, "kw_options": []}

    # Graph node 3 - DAX: one targeted query built from the index (no full model read), guarded, executed.
    async def _kw_dax(self, state: SemantiqState) -> SemantiqState:
        from .keyword_router import build_dax, result_from_route, stub_model

        started = time.perf_counter()
        route = state["kw_route"]
        dax = build_dax(route)
        stub = stub_model(route)
        guard = dax_guard.validate(dax, stub, max_rows=self.settings.pbi_max_rows)
        if not guard.ok:
            log(logger, logging.INFO, "keyword_dax_guard_rejected", errors=guard.errors[:2])
            return {"result": None}
        try:
            data = await self.client.execute_dax(route.workspace_id, route.dataset_id, guard.dax)
        except PowerBIError as exc:
            log(logger, logging.INFO, "keyword_dax_query_failed", error=str(exc)[:160])
            return {"result": None}
        rows = data["rows"][: self.settings.pbi_max_rows]
        meta = build_column_meta(data["columns"], rows, stub)
        result = result_from_route(route, rows, data["columns"], dax, guard.dax, meta)
        result["rls_user"] = state.get("user_email")
        result["timings"] = {**state["timings"], "keyword_dax_ms": _ms(started)}
        log(logger, logging.INFO, "keyword_dax_answered", dataset_id=route.dataset_id, measures=len(route.measures), filters=len(route.filters))
        return {"result": result, "timings": result["timings"]}

    # ------------------------------------------------------------ nodes
    async def _catalog_meta(self, state: SemantiqState) -> SemantiqState:
        store = get_catalog_store()
        ws = (state.get("workspace_id") or "").strip()
        ds = (state.get("dataset_id") or "").strip()
        report_id = (state.get("report_id") or "").strip()
        out: SemantiqState = {}
        if report_id and ws:
            resolved = store.resolve_report_dataset(ws, report_id) or {}
            by_report = resolved.get("catalog_entry") or store.by_report(ws, report_id)
            if resolved.get("dataset_id"):
                out["dataset_id"] = str(resolved["dataset_id"])
                out["workspace_id"] = str(resolved.get("dataset_workspace_id") or ws)
            if by_report:
                out["catalog_entry"] = by_report
                if not ds and by_report.get("dataset_id"):
                    ds = str(by_report["dataset_id"])
                    out["dataset_id"] = ds
                ws = str(by_report.get("dataset_workspace_id") or by_report.get("workspace_id") or ws)
                out["workspace_id"] = ws
        routed = bool(ws and ds)
        if not routed:
            match = store.resolve_ids(state.get("question") or "")
            if match:
                ws = str(match.get("dataset_workspace_id") or match.get("workspace_id") or "")
                ds = str(match.get("dataset_id") or "")
                out["workspace_id"] = ws
                out["dataset_id"] = ds
                out["catalog_entry"] = match
        if ws and ds:
            entry = store.by_dataset(ws, ds) or out.get("catalog_entry")
            if not entry:
                for row in store.reports():
                    if str(row.get("dataset_id") or "").lower() == ds.lower():
                        entry = row
                        break
            if entry:
                out["catalog_entry"] = entry
                out["data_connections"] = store.datasources_summary(entry)
                dws = str(entry.get("dataset_workspace_id") or entry.get("workspace_id") or "")
                if dws:
                    out["workspace_id"] = dws
                if not out.get("dataset_id"):
                    out["dataset_id"] = str(entry.get("dataset_id") or ds)
        return out

    async def _load(self, state: SemantiqState) -> SemantiqState:
        started = time.perf_counter()
        if not state.get("workspace_id") or not state.get("dataset_id"):
            return {"result": _failure("model_unavailable", "workspace_id and dataset_id are required (or run pbi_semantic_metadata build).")}
        ws = state["workspace_id"]
        ds = state["dataset_id"]
        try:
            model = await self.get_model(ws, ds, state.get("user_email"))
        except PowerBIError as exc:
            # region agent log
            from .xmla_client import _agent_log
            _agent_log(hypothesis_id="A,B,C,E", location="agent.py:_load:power_bi_error", message="model load failed", data={"workspace_id": ws, "dataset_id": ds, "error_type": type(exc).__name__, "error": str(exc)[:300], "status": getattr(exc, "status", None), "detail": (getattr(exc, "detail", None) or "")[:800]})
            # endregion
            return {"result": _failure("model_unavailable", f"Could not read the semantic model: {exc}")}
        source = _LOAD_SOURCE.get(f"{ws.lower()}:{ds.lower()}", "unknown")
        log(logger, logging.INFO, "semantic_model_loaded", workspace_id=ws, dataset_id=ds, source=source)
        return {"model": model, "timings": {**state["timings"], "load_ms": _ms(started), "load_source": source}}

    async def _resolve_values(self, state: SemantiqState) -> SemantiqState:
        """Match words in the question to the values stored in the model (DOC, sub type, vessel type...).

        Exact model values are passed to the planner. A term that matches several values equally is
        returned as a clarification with those values as options. Never blocks the query on error.
        """
        from .value_resolver import resolve_question_values

        started = time.perf_counter()
        try:
            res = await asyncio.wait_for(
                resolve_question_values(self.client, state["workspace_id"], state["dataset_id"], state["model"], state["question"]),
                timeout=self.settings.value_resolution_timeout_s,
            )
        except Exception as exc:  # noqa: BLE001 - matching is an aid, never a blocker
            log(logger, logging.WARNING, "value_resolution_skipped", error=type(exc).__name__, message=str(exc)[:200])
            return {"value_resolution": None, "timings": {**state["timings"], "resolve_values_ms": _ms(started)}}
        timings = {**state["timings"], "resolve_values_ms": _ms(started)}
        if res.ambiguous:
            term, options = next(iter(res.ambiguous.items()))
            labels = [f"{m.value} ({m.table}[{m.column}])" for m in options]
            text = f"\"{term}\" matches more than one value in this model. Which one do you mean?"
            return {
                "value_resolution": res,
                "timings": timings,
                "result": {
                    "status": "needs_clarification",
                    "clarifying_question": text,
                    "candidates": labels,
                    "missing": None,
                    "confidence_components": {"schema_match": 1.0, "query_success": 0.0, "intent_clarity": 0.0},
                },
            }
        return {"value_resolution": res, "timings": timings}

    async def _bind_concepts(self, state: SemantiqState) -> SemantiqState:
        bindings = bind_concepts(
            state["question"],
            state["model"],
            state["dataset_id"],
            catalog_entry=state.get("catalog_entry"),
            hints=state.get("ontology_hints"),
        )
        plan = build_query_plan(state["question"], bindings)
        return {"bindings": bindings, "query_plan": plan}

    async def _slice(self, state: SemantiqState) -> SemantiqState:
        return {"slice": select_slice(state["model"], state["question"], bindings=state.get("bindings"))}

    async def _plan(self, state: SemantiqState) -> SemantiqState:
        started = time.perf_counter()
        repair_patch: SemantiqState = {}
        if state.get("error"):
            err_class = state.get("error_class") or classify_dax_error(state["error"])
            counts = dict(state.get("repair_counts") or {})
            counts[err_class] = counts.get(err_class, 0) + 1
            repair_patch["repair_counts"] = counts
        prelude = f"QUESTION:\n{state['question']}\n\n"
        qplan = coerce_query_plan(state.get("query_plan"))
        bindings = state.get("bindings")
        resolution = state.get("value_resolution")
        if resolution is not None and getattr(resolution, "resolved", None):
            prelude += resolution.prompt() + "\n\n"
        if qplan:
            prelude += qplan.to_prompt() + "\n\n"
        if bindings and hasattr(bindings, "to_prompt"):
            prelude += bindings.to_prompt() + "\n\n"
        prior = state.get("prior_turn")
        if prior and prior.get("dax"):
            prelude += (
                "PREVIOUS TURN (the question may be a follow-up such as 'and for last month?'; reuse its grouping, "
                "filters and measure unless the new question changes them):\n"
                f"- question: {str(prior.get('question') or '')[:300]}\n"
                f"- DAX: {' '.join(str(prior['dax']).split())[:900]}\n\n"
            )
        user = prelude + f"SCHEMA:\n{state['slice'].to_prompt(state.get('data_connections') or '')}"
        if state.get("error"):
            previous = state["guard"].dax if state.get("guard") else ""
            user += f"\n\nPREVIOUS_QUERY:\n{previous}\n\nPREVIOUS_ERROR:\n{state['error']}"
        if not state.get("error"):
            skeleton = try_grouped_breakdown_dax(
                state["question"],
                qplan,
                bindings,
                state.get("model"),
            )
            if skeleton:
                dax, desc = skeleton
                plan = DaxPlan(
                    intent="assumed",
                    dax=dax,
                    assumptions=["deterministic grouped CALCULATE without equality on the split column"],
                    result_description=desc,
                )
                return {
                    **repair_patch,
                    "plan": plan,
                    "attempts": state.get("attempts", 0) + 1,
                    "error": None,
                    "timings": {**state["timings"], f"plan{state.get('attempts', 0) + 1}_ms": _ms(started)},
                }
        try:
            plan = await self.llm.complete_json(_prompt() + "\n\nBUSINESS CONTEXT:\n" + _context(), user, DaxPlan, max_tokens=1200)
        except LLMUnavailable as exc:
            return {"result": _failure("llm_unavailable", f"The language model is unavailable: {exc}")}
        qplan = coerce_query_plan(state.get("query_plan"))
        bindings = state.get("bindings")
        cleaned = sanitize_group_column_filters(plan.dax, qplan, bindings)
        if cleaned != plan.dax:
            plan = plan.model_copy(update={"dax": cleaned})
        return {
            **repair_patch,
            "plan": plan,
            "attempts": state.get("attempts", 0) + 1,
            "error": None,
            "timings": {**state["timings"], f"plan{state.get('attempts', 0) + 1}_ms": _ms(started)},
        }

    async def _guard(self, state: SemantiqState) -> SemantiqState:
        plan = state["plan"]
        if plan.intent == "ambiguous" and not state.get("date_retried") and _assume_event_date(state, plan):
            return {
                "error": "The user gave a calendar date and did not say reported. Use DATE_OF_INCIDENT or the incident/event date column. Set intent to assumed. Do not ask which date.",
                "date_retried": True,
            }
        if plan.intent == "unanswerable" and not state.get("date_retried") and _can_filter_by_date(state, plan):
            hints = "; ".join(state["slice"].date_filters)
            return {
                "error": f"DATE FILTERS already lists the column for this period. Rewrite the query with intent assumed. {hints}",
                "date_retried": True,
            }
        if plan.intent in ("ambiguous", "unanswerable") or not plan.dax.strip():
            return {"result": self._non_answer(state)}
        guard = dax_guard.validate(plan.dax, state["model"], max_rows=self.settings.pbi_max_rows)
        if not guard.ok:
            err = "; ".join(guard.errors)
            err_class = classify_dax_error(err)
            return {"guard": guard, "error": err, "error_class": err_class}
        qplan = coerce_query_plan(state.get("query_plan"))
        preserve_err = check_filter_preservation(
            guard.dax,
            qplan,
            state.get("bindings"),
            state.get("model"),
        )
        if preserve_err:
            return {"guard": guard, "error": preserve_err, "error_class": "filter_missing"}
        return {"guard": guard, "error_class": None}

    async def _execute(self, state: SemantiqState) -> SemantiqState:
        started = time.perf_counter()
        guard = state["guard"]
        try:
            data = await self.client.execute_dax(
                state["workspace_id"],
                state["dataset_id"],
                guard.dax,
            )
        except PowerBIError as exc:
            err = f"{exc}: {exc.detail or ''}"[:1500]
            err_class = classify_dax_error(err)
            if err_class == "permission":
                return {"result": _failure("permission_denied", err)}
            return {"error": err, "error_class": err_class}
        rows = data["rows"]
        truncated = len(rows) > self.settings.pbi_max_rows
        rows = rows[: self.settings.pbi_max_rows]
        plan = state["plan"]
        qplan = coerce_query_plan(state.get("query_plan"))
        qp_dump = qplan.model_dump() if qplan else None
        return {
            "result": {
                "status": "ok",
                "dax": state["plan"].dax.strip(),
                "executed_dax": guard.dax,
                "columns": data["columns"],
                "rows": rows,
                "row_count": len(rows),
                "truncated": truncated,
                "references": guard.references,
                "column_meta": build_column_meta(data["columns"], rows, state.get("model")),
                "assumptions": plan.assumptions,
                "result_description": plan.result_description,
                "model": {"workspaceId": state["workspace_id"], "datasetId": state["dataset_id"], "name": state["model"].name},
                "rls_user": state.get("user_email"),
                "confidence_components": {
                    "schema_match": guard.schema_match,
                    "query_success": 1.0,
                    "intent_clarity": INTENT_CLARITY[plan.intent],
                },
                "attempts": state.get("attempts", 1),
                "timings": {**state["timings"], "execute_ms": _ms(started)},
                "query_plan": qp_dump,
            }
        }

    async def _validate_result(self, state: SemantiqState) -> SemantiqState:
        started = time.perf_counter()
        result = state.get("result")
        bindings = state.get("bindings")
        if not result or not bindings or result.get("status") != "ok":
            return {}
        rows = result.get("rows") or []
        outcome = classify_execution(rows)
        outcome.planned_value = extract_primary_value(rows)
        qplan = coerce_query_plan(state.get("query_plan"))
        from .filter_preservation import mandatory_dimension_filters, mandatory_time_filter

        mandatory_time = mandatory_time_filter(qplan)
        mandatory_dims = mandatory_dimension_filters(qplan)
        check = validation_dax(bindings, state["plan"].dax, qplan)
        if check and outcome.status in {"zero", "ok"}:
            try:
                data = await self.client.execute_dax(state["workspace_id"], state["dataset_id"], check)
                outcome = reconcile_values(
                    outcome,
                    data.get("rows") or [],
                    mandatory_time_filter=mandatory_time,
                    mandatory_filters=mandatory_time or mandatory_dims,
                )
            except PowerBIError as exc:
                outcome = ValidationOutcome("validation_skipped", str(exc)[:200])
        if outcome.status == "filter_leakage":
            # The budget is checked BEFORE counting: ``_plan`` increments the class count when it repairs.
            # Counting here first made ``can_retry`` (count < budget 1) false, so no repair ever ran.
            counts = dict(state.get("repair_counts") or {})
            retry_allowed = can_retry("filter_leakage", counts, state.get("attempts", 0))
            counts["filter_leakage"] = counts.get("filter_leakage", 0) + (0 if retry_allowed else 1)
            result["validation"] = {
                "status": outcome.status,
                "message": outcome.message,
                "planned_value": outcome.planned_value,
                "validation_value": outcome.validation_value,
            }
            timings = {**state.get("timings", {}), "validate_ms": _ms(started)}
            if retry_allowed:
                # Clear ``result`` so the router sends us back to ``plan`` and the guard/execute
                # nodes are not short-circuited by a stale terminal result (the repair loop was dead
                # before: ``plan`` -> ``_after`` saw a result and ended the run).
                return {
                    "result": None,
                    "error": outcome.message,
                    "error_class": "filter_leakage",
                    "repair_counts": counts,
                    "timings": timings,
                }
            return {
                "result": {**result, "status": "query_failed", "message": outcome.message},
                "error": outcome.message,
                "error_class": "filter_leakage",
                "repair_counts": counts,
                "timings": timings,
            }
        if outcome.status == "assumed" and outcome.validation_value is not None:
            columns = result.get("columns") or ["Value"]
            col = columns[0] if columns else "ValidationCount"
            result = {
                **result,
                "status": "assumed",
                "rows": [{col: outcome.validation_value}],
                "row_count": 1,
                "assumptions": list(result.get("assumptions") or []) + [outcome.message],
            }
        result["validation"] = {
            "status": outcome.status,
            "message": outcome.message,
            "planned_value": outcome.planned_value,
            "validation_value": outcome.validation_value,
        }
        return {
            "result": result,
            "timings": {**state.get("timings", {}), "validate_ms": _ms(started)},
        }

    async def _give_up(self, state: SemantiqState) -> SemantiqState:
        log(logger, logging.WARNING, "semantiq_query_failed", attempts=state.get("attempts"), error=state.get("error"))
        result = _failure("query_failed", "I could not build a valid query for this question against the model.")
        result["errors"] = [state.get("error")]
        result["dax"] = state["plan"].dax if state.get("plan") else ""
        result["candidates"] = _candidate_names(state.get("slice"))
        return {"result": result}

    def _non_answer(self, state: SemantiqState) -> dict[str, Any]:
        plan = state["plan"]
        status = "needs_clarification" if plan.intent == "ambiguous" else "unanswerable"
        return {
            "status": status,
            "clarifying_question": plan.clarifying_question,
            "candidates": plan.candidates or _candidate_names(state.get("slice")),
            "missing": plan.missing,
            "confidence_components": {"schema_match": 1.0, "query_success": 0.0, "intent_clarity": 0.0},
        }

    # ------------------------------------------------------------ routing
    @staticmethod
    def _after(state: SemantiqState, ok_next: str) -> str:
        return END if state.get("result") else ok_next

    def _after_guard(self, state: SemantiqState) -> str:
        if state.get("result"):
            return END
        if state.get("error"):
            err_class = state.get("error_class") or classify_dax_error(state["error"])
            if can_retry(err_class, state.get("repair_counts") or {}, state.get("attempts", 0)):
                return "plan"
            return "give_up"
        return "execute"

    def _after_execute(self, state: SemantiqState) -> str:
        if state.get("result") and state["result"].get("status") == "ok" and state.get("bindings"):
            return "validate_result"
        if state.get("result"):
            return END
        if state.get("error"):
            err_class = state.get("error_class") or classify_dax_error(state["error"])
            if can_retry(err_class, state.get("repair_counts") or {}, state.get("attempts", 0)):
                return "plan"
            return "give_up"
        return "give_up"

    def _after_validate(self, state: SemantiqState) -> str:
        if state.get("error_class") == "filter_leakage" and state.get("error") and not state.get("result"):
            return "plan"
        if state.get("result") and state["result"].get("status") in {"ok", "assumed"}:
            return END
        return END

    def _build(self):
        graph = StateGraph(SemantiqState)
        graph.add_node("catalog_meta", self._catalog_meta)
        graph.add_node("load", self._load)
        graph.add_node("resolve_values", self._resolve_values)
        graph.add_node("bind_concepts", self._bind_concepts)
        graph.add_node("slice", self._slice)
        graph.add_node("validate_result", self._validate_result)
        graph.add_node("plan", self._plan)
        graph.add_node("guard", self._guard)
        graph.add_node("execute", self._execute)
        graph.add_node("give_up", self._give_up)
        # Vector DB first: keyword search -> (re-rank) -> targeted DAX. Anything it cannot answer confidently
        # continues to the full pipeline (catalog -> model read -> plan -> guard -> execute).
        graph.add_node("kw_search", self._kw_search)
        graph.add_node("kw_rerank", self._kw_rerank)
        graph.add_node("kw_dax", self._kw_dax)
        graph.add_edge(START, "kw_search")
        graph.add_conditional_edges(
            "kw_search",
            lambda s: "catalog_meta" if not s.get("kw_route") else ("kw_rerank" if s.get("kw_options") else "kw_dax"),
            ["catalog_meta", "kw_rerank", "kw_dax"],
        )
        graph.add_edge("kw_rerank", "kw_dax")
        graph.add_conditional_edges("kw_dax", lambda s: END if s.get("result") else "catalog_meta", [END, "catalog_meta"])
        graph.add_edge("catalog_meta", "load")
        graph.add_conditional_edges("load", lambda s: self._after(s, "resolve_values"), ["resolve_values", END])
        graph.add_conditional_edges("resolve_values", lambda s: self._after(s, "bind_concepts"), ["bind_concepts", END])
        graph.add_edge("bind_concepts", "slice")
        graph.add_edge("slice", "plan")
        graph.add_conditional_edges("plan", lambda s: self._after(s, "guard"), ["guard", END])
        graph.add_conditional_edges("guard", self._after_guard, ["plan", "execute", "give_up", END])
        graph.add_conditional_edges("execute", self._after_execute, ["validate_result", "plan", "give_up", END])
        graph.add_conditional_edges("validate_result", self._after_validate, ["plan", END])
        graph.add_edge("give_up", END)
        return graph.compile()


def _context() -> str:
    return (Path(__file__).parent / "prompts" / "context.md").read_text(encoding="utf-8")


def _assume_event_date(state: SemantiqState, plan: DaxPlan) -> bool:
    question = (state.get("question") or "").lower()
    if any(word in question for word in ("reported", "lodged", "submitted")):
        return False
    blob = " ".join(plan.candidates or []).upper()
    return "DATE_OF_INCIDENT" in blob or "INCIDENT" in blob


def _can_filter_by_date(state: SemantiqState, plan: DaxPlan) -> bool:
    sl = state.get("slice")
    if not sl or not sl.date_filters:
        return False
    text = f"{plan.missing or ''} {plan.clarifying_question or ''}".lower()
    return any(word in text for word in ("date", "time", "calendar", "period"))


def _failure(status: str, message: str) -> dict[str, Any]:
    return {
        "status": status,
        "message": message,
        "confidence_components": {"schema_match": 0.0, "query_success": 0.0, "intent_clarity": 0.0},
    }


def _candidate_names(slice_: SchemaSlice | None) -> list[str]:
    if not slice_:
        return []
    return [f"{m.table}[{m.name}]" for m in slice_.measures[:5]]


def _ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 1)
