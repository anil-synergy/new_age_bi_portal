"""Extract report pages/visuals via Power BI REST (best-effort, no fabrication)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from smart_common.logging import log

from .metadata_paths import (
    append_jsonl_log,
    atomic_write_json,
    extraction_logs_dir,
    report_artifact_dir,
)
from .powerbi_client import PowerBIClient, PowerBIError

logger = logging.getLogger(__name__)

STATUS_OK = "ok"
STATUS_PARTIAL = "partial"
STATUS_UNSUPPORTED = "unsupported"
STATUS_FAILED = "failed"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_field_wells(visual: dict[str, Any]) -> dict[str, Any] | None:
    """Persist REST field-well hints when present; never fabricate bindings."""
    for key in ("data", "dataTransforms", "query"):
        blob = visual.get(key)
        if not isinstance(blob, dict):
            continue
        roles = blob.get("dataRoles") or blob.get("projections") or blob.get("selects")
        if roles:
            return {"source": key, "roles": roles}
    config = visual.get("config")
    if isinstance(config, str):
        return None
    if isinstance(config, dict):
        for nested_key in ("singleVisual", "visual", "objects"):
            nested = config.get(nested_key)
            if isinstance(nested, dict) and nested.get("projections"):
                return {"source": f"config.{nested_key}", "roles": nested.get("projections")}
    return None


def _redact_visual(visual: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": visual.get("id"),
        "title": visual.get("title"),
        "type": visual.get("type"),
        "name": visual.get("name"),
    }
    config = visual.get("config")
    if isinstance(config, dict):
        out["config_keys"] = sorted(config.keys())[:40]
    if visual.get("filters") is not None:
        out["has_filters"] = True
    data = visual.get("data")
    if isinstance(data, dict):
        out["data_keys"] = sorted(data.keys())[:20]
    wells = _extract_field_wells(visual)
    if wells:
        out["field_wells"] = wells
    return out


async def extract_report_artifacts(
    client: PowerBIClient,
    workspace_id: str,
    report_id: str,
    *,
    report_name: str | None = None,
) -> dict[str, Any]:
    dest = report_artifact_dir(workspace_id, report_id)
    status = STATUS_OK
    limitations: list[str] = []
    pages: list[dict[str, Any]] = []
    visuals: list[dict[str, Any]] = []
    filters: list[dict[str, Any]] = []

    try:
        pages = await client.list_report_pages(workspace_id, report_id)
    except PowerBIError as exc:
        status = STATUS_UNSUPPORTED if exc.status in {401, 403, 404} else STATUS_FAILED
        limitations.append(f"pages: {exc.status or 'error'}")
        pages = []

    for page in pages:
        page_name = str(page.get("name") or page.get("displayName") or "")
        if not page_name:
            continue
        try:
            page_visuals = await client.list_page_visuals(workspace_id, report_id, page_name)
        except PowerBIError as exc:
            status = STATUS_PARTIAL if status == STATUS_OK else status
            limitations.append(f"visuals:{page_name}: {exc.status or 'error'}")
            continue
        for visual in page_visuals:
            visuals.append({**_redact_visual(visual), "page": page_name, "page_display_name": page.get("displayName")})

    try:
        filters = await client.list_report_filters(workspace_id, report_id)
    except PowerBIError as exc:
        if exc.status not in {401, 403, 404}:
            status = STATUS_PARTIAL if status == STATUS_OK else status
        limitations.append(f"filters: {exc.status or 'error'}")

    if not pages and status != STATUS_FAILED:
        status = STATUS_UNSUPPORTED

    meta = {
        "workspace_id": workspace_id,
        "report_id": report_id,
        "report_name": report_name,
        "extracted_at": _utc_now(),
        "extraction_status": status,
        "limitations": limitations,
        "page_count": len(pages),
        "visual_count": len(visuals),
    }

    if status in {STATUS_OK, STATUS_PARTIAL}:
        dest.mkdir(parents=True, exist_ok=True)
        atomic_write_json(dest / "report_metadata.json", meta)
        atomic_write_json(dest / "pages.json", {"pages": pages})
        atomic_write_json(dest / "visuals.json", {"visuals": visuals})
        if filters:
            atomic_write_json(dest / "report_filters.json", {"filters": filters})
        atomic_write_json(
            dest / "visual_field_mapping.json",
            {"supported": False, "reason": "field_wells_not_exposed", "visual_count": len(visuals)},
        )

    append_jsonl_log(
        extraction_logs_dir() / "reports.jsonl",
        {"at": _utc_now(), "workspace_id": workspace_id, "report_id": report_id, "status": status, "limitations": limitations},
    )
    log(logger, logging.INFO, "report_extracted", workspace_id=workspace_id, report_id=report_id, status=status, pages=len(pages), visuals=len(visuals))
    return meta
