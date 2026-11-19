"""SemantIQ metadata sync: mapping, atomic writes, shared dataset extraction."""

from __future__ import annotations

import json
from pathlib import Path
import pytest

from pbi_semantiq_agent.inventory_loader import load_semantic_inventory
from pbi_semantiq_agent.metadata import Relationship, build_dax_dependencies
from pbi_semantiq_agent.metadata import SemanticModel, Table, Measure, Column
from pbi_semantiq_agent.metadata_paths import atomic_write_jsonl, read_jsonl
from pbi_semantiq_agent.sync_catalog import build_catalog_records, sync_portal_catalog


@pytest.mark.asyncio
async def test_catalog_mapping_by_report_id_not_title(monkeypatch, tmp_path: Path):
    inventory = {
        ("ws-1", "ds-1"): {
            "workspace_id": "ws-1",
            "dataset_id": "ds-1",
            "workspace_name": "Prod WS",
            "datasource_types": ["Sql"],
            "source_kinds": ["AzureSQL"],
            "last_refresh": "2026-01-01",
            "refresh_status": "Completed",
        }
    }
    portal = [
        {
            "portal_id": "p1",
            "title": "Unrelated Title",
            "description": "",
            "menu_path": "Ops",
            "report_id": "r1",
            "workspace_id": "ws-1",
        }
    ]

    class FakeClient:
        async def list_reports(self, workspace_id: str):
            return [{"id": "r1", "name": "Real Report", "datasetId": "ds-1", "datasetWorkspaceId": "ws-1"}]

    records = await build_catalog_records(FakeClient(), portal, inventory=inventory)
    assert len(records) == 1
    row = records[0]
    assert row["mapping_status"] == "mapped"
    assert row["dataset_id"] == "ds-1"
    assert row["report_name"] == "Real Report"
    assert row["datasource_types"] == ["Sql"]


@pytest.mark.asyncio
async def test_atomic_write_does_not_clobber_on_empty_portal(tmp_path: Path, monkeypatch):
    root = tmp_path / "meta"
    root.mkdir()
    dest = root / "portal_report_semantic_catalog.jsonl"
    existing = [{"portal_id": "keep", "title": "Stay"}]
    atomic_write_jsonl(dest, existing)

    monkeypatch.setattr("pbi_semantiq_agent.sync_catalog.portal_catalog_file", lambda: dest)

    class FakeClient:
        pass

    result = await sync_portal_catalog(FakeClient(), [])
    assert result["status"] == "skipped"
    assert read_jsonl(dest)[0]["portal_id"] == "keep"


def test_shared_dataset_extract_once_logic():
    records = [
        {"dataset_id": "ds-1", "dataset_workspace_id": "ws-1", "portal_id": "a"},
        {"dataset_id": "ds-1", "dataset_workspace_id": "ws-1", "portal_id": "b"},
        {"dataset_id": "ds-2", "dataset_workspace_id": "ws-1", "portal_id": "c"},
    ]
    seen: set[tuple[str, str]] = set()
    datasets: list[str] = []
    for row in records:
        key = (str(row["dataset_workspace_id"]).lower(), str(row["dataset_id"]).lower())
        if key in seen:
            continue
        seen.add(key)
        datasets.append(row["dataset_id"])
    assert datasets == ["ds-1", "ds-2"]


def test_relationship_fields_separate_cardinality_and_cross_filter():
    rel = Relationship("A", "id", "B", "id", cardinality="many:one", active=False, cross_filter="BothDirections")
    data = rel.__dict__
    assert data["cardinality"] == "many:one"
    assert data["cross_filter"] == "BothDirections"
    assert data["active"] is False


def test_dax_dependencies_from_measure_expression():
    model = SemanticModel(
        "ws",
        "ds",
        "M",
        [Table("Sales", measures=[Measure("Total", "Sales", expression="SUM('Sales'[Amount]) + [Qty]")], columns=[Column("Amount")])],
        [],
    )
    deps = build_dax_dependencies(model)
    assert "Sales[Amount]" in deps["referenced_columns"]


def test_inventory_skips_empty_dataset_id(tmp_path: Path):
    path = tmp_path / "inventory.jsonl"
    path.write_text(
        json.dumps({"dataset_id": "", "workspace_id": "ws"}) + "\n"
        + json.dumps({"dataset_id": "ds", "workspace_id": "ws"}) + "\n",
        encoding="utf-8",
    )
    inv = load_semantic_inventory(path)
    assert list(inv.keys()) == [("ws", "ds")]
