"""Combined SMART process exposes orchestrator routes and mounted MCP agents."""

from __future__ import annotations

import httpx
import pytest

from smart_orchestrator.combined import create_combined_app
from smart_orchestrator.settings import OrchestratorSettings


@pytest.fixture
def combined_settings(monkeypatch):
    monkeypatch.setenv("PORTAL_JWT_SECRET", "test-portal-secret")
    monkeypatch.setenv("MCP_SHARED_SECRET", "test-mcp-secret")
    monkeypatch.setenv("LLM_API_KEY", "")
    from pbi_nova_visual_generator.settings import get_settings as nova_settings
    from pbi_semantiq_agent.settings import get_settings as sem_settings
    from smart_orchestrator.settings import get_settings

    get_settings.cache_clear()
    sem_settings.cache_clear()
    nova_settings.cache_clear()
    yield OrchestratorSettings(_env_file=None)
    get_settings.cache_clear()
    sem_settings.cache_clear()
    nova_settings.cache_clear()


async def test_combined_app_exposes_orchestrator_and_mcp_mounts(combined_settings):
    app = create_combined_app(combined_settings)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://smart") as client:
        assert (await client.get("/health")).status_code == 200
        assert (await client.get("/mcp/semantiq/health")).status_code == 200
        assert (await client.get("/mcp/nova/health")).status_code == 200
        assert (await client.post("/mcp/semantiq/mcp", json={})).status_code == 401
        assert (await client.post("/mcp/nova/mcp", json={})).status_code == 401
