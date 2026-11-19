"""INFO.VIEW.HIERARCHIES is optional when loading a semantic model."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from pbi_semantiq_agent.metadata import load_model_extended


@pytest.mark.asyncio
async def test_load_model_continues_when_hierarchies_unsupported():
    rows_tables = [{"Name": "Sales"}]
    rows_columns = [{"Table": "Sales", "Name": "Amount", "DataType": "Double"}]
    rows_measures = [{"Table": "Sales", "Name": "Total", "Expression": "SUM(Sales[Amount])"}]
    rows_relationships: list[dict] = []

    client = AsyncMock()
    async def side_effect(ws, ds, dax, *, user=None):
        if "TABLES" in dax:
            return {"rows": rows_tables}
        if "COLUMNS" in dax:
            return {"rows": rows_columns}
        if "MEASURES" in dax:
            return {"rows": rows_measures}
        if "RELATIONSHIPS" in dax:
            return {"rows": rows_relationships}
        if "HIERARCHIES" in dax:
            raise RuntimeError("INFO.VIEW.HIERARCHIES not supported")
        raise AssertionError(dax)

    client.execute_dax_with_rls_retry = AsyncMock(side_effect=side_effect)

    model, hierarchies, raw = await load_model_extended(client, "ws", "ds", user=None, name="M")
    assert model.dataset_id == "ds"
    assert model.table("Sales") is not None
    assert hierarchies == []
    assert "hierarchies" in raw and raw["hierarchies"] == []
    assert client.execute_dax_with_rls_retry.await_count == 5
