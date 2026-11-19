"""Refresh the workspace inventory JSONL files from Power BI REST.

Rewrites ``semantic_model_catalog.jsonl`` (dataset grain) and ``report_lookup_index.jsonl`` (report grain)
atomically. Existing rows are *merged*, never replaced: hand-curated / LLM-enriched fields
(business_domains, risk_profile, governance, ...) are preserved; only the facts Power BI owns
(workspace name, reports, URLs, refresh state) are updated.

Safety rules:
* A workspace that cannot be enumerated is left untouched (rows are never dropped for it).
* If nothing at all could be enumerated, nothing is written.
* Datasets that disappeared from an enumerated workspace are archived to
  ``semantic_model_catalog.removed.jsonl`` and dropped from the live file.
* Per-dataset calls (refresh history, datasources) are made only for new datasets, to stay inside
  Power BI REST rate limits. Live refresh state of portal datasets is tracked in ``sync_runner``.
"""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from smart_common.logging import log

from .metadata_paths import (
    append_jsonl_log,
    atomic_write_jsonl,
    metadata_workspace_root,
    read_jsonl,
    semantic_inventory_file,
    sync_logs_dir,
)
from .powerbi_client import PowerBIClient, PowerBIError

logger = logging.getLogger(__name__)

LOOKUP_FILE = "report_lookup_index.jsonl"
REMOVED_FILE = "semantic_model_catalog.removed.jsonl"
_DETAIL_CONCURRENCY = 4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any) -> Any:
    """JSON-safe: Python writes NaN as a bare token that JS ``JSON.parse`` rejects."""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def _key(row: dict[str, Any]) -> tuple[str, str]:
    return (str(row.get("workspace_id") or "").lower(), str(row.get("dataset_id") or "").lower())


def _new_row(ws: dict[str, Any], ds: dict[str, Any]) -> dict[str, Any]:
    ws_id, ds_id = str(ws["id"]), str(ds["id"])
    return {
        "dataset_id": ds_id,
        "workspace_id": ws_id,
        "workspace_name": ws.get("name"),
        "reports": [],
        "report_count": 0,
        "unique_report_ids": 0,
        "semantic_url": f"https://app.powerbi.com/groups/{ws_id}/settings/datasets/{ds_id}?experience=power-bi",
        "xmla_endpoint": f"powerbi://api.powerbi.com/v1.0/myorg/{quote(str(ws.get('name') or ws_id))}",
        "data_source": {"connector_types": [], "platforms": [], "storage_tiers": []},
        "refresh_config": {},
        "metadata": {"extract_timestamp": _now(), "tags": [], "enrichment": "pending"},
        "dataset_name": ds.get("name"),
        "target_storage_mode": ds.get("targetStorageMode"),
    }


async def _enumerate(client: PowerBIClient) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], set[str]]:
    """Return (datasets by key, reports-by-dataset-key lists, workspaces fully enumerated)."""
    workspaces = await client.list_workspaces()
    sem = asyncio.Semaphore(_DETAIL_CONCURRENCY)
    datasets: dict[str, dict[str, Any]] = {}
    reports: dict[str, list[dict[str, Any]]] = {}
    ok_ws: set[str] = set()

    async def one(ws: dict[str, Any]) -> None:
        async with sem:
            try:
                ds_list = await client.list_datasets(ws["id"])
                rep_list = await client.list_reports(ws["id"])
            except PowerBIError as exc:
                log(logger, logging.WARNING, "inventory_workspace_failed", workspace_id=ws["id"], error=str(exc)[:160])
                return
        ok_ws.add(str(ws["id"]).lower())
        for ds in ds_list:
            datasets[f"{str(ws['id']).lower()}|{str(ds['id']).lower()}"] = {"ws": ws, "ds": ds}
        for rep in rep_list:
            if not rep.get("datasetId"):
                continue
            dws = str(rep.get("datasetWorkspaceId") or ws["id"]).lower()
            reports.setdefault(f"{dws}|{str(rep['datasetId']).lower()}", []).append(
                {"report_id": rep["id"], "report_name": rep.get("name"), "workspace_id": ws["id"], "workspace_name": ws.get("name")}
            )

    await asyncio.gather(*(one(w) for w in workspaces))
    return datasets, reports, ok_ws


