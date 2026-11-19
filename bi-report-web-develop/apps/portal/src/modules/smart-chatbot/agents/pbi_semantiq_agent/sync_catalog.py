"""Build portal_report_semantic_catalog.jsonl from portal Postgres, REST, and jsonl inventory."""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from smart_common.logging import log

from .inventory_loader import load_semantic_inventory
from .metadata_paths import CATALOG_SCHEMA_VERSION, append_jsonl_log, atomic_write_jsonl, portal_catalog_file, read_jsonl, sync_logs_dir
from .powerbi_client import PowerBIClient, PowerBIError, WorkspaceNotAllowed

logger = logging.getLogger(__name__)

MAPPING_MAPPED = "mapped"
MAPPING_NO_DATASET = "unmapped_no_dataset"
MAPPING_JSONL_MISS = "unmapped_jsonl_miss"
MAPPING_INACCESSIBLE = "inaccessible"
MAPPING_DELETED = "deleted"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _portal_hash(row: dict[str, Any]) -> str:
    blob = "|".join(
        str(row.get(k) or "")
        for k in ("portal_id", "title", "description", "menu_path", "report_id", "workspace_id")
    )
    return hashlib.blake2b(blob.encode("utf-8"), digest_size=8).hexdigest()


def _classify_env(title: str, workspace_name: str | None, ids: tuple[str, ...]) -> tuple[str, list[str]]:
    try:
        from smart_orchestrator.environment import EnvironmentPolicy
        from smart_orchestrator.settings import get_settings

        policy = EnvironmentPolicy.from_settings(get_settings())
        hit = policy.classify(title, workspace_name=workspace_name, ids=ids)
        return hit.environment, list(hit.markers)
    except Exception:  # noqa: BLE001
        return "PROD", []


def _index_previous(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.get("portal_id") or row.get("report_id") or "").strip()
        if key:
            out[key] = row
    return out


async def _reports_by_workspace(client: PowerBIClient, workspace_id: str) -> dict[str, dict[str, Any]]:
    try:
        reports = await client.list_reports(workspace_id)
    except (PowerBIError, WorkspaceNotAllowed):
        return {}
    return {str(r["id"]).lower(): r for r in reports if r.get("id")}


