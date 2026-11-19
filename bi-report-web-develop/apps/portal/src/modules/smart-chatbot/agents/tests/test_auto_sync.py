"""Automatic metadata refresh: portal catalogue client, inventory merge, ontology bindings, sync gating."""

from __future__ import annotations

import json
import os
from pathlib import Path

import jwt
import pytest

from pbi_semantiq_agent import ontology, ontology_builder, portal_catalog_client, sync_runner
from pbi_semantiq_agent.inventory_loader import file_cached
from pbi_semantiq_agent.metadata import Column, Measure, SemanticModel, Table
from pbi_semantiq_agent.metadata_paths import atomic_write_jsonl, read_jsonl

GUID_A = "11111111-1111-1111-1111-111111111111"
GUID_B = "22222222-2222-2222-2222-222222222222"
GUID_C = "33333333-3333-3333-3333-333333333333"


# --------------------------------------------------------------------------- portal catalogue client
def test_norm_row_keeps_valid_guids_and_drops_bad_ones():
    ok = portal_catalog_client._norm_row(
        {"portal_id": "p1", "title": "T", "menu_path": "A > B", "report_id": GUID_A, "workspace_id": GUID_B, "dataset_id": GUID_C}
    )
    assert ok and ok["menu_path"] == "A > B" and ok["portal_dataset_hint"] == GUID_C
    assert portal_catalog_client._norm_row({"portal_id": "p2", "report_id": "nope", "workspace_id": GUID_B}) is None
    no_ds = portal_catalog_client._norm_row({"portal_id": "p3", "report_id": GUID_A, "workspace_id": GUID_B, "dataset_id": "x"})
    assert no_ds and "portal_dataset_hint" not in no_ds


@pytest.mark.asyncio
async def test_fetch_catalog_signs_service_token_and_normalises(monkeypatch):
    monkeypatch.setenv("PORTAL_CATALOG_URL", "http://portal.test")
    monkeypatch.setenv("SMART_ORCHESTRATOR_SECRET", "s3cret-s3cret-s3cret-s3cret-s3cret")
    seen: dict = {}

    class Resp:
        status_code = 200

        def json(self):
            return {"reports": [{"portal_id": "p1", "title": "R", "report_id": GUID_A, "workspace_id": GUID_B}, {"portal_id": "bad"}]}

    class FakeHttp:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            seen["url"], seen["auth"] = url, headers["Authorization"]
            return Resp()

    monkeypatch.setattr(portal_catalog_client.httpx, "AsyncClient", FakeHttp)
    portal_catalog_client.get_settings.cache_clear()
    try:
        rows = await portal_catalog_client.fetch_portal_catalog_via_api()
    finally:
        portal_catalog_client.get_settings.cache_clear()
    assert [r["portal_id"] for r in rows] == ["p1"]
    assert seen["url"] == "http://portal.test/api/smart/catalog"
    claims = jwt.decode(
        seen["auth"].split(" ", 1)[1],
        "s3cret-s3cret-s3cret-s3cret-s3cret",
        algorithms=["HS256"],
        audience=portal_catalog_client.CATALOG_AUDIENCE,
        issuer=portal_catalog_client.CATALOG_ISSUER,
    )
    assert claims["exp"] - claims["iat"] <= 120


@pytest.mark.asyncio
async def test_fetch_catalog_without_config_raises(monkeypatch):
    monkeypatch.delenv("PORTAL_CATALOG_URL", raising=False)
    monkeypatch.delenv("SMART_ORCHESTRATOR_SECRET", raising=False)
    monkeypatch.delenv("PORTAL_JWT_SECRET", raising=False)
    portal_catalog_client.get_settings.cache_clear()
    try:
        with pytest.raises(RuntimeError):
            await portal_catalog_client.fetch_portal_catalog_via_api()
    finally:
        portal_catalog_client.get_settings.cache_clear()


# --------------------------------------------------------------------------- ontology bindings
def _fleet_model() -> SemanticModel:
    vessels = Table("IMO_MASTER_LIST", columns=[Column("IMO_NUMBER"), Column("SUB_TYPE"), Column("MANAGER_GROUP"), Column("Name")])
    facts = Table(
        "Incidents",
        columns=[Column("DATE_OF_INCIDENT", data_type="DateTime"), Column("Name")],
        measures=[Measure("Incident Count", "Incidents", expression="COUNTROWS(Incidents)")],
    )
    return SemanticModel("ws", "ds", "Fleet", [vessels, facts], [])


def test_generate_bindings_auto_vs_review():
    auto, review = ontology_builder.generate_bindings(_fleet_model(), "DS")
    by_concept = {r["concept"]: r for r in auto}
    assert by_concept["vessel_identifier"]["column"] == "IMO_NUMBER"
    assert by_concept["vessel_subtype"]["column"] == "SUB_TYPE"
    assert by_concept["manager_company"]["column"] == "MANAGER_GROUP"
    # 'Name' exists in two tables, but the vessel master wins for vessel_name.
    assert by_concept["vessel_name"]["table"] == "IMO_MASTER_LIST"
    assert all(r["dataset_id"] == "ds" and r["source"] == "auto_scan" for r in auto)
    assert "reporting_period" not in by_concept  # resolved per question, never bound here


