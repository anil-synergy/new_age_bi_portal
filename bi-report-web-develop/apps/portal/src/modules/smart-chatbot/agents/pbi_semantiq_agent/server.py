"""SemantIQ MCP server (streamable HTTP, stateless) on /mcp, with /health and /health/ready."""

from __future__ import annotations

import asyncio
import logging
from functools import lru_cache
from typing import Any

import uvicorn
from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from smart_common.llm import LLMClient
from smart_common.logging import configure_logging, log
from smart_common.mcp_auth import SharedSecretMiddleware

from . import DESCRIPTION, DISPLAY_NAME, TECHNICAL_NAME, dax_guard
from .agent import SemantiqAgent
from .catalog_disk import get_catalog_store
from .metadata import search as search_model_items
from .powerbi_client import PowerBIClient, PowerBIError
from .settings import get_settings
from .sync_runner import retry_failed, run_sync, status_snapshot
from .sync_scheduler import background_sync

logger = logging.getLogger(__name__)

mcp = FastMCP(TECHNICAL_NAME, instructions=f"{DISPLAY_NAME}: {DESCRIPTION}", stateless_http=True, json_response=True)


@lru_cache
def _agent() -> SemantiqAgent:
    settings = get_settings()
    return SemantiqAgent(settings, PowerBIClient(settings), LLMClient(settings))


def _error(exc: Exception) -> dict[str, Any]:
    log(logger, logging.WARNING, "semantiq_tool_error", error=type(exc).__name__, message=str(exc))
    return {"status": "error", "message": str(exc)}


@mcp.tool()
async def list_workspaces() -> dict[str, Any]:
    """List the Power BI workspaces SemantIQ is allowed to read."""
    try:
        return {"status": "ok", "workspaces": await _agent().client.list_workspaces()}
    except PowerBIError as exc:
        return _error(exc)


@mcp.tool()
async def list_semantic_models(workspace_id: str) -> dict[str, Any]:
    """List semantic models (datasets) in a workspace."""
    try:
        return {"status": "ok", "models": await _agent().client.list_datasets(workspace_id)}
    except PowerBIError as exc:
        return _error(exc)


@mcp.tool()
async def list_reports(workspace_id: str) -> dict[str, Any]:
    """List Power BI reports in a workspace, including the semantic model behind each report."""
    try:
        return {"status": "ok", "reports": await _agent().client.list_reports(workspace_id)}
    except PowerBIError as exc:
        return _error(exc)


@mcp.tool()
async def resolve_report_model(workspace_id: str, report_id: str) -> dict[str, Any]:
    """Find the semantic model (dataset) behind a Power BI report (portal catalog, then inventory, then REST)."""
    resolved = get_catalog_store().resolve_report_dataset(workspace_id, report_id)
    if resolved and resolved.get("dataset_id"):
        return {
            "status": "ok",
            "report": {
                "id": report_id,
                "name": resolved.get("title"),
                "datasetId": resolved["dataset_id"],
                "datasetWorkspaceId": resolved.get("dataset_workspace_id") or workspace_id,
            },
            "source": resolved.get("source"),
            "mapping_status": resolved.get("mapping_status"),
        }
    try:
        return {"status": "ok", "report": await _agent().client.get_report(workspace_id, report_id), "source": "powerbi_rest"}
    except PowerBIError as exc:
        return _error(exc)


@mcp.tool()
async def get_dataset_freshness(workspace_id: str, dataset_id: str) -> dict[str, Any]:
    """When the semantic model's data was last refreshed (empty for DirectQuery models without refresh history)."""
    try:
        return {"status": "ok", "freshness": await _agent().client.get_dataset_freshness(workspace_id, dataset_id)}
    except PowerBIError as exc:
        return _error(exc)


@mcp.tool()
async def search_catalog_metadata(query: str, limit: int = 15) -> dict[str, Any]:
    """Search portal report semantic catalog (pages, visuals, measures, menu paths)."""
    hits = get_catalog_store().search(query, limit=max(1, min(limit, 50)))
    return {"status": "ok", "matches": hits, "count": len(hits)}


@mcp.tool()
async def sync_semantic_metadata(mode: str = "incremental") -> dict[str, Any]:
    """Run metadata sync (portal catalog + report/model artifacts). mode: full | incremental."""
    if mode not in {"full", "incremental"}:
        return {"status": "error", "message": "mode must be full or incremental"}
    try:
        return await run_sync(mode)
    except Exception as exc:  # noqa: BLE001
        return _error(exc)


@mcp.tool()
async def semantic_metadata_status() -> dict[str, Any]:
    """Last sync state and portal catalog record counts."""
    return status_snapshot()


@mcp.tool()
async def retry_failed_extractions() -> dict[str, Any]:
    """Retry report/model extractions that failed in the previous sync."""
    try:
        return await retry_failed()
    except Exception as exc:  # noqa: BLE001
        return _error(exc)


@mcp.tool()
async def get_model_schema(workspace_id: str, dataset_id: str, user_email: str | None = None, include_expressions: bool = False) -> dict[str, Any]:
    """Tables, columns, measures and relationships of a semantic model (hidden objects excluded)."""
    try:
        model = await _agent().get_model(workspace_id, dataset_id, user_email)
        return {"status": "ok", "schema": model.to_dict(include_expressions=include_expressions)}
    except PowerBIError as exc:
        return _error(exc)


