"""MCP tool contracts (names and required arguments the orchestrator relies on) and the shared-secret guard."""

from __future__ import annotations

import httpx

from pbi_nova_visual_generator import server as nova_server
from pbi_semantiq_agent import server as semantiq_server


async def _tools(mcp) -> dict[str, dict]:
    return {t.name: t.inputSchema for t in await mcp.list_tools()}


async def test_semantiq_tools():
    tools = await _tools(semantiq_server.mcp)
    assert set(tools) >= {
        "list_workspaces",
        "list_semantic_models",
        "list_reports",
        "resolve_report_model",
        "get_model_schema",
        "search_model",
        "search_catalog_metadata",
        "sync_semantic_metadata",
        "semantic_metadata_status",
        "retry_failed_extractions",
        "run_dax",
        "validate_dax",
        "answer_question",
        "get_dataset_freshness",
    }
    assert set(tools["get_dataset_freshness"]["required"]) == {"workspace_id", "dataset_id"}
    assert set(tools["list_reports"]["required"]) == {"workspace_id"}
    assert set(tools["list_semantic_models"]["required"]) == {"workspace_id"}
    assert set(tools["answer_question"]["required"]) == {"question", "workspace_id", "dataset_id", "user_email"}
    assert set(tools["run_dax"]["required"]) == {"workspace_id", "dataset_id", "dax", "user_email"}
    assert set(tools["search_model"]["required"]) == {"workspace_id", "dataset_id", "query"}
    assert set(tools["resolve_report_model"]["required"]) == {"workspace_id", "report_id"}


async def test_nova_tools():
    tools = await _tools(nova_server.mcp)
    assert set(tools) >= {"generate_visual", "recommend_visual"}
    assert set(tools["generate_visual"]["required"]) == {"question", "columns", "rows"}


async def test_nova_generate_visual_contract():
    out = await nova_server.generate_visual(
        question="spend by vendor",
        columns=["Vendor", "Spend"],
        rows=[{"Vendor": "A", "Spend": 2.0}, {"Vendor": "B", "Spend": 1.0}],
    )
    assert out["status"] == "ok"
    visual = out["visual"]
    assert visual["kind"] == "chart"
    assert set(visual["chart"]) == {"type", "labels", "datasets"}
    assert visual["chart"]["datasets"][0] == {"label": "Spend", "data": [2.0, 1.0]}


async def test_nova_rejects_oversized_input():
    out = await nova_server.generate_visual(question="q", columns=["x"], rows=[{"x": 1}] * 2001)
    assert out["status"] == "rejected"


async def test_semantiq_reports_missing_credentials(monkeypatch):
    # Env vars override the local .env, so this stays a missing-credentials check on a configured machine.
    for key in ("PBI_TENANT_ID", "PBI_CLIENT_ID", "PBI_CLIENT_SECRET"):
        monkeypatch.setenv(key, "")
    semantiq_server.get_settings.cache_clear()
    semantiq_server._agent.cache_clear()
    try:
        out = await semantiq_server.list_workspaces()
        assert out["status"] == "error" and "not configured" in out["message"]
    finally:
        semantiq_server.get_settings.cache_clear()
        semantiq_server._agent.cache_clear()


async def test_registry_reports_unreachable_agent_cleanly():
    from smart_orchestrator.mcp_clients import AgentCallError, AgentRegistry

    registry = AgentRegistry({"nova": "http://127.0.0.1:9/mcp"}, secret="x", timeout_s=5)
    try:
        assert await registry.health() == {"nova": False}
        try:
            await registry.call("nova", "generate_visual", {})
        except AgentCallError as exc:
            assert "ExceptionGroup" not in str(exc)
        else:
            raise AssertionError("expected AgentCallError")
        try:
            await registry.call("unknown", "x", {})
        except AgentCallError as exc:
            assert "not registered" in str(exc)
    finally:
        await registry.aclose()


async def test_shared_secret_guard(monkeypatch):
    monkeypatch.setenv("MCP_SHARED_SECRET", "s3cret-value")
    nova_server.get_settings.cache_clear()
    try:
        app = nova_server.create_app()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://nova") as client:
            assert (await client.get("/health")).status_code == 200
            assert (await client.post("/mcp", json={})).status_code == 401
            assert (await client.post("/mcp", json={}, headers={"Authorization": "Bearer wrong"})).status_code == 401
    finally:
        nova_server.get_settings.cache_clear()
