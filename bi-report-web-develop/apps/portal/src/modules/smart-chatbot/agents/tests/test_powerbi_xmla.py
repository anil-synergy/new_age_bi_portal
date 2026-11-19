"""Power BI client: XMLA DAX path and REST name resolution."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import SecretStr

from pbi_semantiq_agent.powerbi_client import PowerBIClient, PowerBIError, clean_key
from pbi_semantiq_agent.settings import SemantiqSettings
from pbi_semantiq_agent import xmla_client


def _settings() -> SemantiqSettings:
    return SemantiqSettings(
        _env_file=None,
        pbi_tenant_id="tenant",
        pbi_client_id="client",
        pbi_client_secret=SecretStr("secret"),
    )


@pytest.fixture
def client() -> PowerBIClient:
    return PowerBIClient(_settings())


async def test_execute_dax_uses_xmla_runner_not_rest_post(client: PowerBIClient):
    calls: list[tuple[str, str]] = []
    xmla_calls: list[dict[str, Any]] = []

    async def fake_request(method: str, path: str, *, json: Any = None):
        calls.append((method, path))
        if method == "GET" and path == "/groups/ws-1":
            return {"id": "ws-1", "name": "My Workspace", "isOnDedicatedCapacity": True}
        if method == "GET" and path == "/groups/ws-1/datasets/ds-1":
            return {"id": "ds-1", "name": "Injury"}
        raise AssertionError(f"unexpected REST call {method} {path}")

    def fake_xmla(**kwargs: Any) -> dict[str, Any]:
        xmla_calls.append(kwargs)
        return {"columns": ["Spend"], "rows": [{"Spend": 100}]}

    client._request = fake_request  # type: ignore[method-assign]
    client._xmla_runner = fake_xmla

    async def fake_token() -> str:
        return "token"

    client._access_token = fake_token  # type: ignore[method-assign]

    out = await client.execute_dax("ws-1", "ds-1", "EVALUATE ROW(\"x\", 1)")

    assert out == {"columns": ["Spend"], "rows": [{"Spend": 100}]}
    assert all(m == "GET" for m, _ in calls)
    assert not any("executeQueries" in p for _, p in calls)
    assert xmla_calls[0]["workspace_name"] == "My Workspace"
    assert xmla_calls[0]["catalog"] == "Injury"
    assert xmla_calls[0]["dax"].startswith("EVALUATE")


async def test_execute_dax_attempts_xmla_when_capacity_flag_false(client: PowerBIClient):
    xmla_calls: list[dict[str, Any]] = []

    async def fake_request(method: str, path: str, *, json: Any = None):
        if path == "/groups/ws-1":
            return {"id": "ws-1", "name": "Shared", "isOnDedicatedCapacity": False}
        if path == "/groups/ws-1/datasets/ds-1":
            return {"id": "ds-1", "name": "Incident"}
        raise AssertionError(path)

    def fake_xmla(**kwargs: Any) -> dict[str, Any]:
        xmla_calls.append(kwargs)
        return {"columns": ["x"], "rows": [{"x": 1}]}

    client._request = fake_request  # type: ignore[method-assign]
    client._xmla_runner = fake_xmla

    async def fake_token() -> str:
        return "token"

    client._access_token = fake_token  # type: ignore[method-assign]

    out = await client.execute_dax("ws-1", "ds-1", "EVALUATE ROW(\"x\", 1)")
    assert out["rows"] == [{"x": 1}]
    assert xmla_calls and xmla_calls[0]["workspace_name"] == "Shared"
    assert not hasattr(xmla_client, "_dbg")


def test_clean_key_strips_table_prefix():
    assert clean_key("Vendor[Spend]") == "Spend"


def test_load_adomd_is_safe_under_concurrent_first_use():
    from concurrent.futures import ThreadPoolExecutor

    pytest.importorskip("pythonnet")
    xmla_client._ADOMD = None
    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(lambda _: xmla_client._load_adomd(), range(5)))
    assert all(r is results[0] for r in results)
    assert results[0][0].__name__ == "AdomdConnection"


def test_build_connection_string_sp_only():
    conn = xmla_client.build_connection_string(
        workspace_name="Embedded PBI Portal",
        catalog="Injury",
        tenant_id="t",
        client_id="c",
        client_secret="s",
    )
    assert "powerbi://api.powerbi.com" in conn
    assert "Initial Catalog=Injury;" in conn
    assert "User ID=app:c@t;" in conn
    assert "EffectiveUserName" not in conn
