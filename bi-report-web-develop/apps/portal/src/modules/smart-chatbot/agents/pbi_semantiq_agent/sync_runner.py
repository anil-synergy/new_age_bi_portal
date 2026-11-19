"""CLI and service entrypoint for full/incremental metadata sync."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from smart_common.logging import configure_logging, log

from . import TECHNICAL_NAME
from .catalog_postgres import fetch_portal_reports
from .extract_model import extract_model_artifacts
from .extract_report import extract_report_artifacts
from .metadata_paths import atomic_write_json, portal_catalog_file, read_jsonl, sync_state_file
from .portal_catalog_client import fetch_portal_catalog_via_api
from .powerbi_client import PowerBIClient, PowerBIError
from .settings import get_settings
from .sync_catalog import sync_portal_catalog

logger = logging.getLogger(__name__)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_state() -> dict[str, Any]:
    path = sync_state_file()
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_state(state: dict[str, Any]) -> None:
    atomic_write_json(sync_state_file(), state)


def _dataset_fingerprint(row: dict[str, Any]) -> str:
    return "|".join(
        str(row.get(k) or "")
        for k in ("dataset_id", "last_refresh", "refresh_status", "report_name", "portal_hash", "live_refresh")
    )


_sync_lock: asyncio.Lock | None = None


def _get_lock() -> asyncio.Lock:
    global _sync_lock
    if _sync_lock is None:
        _sync_lock = asyncio.Lock()
    return _sync_lock


async def _fetch_portal_rows() -> list[dict[str, Any]]:
    """Portal menu rows: Next catalogue API first, direct Postgres as fallback."""
    try:
        rows = await fetch_portal_catalog_via_api()
        if rows:
            return rows
        log(logger, logging.WARNING, "portal_api_empty_fallback_db")
    except RuntimeError as exc:
        log(logger, logging.INFO, "portal_api_unavailable_fallback_db", reason=str(exc)[:160])
    try:
        return await asyncio.to_thread(fetch_portal_reports)
    except RuntimeError as exc:
        log(logger, logging.WARNING, "portal_fetch_failed", error=str(exc))
        return []


async def _attach_live_freshness(client: PowerBIClient, records: list[dict[str, Any]]) -> None:
    """Stamp each record with the dataset's live last-refresh so changes trigger re-extraction.

    One REST call per distinct dataset, bounded concurrency. Failures are ignored (fingerprint
    then falls back to the other fields).
    """
    targets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in records:
        ds = str(row.get("dataset_id") or "").strip()
        ws = str(row.get("dataset_workspace_id") or row.get("workspace_id") or "").strip()
        if ds and ws:
            targets.setdefault((ws, ds), []).append(row)
    sem = asyncio.Semaphore(4)

    async def one(key: tuple[str, str], rows: list[dict[str, Any]]) -> None:
        async with sem:
            try:
                fresh = await client.get_dataset_freshness(*key)
            except Exception:  # noqa: BLE001 - freshness is best effort
                return
        fresh = fresh or {}
        stamp = "|".join(str(fresh.get(k) or "") for k in ("refreshedAt", "refreshId"))
        if stamp == "|":
            stamp = ""
        for r in rows:
            r["live_refresh"] = stamp

    await asyncio.gather(*(one(k, v) for k, v in targets.items()))


async def _extract_reports(client: PowerBIClient, records: list[dict[str, Any]], *, only_portal_ids: set[str] | None = None) -> list[dict[str, Any]]:
    outcomes: list[dict[str, Any]] = []
    for row in records:
        if row.get("mapping_status") not in {"mapped", "unmapped_jsonl_miss"}:
            continue
        if not row.get("dataset_id"):
            continue
        portal_id = str(row.get("portal_id") or "")
        if only_portal_ids is not None and portal_id not in only_portal_ids:
            continue
        try:
            meta = await extract_report_artifacts(
                client,
                str(row["workspace_id"]),
                str(row["report_id"]),
                report_name=str(row.get("report_name") or row.get("title") or ""),
            )
            row["extraction_status"] = meta.get("extraction_status", "ok")
            outcomes.append({"portal_id": portal_id, **meta})
        except PowerBIError as exc:
            row["extraction_status"] = "failed"
            outcomes.append({"portal_id": portal_id, "extraction_status": "failed", "error": str(exc)[:200]})
    return outcomes


async def _extract_models(client: PowerBIClient, records: list[dict[str, Any]], *, dataset_ids: set[str] | None = None) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    outcomes: list[dict[str, Any]] = []
    for row in records:
        dataset_id = str(row.get("dataset_id") or "").strip()
        workspace_id = str(row.get("dataset_workspace_id") or row.get("workspace_id") or "").strip()
        if not dataset_id or not workspace_id:
            continue
        key = (workspace_id.lower(), dataset_id.lower())
        if key in seen:
            continue
        if dataset_ids is not None and dataset_id.lower() not in dataset_ids:
            continue
        seen.add(key)
        try:
            meta = await extract_model_artifacts(
                client, workspace_id, dataset_id, dataset_name=str(row.get("dataset_name") or row.get("report_name") or "") or None
            )
            outcomes.append(meta)
        except PowerBIError as exc:
            outcomes.append({"workspace_id": workspace_id, "dataset_id": dataset_id, "extraction_status": "failed", "error": str(exc)[:200]})
    return outcomes


def _incremental_portal_ids(records: list[dict[str, Any]], previous: list[dict[str, Any]]) -> set[str]:
    prev_by_portal = {str(r.get("portal_id")): r for r in previous if r.get("portal_id")}
    changed: set[str] = set()
    for row in records:
        portal_id = str(row.get("portal_id") or "")
        if not portal_id:
            continue
        prev = prev_by_portal.get(portal_id)
        if not prev or prev.get("portal_hash") != row.get("portal_hash"):
            changed.add(portal_id)
            continue
        if _dataset_fingerprint(prev) != _dataset_fingerprint(row):
            changed.add(portal_id)
    return changed


async def run_sync(mode: str = "incremental") -> dict[str, Any]:
    """Serialised: a second call while one is running waits, then runs (never overlaps)."""
    async with _get_lock():
        return await _run_sync_locked(mode)


async def _run_sync_locked(mode: str) -> dict[str, Any]:
    from .metadata_paths import atomic_write_jsonl

    settings = get_settings()
    client = PowerBIClient(settings)
    state = _load_state()
    started = _utc_now()

    try:
        previous = read_jsonl(portal_catalog_file()) if portal_catalog_file().is_file() else []

        # 1. Workspace inventory (semantic_model_catalog / report_lookup_index / enriched) - best effort.
        inventory_result: dict[str, Any] = {"status": "disabled"}
        if settings.inventory_sync_enabled:
            try:
                from .inventory_sync import sync_inventory

                inventory_result = await sync_inventory(client)
            except Exception as exc:  # noqa: BLE001 - inventory must never block the portal sync
                inventory_result = {"status": "error", "error": type(exc).__name__, "message": str(exc)[:200]}
                log(logger, logging.WARNING, "inventory_sync_failed", **{k: inventory_result[k] for k in ("error", "message")})

        # 2. Portal menu catalogue (Next API first, Postgres fallback), then dataset mapping via REST.
        portal_rows = await _fetch_portal_rows()
        catalog_result = await sync_portal_catalog(client, portal_rows)
        records = read_jsonl(portal_catalog_file())
        await _attach_live_freshness(client, records)

        report_outcomes: list[dict[str, Any]] = []
        model_outcomes: list[dict[str, Any]] = []

        if mode == "full":
            report_outcomes = await _extract_reports(client, records)
            model_outcomes = await _extract_models(client, records)
        else:
            portal_ids = _incremental_portal_ids(records, previous)
            portal_ids |= set(state.get("failed_report_portal_ids") or [])
            dataset_ids = {
                str(r.get("dataset_id") or "").lower()
                for r in records
                if str(r.get("portal_id") or "") in portal_ids and r.get("dataset_id")
            }
            dataset_ids |= {str(x).lower() for x in (state.get("failed_dataset_ids") or [])}
            # Empty set means "nothing to do" - never pass None (which would mean "everything").
            if portal_ids:
                report_outcomes = await _extract_reports(client, records, only_portal_ids=portal_ids)
            if dataset_ids:
                model_outcomes = await _extract_models(client, records, dataset_ids=dataset_ids)

        if records:
            atomic_write_jsonl(portal_catalog_file(), records)

        # 3. Ontology: regenerate auto concept bindings for datasets whose schema was re-extracted.
        bindings_result: dict[str, Any] = {"status": "disabled"}
        if settings.ontology_auto_bindings:
            try:
                from .ontology_builder import update_bindings_for_models

                # File and CPU work: off the event loop so a sync never freezes running questions.
                bindings_result = await asyncio.to_thread(
                    update_bindings_for_models,
                    [o for o in model_outcomes if o.get("extraction_status") != "failed"],
                    records,
                    full=(mode == "full"),
                )
            except Exception as exc:  # noqa: BLE001
                bindings_result = {"status": "error", "error": type(exc).__name__, "message": str(exc)[:200]}
                log(logger, logging.WARNING, "ontology_bindings_failed", error=type(exc).__name__, message=str(exc)[:200])
            # Alias / concept improvements are only ever *proposed* (reviewed through apply_learning), never applied.
            try:
                from .ontology_proposer import propose

                proposal = await asyncio.to_thread(propose)
                bindings_result["proposal"] = {k: v for k, v in proposal.items() if k != "proposal"}
            except Exception as exc:  # noqa: BLE001
                log(logger, logging.WARNING, "ontology_proposal_failed", error=type(exc).__name__, message=str(exc)[:200])

        new_state = {
            "last_run_at": started,
            "last_success_at": _utc_now(),
            "mode": mode,
            "catalog": catalog_result,
            "inventory": inventory_result,
            "bindings": bindings_result,
            "reports_extracted": len(report_outcomes),
            "models_extracted": len(model_outcomes),
            "failed_report_portal_ids": [o.get("portal_id") for o in report_outcomes if o.get("extraction_status") == "failed"],
            "failed_dataset_ids": [o.get("dataset_id") for o in model_outcomes if o.get("extraction_status") == "failed"],
        }
        _save_state({**state, **new_state})
        return {"status": "ok", "mode": mode, **new_state}
    finally:
        await client.aclose()


async def retry_failed() -> dict[str, Any]:
    state = _load_state()
    settings = get_settings()
    client = PowerBIClient(settings)
    try:
        records = read_jsonl(portal_catalog_file())
        portal_ids = set(state.get("failed_report_portal_ids") or [])
        dataset_ids = {str(x).lower() for x in (state.get("failed_dataset_ids") or [])}
        reports = await _extract_reports(client, records, only_portal_ids=portal_ids) if portal_ids else []
        models = await _extract_models(client, records, dataset_ids=dataset_ids) if dataset_ids else []
        return {"status": "ok", "reports": reports, "models": models}
    finally:
        await client.aclose()


def status_snapshot() -> dict[str, Any]:
    state = _load_state()
    catalog = read_jsonl(portal_catalog_file())
    return {
        "status": "ok",
        "catalog_records": len(catalog),
        "catalog_path": str(portal_catalog_file()),
        "sync_state": state,
        "mapped": sum(1 for r in catalog if r.get("mapping_status") == "mapped"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync SemantIQ portal metadata catalog and artifacts.")
    parser.add_argument("--mode", choices=("full", "incremental", "status", "retry"), default="incremental")
    args = parser.parse_args()
    configure_logging(TECHNICAL_NAME, get_settings().log_level)
    if args.mode == "status":
        print(json.dumps(status_snapshot(), indent=2))
        return
    if args.mode == "retry":
        print(json.dumps(asyncio.run(retry_failed()), indent=2))
        return
    print(json.dumps(asyncio.run(run_sync(args.mode)), indent=2))


if __name__ == "__main__":
    main()
