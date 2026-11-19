"""N.O.V.A. MCP server (streamable HTTP, stateless) on /mcp, with /health and /health/ready."""

from __future__ import annotations

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

from . import AGENT_NAME, PERSONALITY, ROLE, TAGLINE, TECHNICAL_NAME
from .agent import NovaAgent
from .notes import build_note
from .settings import get_settings
from .visual_spec import recommend

logger = logging.getLogger(__name__)

mcp = FastMCP(
    TECHNICAL_NAME,
    instructions=f"{AGENT_NAME} - {ROLE}. {PERSONALITY}. {TAGLINE}",
    stateless_http=True,
    json_response=True,
)

MAX_ROWS = 2000


@lru_cache
def _agent() -> NovaAgent:
    settings = get_settings()
    return NovaAgent(settings, LLMClient(settings))


@mcp.tool()
async def generate_visual(
    question: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    preferred_type: str | None = None,
    title: str | None = None,
    column_meta: list[dict[str, Any]] | None = None,
    result_description: str | None = None,
    intent: str | None = None,
) -> dict[str, Any]:
    """Build a chart / KPI spec (portal ChartPayload / KpiPayload) from query rows. Values are copied, never generated.

    Optional context from SemantIQ: ``column_meta`` (per column: role dimension|measure|date, format, unit),
    ``result_description`` and the analysis ``intent``. They refine roles, labels, KPI formatting and chart choice.
    """
    if len(rows) > MAX_ROWS:
        return {"status": "rejected", "message": f"At most {MAX_ROWS} rows are accepted"}
    spec = await _agent().generate(
        question,
        columns,
        rows,
        preferred=preferred_type,
        title=title,
        column_meta=column_meta,
        result_description=result_description,
        intent=intent,
    )
    return {"status": "ok", "visual": spec.model_dump(exclude_none=True)}


@mcp.tool()
async def recommend_visual(question: str, columns: list[str], rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Rank the visual kinds that suit this result shape (no LLM)."""
    allowed, x, ys = recommend(question, columns, rows[:MAX_ROWS])
    return {"status": "ok", "allowed": allowed, "x_column": x, "y_columns": ys}


@mcp.tool()
async def generate_note(
    title: str,
    text: str = "",
    background: str | None = None,
    color: str | None = None,
    font_size: int | None = None,
    font_family: str | None = None,
    bold: bool | None = None,
    italic: bool | None = None,
) -> dict[str, Any]:
    """Create a note (title, text and look) for the Visual box. Notes hold no data, so no model is read."""
    note = build_note(
        title,
        text,
        {
            "background": background,
            "color": color,
            "fontSize": font_size,
            "fontFamily": font_family,
            "bold": bold,
            "italic": italic,
        },
    )
    return {"status": "ok", "note": note}


@mcp.custom_route("/health", methods=["GET"])
async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "agent": TECHNICAL_NAME, "tagline": TAGLINE})


@mcp.custom_route("/health/ready", methods=["GET"])
async def ready(_: Request) -> JSONResponse:
    # N.O.V.A. works without the LLM (rule-based choice), so it is always ready.
    return JSONResponse({"status": "ready", "checks": {"llm_configured": get_settings().llm_configured}})


def create_app():
    settings = get_settings()
    app = mcp.streamable_http_app()
    app.add_middleware(SharedSecretMiddleware, secret=settings.mcp_secret())
    return app


def main() -> None:
    settings = get_settings()
    configure_logging(TECHNICAL_NAME, settings.log_level)
    if not settings.mcp_secret():
        log(logger, logging.WARNING, "mcp_shared_secret_missing", note="MCP endpoint is unauthenticated; set MCP_SHARED_SECRET")
    uvicorn.run(create_app(), host=settings.host, port=settings.port, log_level=settings.log_level.lower(), access_log=False)


if __name__ == "__main__":
    main()
