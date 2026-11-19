"""pbi_semantic_metadata index and disk hydrate."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pbi_semantiq_agent.catalog_disk import CatalogStore, menu_slug, slugify
from pbi_semantiq_agent.metadata import SemanticModel, Table, Column, Measure, model_from_dict


def test_slugify_and_menu_path():
    assert slugify("PO Spend Report") == "po-spend-report"
    assert menu_slug("QHSE > Audit > Vessel") == "qhse/audit/vessel"


def test_model_roundtrip():
    model = SemanticModel(
        "ws-1",
        "ds-1",
        "Spend",
        [Table("Vendor", columns=[Column("Name")], measures=[Measure("Spend", "Vendor")])],
        [],
    )
    data = model.to_dict()
    back = model_from_dict(data)
    assert back.dataset_id == "ds-1"
    assert back.measure_names() == {"spend"}


def test_catalog_search_and_resolve(tmp_path: Path):
    root = tmp_path / "meta"
    root.mkdir()
    reports = [
        {
            "portal_id": "p1",
            "title": "PO Spend",
            "menu_path": "Finance > Spend",
            "workspace_id": "11111111-1111-4111-8111-111111111111",
            "dataset_id": "22222222-2222-4222-8222-222222222222",
            "measure_names": ["Total Spend", "Vendor Count"],
            "table_names": ["Vendor"],
        }
    ]
    (root / "catalog.json").write_text(json.dumps({"reports": reports}), encoding="utf-8")
    store = CatalogStore(root)
    hit = store.resolve_ids("show po spend by vendor")
    assert hit and hit["title"] == "PO Spend"
    matches = store.search("spend vendor")
    assert matches and matches[0]["dataset_id"].startswith("2222")

    rid = "33333333-3333-4333-8333-333333333333"
    reports[0]["report_id"] = rid
    (root / "catalog.json").write_text(json.dumps({"reports": reports}), encoding="utf-8")
    store = CatalogStore(root)
    resolved = store.resolve_report_dataset(reports[0]["workspace_id"], rid)
    assert resolved and resolved["dataset_id"] == reports[0]["dataset_id"]


def test_load_model_from_disk(tmp_path: Path):
    root = tmp_path / "meta"
    model_dir = root / "ws" / "fin" / "report" / "model"
    model_dir.mkdir(parents=True)
    ws, ds = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
    schema = SemanticModel(ws, ds, "M", [Table("T", measures=[Measure("KPI", "T")])], []).to_dict()
    (model_dir / "model.json").write_text(json.dumps(schema), encoding="utf-8")
    (root / "catalog.json").write_text(
        json.dumps(
            {
                "reports": [
                    {
                        "workspace_id": ws,
                        "dataset_id": ds,
                        "disk_path": "ws/fin/report/model",
                        "title": "R",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    store = CatalogStore(root)
    loaded = store.load_model_from_disk(ws, ds)
    assert loaded and loaded.all_measures()[0].name == "KPI"
