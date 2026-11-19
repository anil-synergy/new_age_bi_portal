"""INFO.VIEW optional shards match XMLA_Test (measures / relationships may fail)."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from pbi_semantiq_agent.metadata import load_model_extended
from pbi_semantiq_agent.powerbi_client import PowerBIError


@pytest.mark.asyncio
async def test_load_model_continues_when_measures_or_relationships_fail():
    rows_tables = [{"Name": "Incidents"}]
    rows_columns = [{"Table": "Incidents", "Name": "DATE_OF_INCIDENT", "DataType": "DateTime"}]

    client = AsyncMock()

    async def side_effect(ws, ds, dax, *, user=None):
        if "TABLES" in dax:
            return {"rows": rows_tables}
        if "COLUMNS" in dax:
            return {"rows": rows_columns}
        if "MEASURES" in dax:
            raise PowerBIError("unsupported")
        if "RELATIONSHIPS" in dax:
            raise PowerBIError("unsupported")
        if "HIERARCHIES" in dax:
            raise PowerBIError("unsupported")
        raise AssertionError(dax)

    client.execute_dax_with_rls_retry = AsyncMock(side_effect=side_effect)

    model, hierarchies, raw = await load_model_extended(client, "ws", "ds", user=None, name="Incident")
    assert model.table("Incidents") is not None
    assert raw["measures"] == []
    assert raw["relationships"] == []
    assert hierarchies == []
    assert client.execute_dax_with_rls_retry.await_count == 5