async def _details_for_new(client: PowerBIClient, row: dict[str, Any]) -> None:
    """Refresh state + datasources for one new dataset (best effort)."""
    ws, ds = row["workspace_id"], row["dataset_id"]
    try:
        fresh = await client.get_dataset_freshness(ws, ds)
        row["refresh_config"] = {
            "refresh_status": fresh.get("refreshStatus"),
            "last_refresh": fresh.get("refreshedAt"),
            "next_refresh": None,
        }
    except (PowerBIError, Exception):  # noqa: BLE001 - optional detail
        pass
    try:
        sources = await client.list_datasources(ws, ds)
        types = sorted({str(s.get("datasourceType")) for s in sources if s.get("datasourceType")})
        row["data_source"]["connector_types"] = types
    except (PowerBIError, Exception):  # noqa: BLE001
        pass


def _lookup_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in rows:
        domains = r.get("business_domains") or {}
        biz = r.get("business_processes") or {}
        risk = r.get("risk_profile") or {}
        refresh = r.get("refresh_config") or {}
        for rep in r.get("reports") or []:
            out.append(
                {
                    "report_id": rep.get("report_id"),
                    "report_name": rep.get("report_name"),
                    "dataset_id": r.get("dataset_id"),
                    "workspace_name": r.get("workspace_name"),
                    "primary_domain": domains.get("primary"),
                    "operational_criticality": biz.get("operational_criticality"),
                    "data_sensitivity": risk.get("data_sensitivity"),
                    "refresh_status": refresh.get("refresh_status"),
                    "critical_for_operations": refresh.get("critical_for_operations"),
                }
            )
    return out


async def sync_inventory(client: PowerBIClient) -> dict[str, Any]:
    datasets, reports, ok_ws = await _enumerate(client)
    if not datasets:
        log(logger, logging.WARNING, "inventory_sync_skipped_empty")
        return {"status": "skipped", "reason": "nothing_enumerated"}

    dest = semantic_inventory_file()
    existing = read_jsonl(dest)
    by_key = {_key(r): r for r in existing if r.get("dataset_id") and r.get("workspace_id")}

    merged: list[dict[str, Any]] = []
    added: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for k, item in datasets.items():
        ws_l, ds_l = k.split("|", 1)
        row = by_key.get((ws_l, ds_l))
        if row is None:
            row = _new_row(item["ws"], item["ds"])
            added.append(row)
        else:
            row["workspace_name"] = item["ws"].get("name") or row.get("workspace_name")
            row.setdefault("dataset_name", item["ds"].get("name"))
            row["xmla_endpoint"] = (
                f"powerbi://api.powerbi.com/v1.0/myorg/{quote(str(item['ws'].get('name') or row['workspace_id']))}"
            )
        reps = reports.get(k, [])
        row["reports"] = [{"report_id": r["report_id"], "report_name": r["report_name"]} for r in reps]
        row["report_count"] = len(reps)
        row["unique_report_ids"] = len({str(r["report_id"]).lower() for r in reps})
        meta = row.setdefault("metadata", {})
        meta["last_seen"] = _now()
        merged.append(row)
        seen.add((ws_l, ds_l))

    # Keep rows of workspaces we could not enumerate; archive rows that vanished from enumerated ones.
    removed: list[dict[str, Any]] = []
    for k, row in by_key.items():
        if k in seen:
            continue
        if k[0] in ok_ws:
            removed.append({**row, "removed_at": _now()})
        else:
            merged.append(row)

    sem = asyncio.Semaphore(_DETAIL_CONCURRENCY)

    async def detail(row: dict[str, Any]) -> None:
        async with sem:
            await _details_for_new(client, row)

    await asyncio.gather(*(detail(r) for r in added))

    merged.sort(key=lambda r: (str(r.get("workspace_name") or "").lower(), str(r.get("dataset_id") or "")))
    atomic_write_jsonl(dest, [_clean(r) for r in merged])
    atomic_write_jsonl(metadata_workspace_root() / LOOKUP_FILE, [_clean(r) for r in _lookup_rows(merged)])
    if removed:
        append_jsonl_log(metadata_workspace_root() / REMOVED_FILE, {"at": _now(), "rows": _clean(removed)})
    append_jsonl_log(
        sync_logs_dir() / "sync_inventory.jsonl",
        {"at": _now(), "datasets": len(merged), "added": len(added), "removed": len(removed), "workspaces": len(ok_ws)},
    )
    result = {
        "status": "ok",
        "datasets": len(merged),
        "added": len(added),
        "removed": len(removed),
        "workspaces_enumerated": len(ok_ws),
        "new_dataset_ids": [r["dataset_id"] for r in added],
    }
    log(logger, logging.INFO, "inventory_synced", **{k: v for k, v in result.items() if k != "new_dataset_ids"})
    return result