async def build_catalog_records(
    client: PowerBIClient,
    portal_rows: list[dict[str, Any]],
    *,
    inventory: dict[tuple[str, str], dict[str, Any]] | None = None,
    previous: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    inventory = inventory if inventory is not None else load_semantic_inventory()
    previous_by_portal = _index_previous(previous or [])
    workspace_cache: dict[str, dict[str, dict[str, Any]]] = {}
    records: list[dict[str, Any]] = []
    seen_portal: set[str] = set()

    for portal in portal_rows:
        portal_id = str(portal.get("portal_id") or "").strip()
        report_id = str(portal.get("report_id") or "").strip()
        workspace_id = str(portal.get("workspace_id") or "").strip()
        if not portal_id or not report_id or not workspace_id:
            continue
        if portal_id in seen_portal:
            continue
        seen_portal.add(portal_id)

        prev = previous_by_portal.get(portal_id) or {}
        extraction_status = prev.get("extraction_status") or "pending"

        ws_key = workspace_id.lower()
        if ws_key not in workspace_cache:
            workspace_cache[ws_key] = await _reports_by_workspace(client, workspace_id)

        rest_report: dict[str, Any] | None = None
        mapping_status = MAPPING_INACCESSIBLE
        dataset_id = str(portal.get("portal_dataset_hint") or "").strip()
        dataset_workspace_id = workspace_id
        report_name = portal.get("title") or ""
        workspace_name = prev.get("workspace_name") or ""

        cached = workspace_cache.get(ws_key, {}).get(report_id.lower())
        if cached is None:
            try:
                cached = await client.get_report(workspace_id, report_id)
            except PowerBIError:
                cached = None

        if cached:
            rest_report = cached
            report_name = str(cached.get("name") or report_name)
            dataset_id = str(cached.get("datasetId") or "").strip()
            dataset_workspace_id = str(cached.get("datasetWorkspaceId") or workspace_id).strip()
            mapping_status = MAPPING_NO_DATASET if not dataset_id else MAPPING_MAPPED
        elif workspace_cache.get(ws_key) == {}:
            mapping_status = MAPPING_INACCESSIBLE

        inv: dict[str, Any] = {}
        if dataset_id:
            inv = inventory.get((workspace_id.lower(), dataset_id.lower()), {})
            if mapping_status == MAPPING_MAPPED and not inv:
                mapping_status = MAPPING_JSONL_MISS
            workspace_name = workspace_name or str(inv.get("workspace_name") or "")

        env, env_markers = _classify_env(
            str(portal.get("title") or report_name),
            workspace_name or None,
            (dataset_id, report_id, portal_id),
        )

        record: dict[str, Any] = {
            "schema_version": CATALOG_SCHEMA_VERSION,
            "portal_id": portal_id,
            "title": portal.get("title") or report_name,
            "description": portal.get("description") or "",
            "menu_path": portal.get("menu_path") or "",
            "report_id": report_id,
            "workspace_id": workspace_id,
            "report_name": report_name,
            "workspace_name": workspace_name,
            "dataset_id": dataset_id,
            "dataset_workspace_id": dataset_workspace_id,
            "environment": env,
            "env_markers": env_markers,
            "mapping_status": mapping_status,
            "extraction_status": extraction_status,
            "synced_at": _utc_now(),
            "portal_hash": _portal_hash(portal),
            "datasource_types": inv.get("datasource_types") or [],
            "source_kinds": inv.get("source_kinds") or [],
            "refresh_type": inv.get("refresh_type"),
            "last_refresh": inv.get("last_refresh"),
            "next_refresh": inv.get("next_refresh"),
            "refresh_status": inv.get("refresh_status"),
        }
        if rest_report:
            record["rest_report"] = {"id": rest_report.get("id"), "name": rest_report.get("name")}
        if portal.get("portal_dataset_hint"):
            # Dataset id the portal API believed in; Power BI REST (above) stays authoritative.
            record["portal_dataset_hint"] = portal["portal_dataset_hint"]
        records.append(record)

    active_portal_ids = {str(p.get("portal_id")) for p in portal_rows if p.get("portal_id")}
    for portal_id, prev in previous_by_portal.items():
        if portal_id in active_portal_ids:
            continue
        marked = {**prev, "mapping_status": MAPPING_DELETED, "synced_at": _utc_now()}
        records.append(marked)

    return records


async def sync_portal_catalog(
    client: PowerBIClient,
    portal_rows: list[dict[str, Any]],
    *,
    allow_empty: bool = False,
) -> dict[str, Any]:
    """Write portal_report_semantic_catalog.jsonl atomically; keep previous file on empty portal fetch."""
    dest = portal_catalog_file()
    previous = read_jsonl(dest) if dest.is_file() else []
    if not portal_rows and not allow_empty:
        log(logger, logging.WARNING, "portal_catalog_skip_empty", previous=len(previous))
        return {"status": "skipped", "reason": "empty_portal_fetch", "previous_count": len(previous)}

    records = await build_catalog_records(client, portal_rows, previous=previous)
    if records or allow_empty:
        atomic_write_jsonl(dest, records)
    log_dir = sync_logs_dir()
    append_jsonl_log(
        log_dir / "sync_catalog.jsonl",
        {"at": _utc_now(), "written": len(records), "portal_fetched": len(portal_rows), "dest": str(dest)},
    )
    mapped = sum(1 for r in records if r.get("mapping_status") == MAPPING_MAPPED)
    return {
        "status": "ok",
        "count": len(records),
        "mapped": mapped,
        "path": str(dest),
    }