@mcp.tool()
async def search_model(workspace_id: str, dataset_id: str, query: str, user_email: str | None = None, limit: int = 20) -> dict[str, Any]:
    """Rank tables, columns and measures relevant to a business term or question."""
    try:
        model = await _agent().get_model(workspace_id, dataset_id, user_email)
        return {"status": "ok", "matches": search_model_items(model, query, limit=max(1, min(limit, 50))), "stats": model.stats()}
    except PowerBIError as exc:
        return _error(exc)


@mcp.tool()
async def validate_dax(workspace_id: str, dataset_id: str, dax: str, user_email: str | None = None) -> dict[str, Any]:
    """Static DAX validation against live schema (no execution). user_email is audit-only (service principal path)."""
    agent = _agent()
    try:
        model = await agent.get_model(workspace_id, dataset_id, user_email)
        guard = dax_guard.validate(dax, model, max_rows=agent.settings.pbi_max_rows)
        if not guard.ok:
            return {"status": "rejected", "errors": guard.errors, "references": guard.references}
        return {"status": "ok", "dax": guard.dax, "references": guard.references, "schema_match": guard.schema_match}
    except PowerBIError as exc:
        return _error(exc)


@mcp.tool()
async def run_dax(workspace_id: str, dataset_id: str, dax: str, user_email: str) -> dict[str, Any]:
    """Run a validated read-only DAX query over XMLA as the service principal (user_email is audit-only; no per-user RLS)."""
    agent = _agent()
    try:
        model = await agent.get_model(workspace_id, dataset_id, user_email)
        guard = dax_guard.validate(dax, model, max_rows=agent.settings.pbi_max_rows)
        if not guard.ok:
            return {"status": "rejected", "errors": guard.errors}
        data = await agent.client.execute_dax(workspace_id, dataset_id, guard.dax)
        rows = data["rows"][: agent.settings.pbi_max_rows]
        return {
            "status": "ok",
            "columns": data["columns"],
            "rows": rows,
            "row_count": len(rows),
            "truncated": len(data["rows"]) > len(rows),
            "references": guard.references,
        }
    except PowerBIError as exc:
        return _error(exc)


@mcp.tool()
async def answer_question(
    question: str,
    workspace_id: str,
    dataset_id: str,
    user_email: str,
    report_id: str | None = None,
    ontology_hints: dict | None = None,
    prior_turn: dict | None = None,
) -> dict[str, Any]:
    """Answer a business question: schema slice, DAX, guard, XMLA execute (service principal), return rows + evidence.

    ``prior_turn`` ({question, dax}) is the previous answer in the same conversation on this model; it lets
    follow-ups such as "and for last month?" reuse the earlier grouping and filters.
    """
    try:
        return await _agent().answer(
            question,
            workspace_id,
            dataset_id,
            user_email,
            report_id=report_id,
            ontology_hints=ontology_hints,
            prior_turn=prior_turn,
        )
    except PowerBIError as exc:
        return _error(exc)
    except Exception as exc:  # noqa: BLE001
        log(logger, logging.ERROR, "answer_question_failed", error=type(exc).__name__, message=str(exc)[:500])
        return {"status": "error", "message": str(exc)[:500]}


@mcp.custom_route("/health", methods=["GET"])
async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "agent": TECHNICAL_NAME})


@mcp.custom_route("/admin/semantic-metadata/sync", methods=["POST"])
async def admin_sync(request: Request) -> JSONResponse:
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    mode = str((body or {}).get("mode") or "incremental")
    if mode not in {"full", "incremental"}:
        return JSONResponse({"status": "error", "message": "mode must be full or incremental"}, status_code=400)
    result = await run_sync(mode)
    return JSONResponse(result, status_code=200 if result.get("status") == "ok" else 500)


@mcp.custom_route("/admin/semantic-metadata/status", methods=["GET"])
async def admin_status(_: Request) -> JSONResponse:
    return JSONResponse(status_snapshot())


@mcp.custom_route("/health/ready", methods=["GET"])
async def ready(_: Request) -> JSONResponse:
    settings = get_settings()
    checks: dict[str, Any] = {"powerbi_configured": settings.pbi_configured, "llm_configured": settings.llm_configured}
    if settings.pbi_configured:
        try:
            await _agent().client._access_token()
            checks["powerbi_token"] = True
        except PowerBIError:
            checks["powerbi_token"] = False
    healthy = all(checks.values())
    return JSONResponse({"status": "ready" if healthy else "not_ready", "checks": checks}, status_code=200 if healthy else 503)


def create_app(*, with_scheduler: bool = False):
    """``with_scheduler`` wraps the app lifespan with the periodic metadata sync (standalone mode only).

    In the combined app the mounted sub-app's lifespan never runs, so ``combined.py`` starts the
    scheduler itself.
    """
    settings = get_settings()
    app = mcp.streamable_http_app()
    app.add_middleware(SharedSecretMiddleware, secret=settings.mcp_secret())
    if with_scheduler:
        from contextlib import asynccontextmanager

        inner = app.router.lifespan_context

        @asynccontextmanager
        async def lifespan(application):
            async with inner(application):
                async with background_sync():
                    yield

        app.router.lifespan_context = lifespan
    return app


def main() -> None:
    settings = get_settings()
    configure_logging(TECHNICAL_NAME, settings.log_level)
    if not settings.mcp_secret():
        log(logger, logging.WARNING, "mcp_shared_secret_missing", note="MCP endpoint is unauthenticated; set MCP_SHARED_SECRET")
    uvicorn.run(create_app(with_scheduler=True), host=settings.host, port=settings.port, log_level=settings.log_level.lower(), access_log=False)


if __name__ == "__main__":
    main()
