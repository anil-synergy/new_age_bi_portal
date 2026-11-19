"""Build pbi_semantic_metadata from portal Postgres + Power BI REST + XMLA INFO.VIEW."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from smart_common.logging import configure_logging, log

from .catalog_disk import menu_slug, metadata_root, slugify
from .catalog_postgres import fetch_portal_reports
from .metadata import SemanticModel, load_model
from .powerbi_client import PowerBIClient, PowerBIError
from .settings import get_settings

logger = logging.getLogger(__name__)

EXPR_LIMIT = 2000


def _truncate(text: str | None, limit: int = EXPR_LIMIT) -> str:
    if not text:
        return ""
    text = str(text)
    return text if len(text) <= limit else text[: limit - 3] + "..."


def _write_md(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.strip() + "\n", encoding="utf-8")


def _model_markdown(model: SemanticModel, datasources: list[dict[str, Any]], meta: dict[str, Any]) -> dict[str, str]:
    tables = []
    for t in sorted(model.tables, key=lambda x: x.name.lower()):
        if t.hidden:
            continue
        tables.append(f"## {t.name}\n{t.description or ''}")
    tables_md = "# Tables\n\n" + "\n\n".join(tables) if tables else "# Tables\n\n(none)"

    measures_lines = ["# Measures\n"]
    for t in model.tables:
        for m in sorted(t.measures, key=lambda x: x.name.lower()):
            if m.hidden:
                continue
            folder = f" ({m.display_folder})" if m.display_folder else ""
            measures_lines.append(f"- **{t.name}[{m.name}]**{folder}")
            if m.description:
                measures_lines.append(f"  - {m.description}")
            expr = _truncate(m.expression, 400)
            if expr:
                measures_lines.append(f"  - expression: {expr}")

    cols = ["# Columns\n"]
    for t in model.tables:
        for c in sorted(t.columns, key=lambda x: x.name.lower()):
            if c.hidden:
                continue
            cols.append(f"- {t.name}[{c.name}] ({c.data_type or 'unknown'})")

    rels = ["# Relationships\n"]
    for r in model.relationships:
        rels.append(
            f"- '{r.from_table}'[{r.from_column}] -> '{r.to_table}'[{r.to_column}] "
            f"{r.cardinality or ''} {'active' if r.active else 'inactive'}"
        )

    ds_lines = ["# Data sources (REST, no secrets)\n"]
    for ds in datasources:
        dtype = ds.get("datasourceType") or "Unknown"
        details = ds.get("connectionDetails") or {}
        brief = ", ".join(f"{k}={v}" for k, v in details.items() if v)
        ds_lines.append(f"- **{dtype}**: {brief or '(redacted)'}")

    model_readme = "\n".join(
        [
            f"# {meta.get('dataset_name') or model.name or model.dataset_id}",
            "",
            f"- workspace_id: `{model.workspace_id}`",
            f"- dataset_id: `{model.dataset_id}`",
            f"- storage_mode: {meta.get('storage_mode') or 'unknown'}",
            f"- identity_required: {meta.get('isEffectiveIdentityRequired')}",
            f"- roles_required: {meta.get('isEffectiveIdentityRolesRequired')}",
            f"- skip_reason: {meta.get('skip_reason') or 'none'}",
        ]
    )
    return {
        "README.md": model_readme,
        "datasources.md": "\n".join(ds_lines),
        "tables.md": tables_md,
        "measures.md": "\n".join(measures_lines),
        "columns.md": "\n".join(cols),
        "relationships.md": "\n".join(rels),
    }


async def _enrich_one(client: PowerBIClient, row: dict[str, Any], sem: asyncio.Semaphore) -> dict[str, Any]:
    async with sem:
        ws = row["workspace_id"]
        rid = row["report_id"]
        entry = {**row, "datasources": [], "dataset_id": None, "dataset_workspace_id": ws, "skip_reason": None}
        try:
            report = await client.get_report(ws, rid)
            ds_id = report.get("datasetId")
            ds_ws = report.get("datasetWorkspaceId") or ws
            if not ds_id:
                entry["skip_reason"] = "no_dataset_on_report"
                return entry
            entry["dataset_id"] = ds_id
            entry["dataset_workspace_id"] = ds_ws
            datasets = await client.list_datasets(ds_ws)
            ds_meta = next((d for d in datasets if str(d.get("id", "")).lower() == ds_id.lower()), {})
            entry["dataset_name"] = ds_meta.get("name")
            entry["storage_mode"] = ds_meta.get("targetStorageMode")
            entry["isEffectiveIdentityRequired"] = ds_meta.get("isEffectiveIdentityRequired")
            entry["isEffectiveIdentityRolesRequired"] = ds_meta.get("isEffectiveIdentityRolesRequired")
            entry["datasources"] = await client.list_datasources(ds_ws, ds_id)
            ws_rec = await client._workspace_record(ws)
            entry["workspace_name"] = ws_rec.get("name")
        except PowerBIError as exc:
            entry["skip_reason"] = str(exc)[:200]
            return entry

        try:
            model = await load_model(client, entry["dataset_workspace_id"], entry["dataset_id"], user=None, name=entry.get("dataset_name"))
            entry["model"] = model
            entry["measure_names"] = [m.name for m in model.all_measures() if not m.hidden][:200]
            entry["table_names"] = [t.name for t in model.tables if not t.hidden][:200]
        except PowerBIError as exc:
            entry["skip_reason"] = (entry.get("skip_reason") or "") + f"; xmla:{exc}"[:180]
            entry["model"] = None
        return entry


async def build_async(*, root: Path, concurrency: int, limit: int | None) -> None:
    settings = get_settings()
    client = PowerBIClient(settings)
    rows = fetch_portal_reports()
    if limit:
        rows = rows[:limit]
    sem = asyncio.Semaphore(max(1, concurrency))
    enriched = await asyncio.gather(*[_enrich_one(client, row, sem) for row in rows])

    root.mkdir(parents=True, exist_ok=True)
    index_lines = ["# Portal report metadata index", "", f"Generated: {datetime.now(timezone.utc).isoformat()}", ""]
    catalog_reports: list[dict[str, Any]] = []

    for item in enriched:
        title = item.get("title") or "report"
        portal_id = item["portal_id"]
        ws_name = slugify(item.get("workspace_name") or item["workspace_id"])
        menu = menu_slug(item.get("menu_path") or "uncategorized")
        report_dir_name = f"{slugify(title)}-{portal_id[:8]}"
        report_base = root / ws_name / menu / report_dir_name
        dataset_name = item.get("dataset_name") or item.get("dataset_id") or "model"
        model_dir = report_base / slugify(dataset_name)
        disk_path = str(model_dir.relative_to(root)).replace("\\", "/")

        report_readme = "\n".join(
            [
                f"# {title}",
                "",
                f"- portal_id: `{portal_id}`",
                f"- menu_path: {item.get('menu_path') or '(flat)'}",
                f"- workspace_id: `{item.get('workspace_id')}`",
                f"- report_id: `{item.get('report_id')}`",
                f"- dataset_id: `{item.get('dataset_id')}`",
                f"- skip_reason: {item.get('skip_reason') or 'none'}",
            ]
        )
        _write_md(report_base / "README.md", report_readme)
        index_lines.append(
            f"- **{item.get('menu_path') or 'Uncategorized'} > {title}** "
            f"(ws `{item.get('workspace_id')}`, report `{item.get('report_id')}`, dataset `{item.get('dataset_id')}`)"
        )

        model: SemanticModel | None = item.get("model")
        if model:
            files = _model_markdown(model, item.get("datasources") or [], item)
            for name, body in files.items():
                _write_md(model_dir / name, body)
            model_json = model.to_dict(include_hidden=False, include_expressions=True)
            model_dir.mkdir(parents=True, exist_ok=True)
            (model_dir / "model.json").write_text(json.dumps(model_json, indent=2), encoding="utf-8")
        elif item.get("skip_reason"):
            _write_md(model_dir / "README.md", f"# Skipped\n\n{item['skip_reason']}")

        catalog_reports.append(
            {
                "portal_id": portal_id,
                "title": title,
                "description": item.get("description"),
                "menu_path": item.get("menu_path"),
                "workspace_id": item.get("workspace_id"),
                "workspace_name": item.get("workspace_name"),
                "report_id": item.get("report_id"),
                "dataset_id": item.get("dataset_id"),
                "dataset_workspace_id": item.get("dataset_workspace_id"),
                "dataset_name": item.get("dataset_name"),
                "storage_mode": item.get("storage_mode"),
                "datasources": item.get("datasources") or [],
                "measure_names": item.get("measure_names") or [],
                "table_names": item.get("table_names") or [],
                "skip_reason": item.get("skip_reason"),
                "disk_path": disk_path,
            }
        )

    _write_md(root / "INDEX.md", "\n".join(index_lines))
    catalog = {"generated_at": datetime.now(timezone.utc).isoformat(), "reports": catalog_reports}
    (root / "catalog.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    log(logger, logging.INFO, "metadata_built", reports=len(catalog_reports), root=str(root))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build pbi_semantic_metadata for portal menu reports.")
    parser.add_argument("--output", type=Path, default=metadata_root())
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--limit", type=int, default=None, help="Max reports (debug)")
    args = parser.parse_args()
    settings = get_settings()
    configure_logging("pbi_semantiq_agent", settings.log_level)
    asyncio.run(build_async(root=args.output, concurrency=args.concurrency, limit=args.limit))


if __name__ == "__main__":
    main()