def test_generic_name_outside_master_goes_to_review():
    model = SemanticModel("ws", "ds", "M", [Table("Facts", columns=[Column("Name"), Column("Date")])], [])
    auto, review = ontology_builder.generate_bindings(model, "ds")
    assert auto == []
    assert {r["concept"] for r in review} >= {"vessel_name"}
    assert all(r["review_reason"] in {"low_confidence", "ambiguous"} for r in review)


def test_manual_bindings_override_auto_and_reload_on_change(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(ontology, "ontology_dir", lambda: tmp_path)
    ontology._clear_bindings_cache()
    atomic_write_jsonl(
        tmp_path / ontology.AUTO_BINDINGS_FILE,
        [{"dataset_id": "ds", "concept": "vessel_type", "table": "T", "column": "AUTO_COL", "confidence": 0.85}],
    )
    assert ontology.load_concept_bindings()["ds"]["vessel_type"].column == "AUTO_COL"
    assert ontology.load_concept_bindings()["ds"]["vessel_type"].source == "auto_scan"

    manual = tmp_path / ontology.BINDINGS_FILE
    manual.write_text(
        json.dumps({"dataset_id": "DS", "concept": "vessel_type", "table": "T", "column": "MANUAL_COL"}) + "\n", encoding="utf-8"
    )
    assert ontology.load_concept_bindings()["ds"]["vessel_type"].column == "MANUAL_COL"  # picked up without restart


def test_update_bindings_replaces_only_refreshed_datasets(tmp_path: Path, monkeypatch):
    import shutil

    real = ontology_builder.ontology_dir()
    for name in ("business_ontology.json", "business_rules.json", "business_aliases.json"):
        shutil.copy(real / name, tmp_path / name)
    monkeypatch.setattr(ontology_builder, "ontology_dir", lambda: tmp_path)
    monkeypatch.setattr(ontology, "ontology_dir", lambda: tmp_path)
    monkeypatch.setattr(ontology_builder, "_load_model", lambda ws, ds: _fleet_model() if ds == "ds-new" else None)
    auto_path = tmp_path / ontology.AUTO_BINDINGS_FILE
    atomic_write_jsonl(
        auto_path,
        [
            {"dataset_id": "ds-new", "concept": "vessel_type", "table": "OLD", "column": "OLD"},
            {"dataset_id": "ds-other", "concept": "vessel_type", "table": "KEEP", "column": "KEEP"},
        ],
    )
    result = ontology_builder.update_bindings_for_models([{"dataset_id": "ds-new", "workspace_id": "ws"}], [])
    assert result["datasets"] == 1
    rows = read_jsonl(auto_path)
    assert {r["table"] for r in rows if r["dataset_id"] == "ds-other"} == {"KEEP"}
    assert not any(r["table"] == "OLD" for r in rows)
    assert any(r["dataset_id"] == "ds-new" and r["concept"] == "vessel_identifier" for r in rows)


# --------------------------------------------------------------------------- file_cached
def test_file_cached_reloads_when_file_changes(tmp_path: Path):
    f = tmp_path / "data.txt"
    f.write_text("a", encoding="utf-8")
    calls: list[int] = []

    @file_cached(lambda: [f])
    def load():
        calls.append(1)
        return f.read_text(encoding="utf-8")

    assert load() == "a" and load() == "a" and len(calls) == 1
    f.write_text("bb", encoding="utf-8")  # size changes -> signature changes
    assert load() == "bb" and len(calls) == 2
    load.cache_clear()
    load()
    assert len(calls) == 3


# --------------------------------------------------------------------------- inventory sync
class _FakePbi:
    async def list_workspaces(self):
        return [{"id": GUID_A, "name": "Prod WS"}, {"id": GUID_B, "name": "Broken WS"}]

    async def list_datasets(self, ws):
        if ws == GUID_B:
            raise sync_runner.PowerBIError("forbidden", 403)
        return [{"id": "ds-keep", "name": "Keep"}, {"id": "ds-new", "name": "New"}]

    async def list_reports(self, ws):
        return [{"id": "r1", "name": "Report One", "datasetId": "ds-keep", "datasetWorkspaceId": GUID_A}]

    async def get_dataset_freshness(self, ws, ds):
        return {"refreshedAt": "2026-11-01T00:00:00Z", "refreshStatus": "Completed", "refreshId": "x"}

    async def list_datasources(self, ws, ds):
        return [{"datasourceType": "Sql"}]


@pytest.mark.asyncio
async def test_inventory_sync_preserves_enrichment_and_unreadable_workspaces(tmp_path: Path, monkeypatch):
    from pbi_semantiq_agent import inventory_sync

    monkeypatch.setenv("PBI_METADATA_ROOT", str(tmp_path))
    atomic_write_jsonl(
        tmp_path / "semantic_model_catalog.jsonl",
        [
            {"dataset_id": "ds-keep", "workspace_id": GUID_A, "workspace_name": "Old", "business_domains": {"primary": "Fleet"}, "refresh_config": {"next_refresh": float("nan")}},
            {"dataset_id": "ds-gone", "workspace_id": GUID_A, "workspace_name": "Old", "business_domains": {"primary": "X"}},
            {"dataset_id": "ds-hidden", "workspace_id": GUID_B, "workspace_name": "Broken WS"},
        ],
    )
    result = await inventory_sync.sync_inventory(_FakePbi())
    assert result["status"] == "ok" and result["added"] == 1 and result["removed"] == 1

    rows = {r["dataset_id"]: r for r in read_jsonl(tmp_path / "semantic_model_catalog.jsonl")}
    assert rows["ds-keep"]["business_domains"] == {"primary": "Fleet"}  # enrichment preserved
    assert rows["ds-keep"]["workspace_name"] == "Prod WS"  # Power BI facts updated
    assert rows["ds-keep"]["reports"] == [{"report_id": "r1", "report_name": "Report One"}]
    assert rows["ds-keep"]["refresh_config"]["next_refresh"] is None  # NaN sanitised for JS readers
    assert "ds-hidden" in rows  # unreadable workspace left untouched
    assert "ds-gone" not in rows  # vanished from an enumerated workspace -> archived
    assert rows["ds-new"]["refresh_config"]["refresh_status"] == "Completed"
    assert rows["ds-new"]["data_source"]["connector_types"] == ["Sql"]
    lookup = read_jsonl(tmp_path / "report_lookup_index.jsonl")
    assert [(r["report_id"], r["dataset_id"]) for r in lookup] == [("r1", "ds-keep")]
    assert "NaN" not in (tmp_path / "semantic_model_catalog.jsonl").read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_inventory_sync_writes_nothing_when_nothing_enumerated(tmp_path: Path, monkeypatch):
    from pbi_semantiq_agent import inventory_sync

    class Empty(_FakePbi):
        async def list_workspaces(self):
            return []

    monkeypatch.setenv("PBI_METADATA_ROOT", str(tmp_path))
    atomic_write_jsonl(tmp_path / "semantic_model_catalog.jsonl", [{"dataset_id": "d", "workspace_id": GUID_A}])
    assert (await inventory_sync.sync_inventory(Empty()))["status"] == "skipped"
    assert len(read_jsonl(tmp_path / "semantic_model_catalog.jsonl")) == 1


# --------------------------------------------------------------------------- sync_runner gating
@pytest.mark.asyncio
async def test_incremental_sync_without_changes_extracts_nothing(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("PBI_METADATA_ROOT", str(tmp_path))
    record = {
        "portal_id": "p1", "report_id": "r1", "workspace_id": GUID_A, "dataset_id": "ds1", "dataset_workspace_id": GUID_A,
        "mapping_status": "mapped", "portal_hash": "h", "report_name": "R", "live_refresh": "t1|id",
    }
    atomic_write_jsonl(sync_runner.portal_catalog_file(), [record])

    async def fake_rows():
        return [{"portal_id": "p1"}]

    async def fake_catalog(client, rows):
        return {"status": "ok"}

    async def fake_fresh(client, records):
        for r in records:
            r["live_refresh"] = "t1|id"

    calls = {"reports": 0, "models": 0}

    async def fake_reports(client, records, only_portal_ids=None):
        calls["reports"] += 1
        return []

    async def fake_models(client, records, dataset_ids=None):
        calls["models"] += 1
        return []

    class FakeClient:
        def __init__(self, settings):
            pass

        async def aclose(self):
            pass

    monkeypatch.setattr(sync_runner, "PowerBIClient", FakeClient)
    monkeypatch.setattr(sync_runner, "_fetch_portal_rows", fake_rows)
    monkeypatch.setattr(sync_runner, "sync_portal_catalog", fake_catalog)
    monkeypatch.setattr(sync_runner, "_attach_live_freshness", fake_fresh)
    monkeypatch.setattr(sync_runner, "_extract_reports", fake_reports)
    monkeypatch.setattr(sync_runner, "_extract_models", fake_models)
    monkeypatch.setattr(sync_runner.get_settings(), "inventory_sync_enabled", False, raising=False)
    monkeypatch.setattr(sync_runner.get_settings(), "ontology_auto_bindings", False, raising=False)

    result = await sync_runner.run_sync("incremental")
    assert result["status"] == "ok"
    assert calls == {"reports": 0, "models": 0}  # previously "or None" extracted everything

    # A live refresh change on the dataset triggers exactly that dataset.
    async def fresh_changed(client, records):
        for r in records:
            r["live_refresh"] = "t2|id2"

    monkeypatch.setattr(sync_runner, "_attach_live_freshness", fresh_changed)
    await sync_runner.run_sync("incremental")
    assert calls == {"reports": 1, "models": 1}
