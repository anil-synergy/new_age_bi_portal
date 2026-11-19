"""Single uvicorn process: SMART orchestrator + SemantIQ + N.O.V.A. MCP mounts."""

from __future__ import annotations

from contextlib import asynccontextmanager

from pbi_nova_visual_generator.server import create_app as create_nova_app
from pbi_nova_visual_generator.server import mcp as nova_mcp
from pbi_semantiq_agent.server import create_app as create_semantiq_app
from pbi_semantiq_agent.server import mcp as sem_mcp
from pbi_semantiq_agent.sync_scheduler import background_sync

from .app import create_app as create_orchestrator_app
from .settings import OrchestratorSettings, get_settings


def create_combined_app(settings: OrchestratorSettings | None = None):
    settings = settings or get_settings()
    app = create_orchestrator_app(settings)
    app.mount("/mcp/semantiq", create_semantiq_app())
    app.mount("/mcp/nova", create_nova_app())
    inner = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        async with inner(application):
            async with sem_mcp.session_manager.run():
                async with nova_mcp.session_manager.run():
                    async with background_sync():
                        yield

    app.router.lifespan_context = lifespan
    return app
