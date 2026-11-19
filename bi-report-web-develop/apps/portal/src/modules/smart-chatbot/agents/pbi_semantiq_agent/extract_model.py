"""Extract semantic model artifacts via XMLA INFO.VIEW (once per dataset_id)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from smart_common.logging import log

from .metadata import SemanticModel, build_dax_dependencies, load_model_extended
from .metadata_paths import append_jsonl_log, atomic_write_json, extraction_logs_dir, model_artifact_dir
from .powerbi_client import PowerBIClient, PowerBIError

logger = logging.getLogger(__name__)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _flatten_columns(model: SemanticModel) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table in model.tables:
        for col in table.columns:
            rows.append(
                {
                    "table": table.name,
                    "name": col.name,
                    "dataType": col.data_type,
                    "description": col.description,
                    "hidden": col.hidden,
                }
            )
    return rows


def _flatten_measures(model: SemanticModel) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table in model.tables:
        for measure in table.measures:
            rows.append(
                {
                    "table": table.name,
                    "name": measure.name,
                    "formatString": measure.format_string,
                    "description": measure.description,
                    "displayFolder": measure.display_folder,
                    "hidden": measure.hidden,
                    "expression": measure.expression,
                }
            )
    return rows


def write_model_artifacts(
    workspace_id: str,
    dataset_id: str,
    model: SemanticModel,
    *,
    hierarchies: list[dict[str, Any]],
    dax_dependencies: dict[str, Any],
    dataset_name: str | None = None,
    status: str = "ok",
    limitations: list[str] | None = None,
) -> Path:
    dest = model_artifact_dir(workspace_id, dataset_id)
    dest.mkdir(parents=True, exist_ok=True)
    meta = {
        "workspace_id": workspace_id,
        "dataset_id": dataset_id,
        "dataset_name": dataset_name or model.name,
        "extracted_at": _utc_now(),
        "extraction_status": status,
        "limitations": limitations or [],
        "stats": model.stats(),
    }
    atomic_write_json(dest / "model_metadata.json", meta)
    atomic_write_json(
        dest / "tables.json",
        {
            "tables": [{"name": t.name, "description": t.description, "hidden": t.hidden} for t in model.tables]
        },
    )
    atomic_write_json(dest / "columns.json", {"columns": _flatten_columns(model)})
    atomic_write_json(dest / "measures.json", {"measures": _flatten_measures(model)})
    atomic_write_json(dest / "relationships.json", {"relationships": [r.__dict__ for r in model.relationships]})
    atomic_write_json(dest / "hierarchies.json", {"hierarchies": hierarchies})
    atomic_write_json(dest / "dax_dependencies.json", dax_dependencies)
    return dest


async def extract_model_artifacts(
    client: PowerBIClient,
    workspace_id: str,
    dataset_id: str,
    *,
    dataset_name: str | None = None,
) -> dict[str, Any]:
    limitations: list[str] = []
    status = "ok"
    try:
        model, hierarchies, raw = await load_model_extended(client, workspace_id, dataset_id, user=None, name=dataset_name)
    except PowerBIError as exc:
        status = "unsupported" if "XMLA" in str(exc) or exc.status in {401, 403, 404} else "failed"
        append_jsonl_log(
            extraction_logs_dir() / "models.jsonl",
            {"at": _utc_now(), "workspace_id": workspace_id, "dataset_id": dataset_id, "status": status, "error": str(exc)[:300]},
        )
        log(logger, logging.WARNING, "model_extract_failed", workspace_id=workspace_id, dataset_id=dataset_id, status=status)
        return {"workspace_id": workspace_id, "dataset_id": dataset_id, "extraction_status": status, "error": str(exc)[:500]}

    if not hierarchies:
        limitations.append("hierarchies_empty_or_unsupported")
    dax_dependencies = build_dax_dependencies(model)
    path = write_model_artifacts(
        workspace_id,
        dataset_id,
        model,
        hierarchies=hierarchies,
        dax_dependencies=dax_dependencies,
        dataset_name=dataset_name or model.name,
        status=status,
        limitations=limitations,
    )
    append_jsonl_log(
        extraction_logs_dir() / "models.jsonl",
        {"at": _utc_now(), "workspace_id": workspace_id, "dataset_id": dataset_id, "status": status, "path": str(path)},
    )
    return {"workspace_id": workspace_id, "dataset_id": dataset_id, "extraction_status": status, "path": str(path), "stats": model.stats()}
