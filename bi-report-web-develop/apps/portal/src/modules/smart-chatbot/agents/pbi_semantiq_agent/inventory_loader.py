"""Read-only loader for semantic_model_catalog.jsonl (dataset grain) and enriched business context."""

from __future__ import annotations

from functools import wraps
from pathlib import Path
from typing import Any, Callable

from .metadata_paths import read_jsonl, resolve_enriched_catalog_path, semantic_inventory_file


def _sig(path: Path | None) -> tuple[str, float, int] | None:
    if path is None:
        return None
    try:
        st = path.stat()
    except OSError:
        return (str(path), 0.0, -1)
    return (str(path), st.st_mtime, st.st_size)


def file_cached(paths: Callable[[], list[Path | None]]):
    """Cache a zero-arg loader until any of its source files changes (mtime/size).

    Replaces ``lru_cache`` so a background sync that rewrites the JSONL is picked up without a restart.
    Keeps the ``cache_clear()`` API.
    """

    def deco(fn):
        state: dict[str, Any] = {"sig": None, "value": None}

        @wraps(fn)
        def wrapper():
            sig = tuple(_sig(p) for p in paths())
            if state["sig"] != sig:
                state["value"] = fn()
                state["sig"] = sig
            return state["value"]

        def cache_clear() -> None:
            state["sig"] = None

        wrapper.cache_clear = cache_clear  # type: ignore[attr-defined]
        return wrapper

    return deco


def load_semantic_inventory(path: Path | None = None) -> dict[tuple[str, str], dict[str, Any]]:
    """Index inventory rows by (workspace_id, dataset_id), lowercased. Skips empty dataset_id."""
    source = path or semantic_inventory_file()
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for row in read_jsonl(source):
        dataset_id = str(row.get("dataset_id") or "").strip()
        workspace_id = str(row.get("workspace_id") or "").strip()
        if not dataset_id or not workspace_id:
            continue
        index[(workspace_id.lower(), dataset_id.lower())] = row
    return index


def enriched_search_text(row: dict[str, Any]) -> str:
    """Flatten enriched catalog fields for lexical retrieval (not physical column names)."""
    parts: list[str] = []
    domains = row.get("business_domains") or {}
    if domains.get("primary"):
        parts.append(str(domains["primary"]))
    parts.extend(str(x) for x in domains.get("secondary") or [])
    entities = row.get("data_entities") or {}
    parts.extend(str(x) for x in entities.get("entities") or [])
    systems = row.get("related_systems") or {}
    parts.extend(str(x) for x in systems.get("inhouse_applications") or [])
    parts.extend(str(x) for x in systems.get("external_integrations") or [])
    if systems.get("data_flow_source"):
        parts.append(str(systems["data_flow_source"]))
    meta = row.get("metadata") or {}
    parts.extend(str(x) for x in meta.get("tags") or [])
    parts.extend(str(x) for x in row.get("report_names") or [])
    src = row.get("data_source") or {}
    parts.extend(str(x) for x in src.get("platforms") or [])
    return " ".join(p for p in parts if p and p.lower() != "nan")


@file_cached(lambda: [resolve_enriched_catalog_path()])
def load_enriched_inventory() -> dict[tuple[str, str], dict[str, Any]]:
    path = resolve_enriched_catalog_path()
    if not path:
        return {}
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for row in read_jsonl(path):
        dataset_id = str(row.get("dataset_id") or "").strip()
        workspace_id = str(row.get("workspace_id") or "").strip()
        if not dataset_id or not workspace_id:
            continue
        index[(workspace_id.lower(), dataset_id.lower())] = row
    return index


def enriched_row(workspace_id: str, dataset_id: str) -> dict[str, Any] | None:
    if not workspace_id or not dataset_id:
        return None
    return load_enriched_inventory().get((workspace_id.lower(), dataset_id.lower()))


@file_cached(lambda: [semantic_inventory_file()])
def load_report_to_dataset_index() -> dict[tuple[str, str], dict[str, Any]]:
    """Map (workspace_id, report_id) to dataset fields from semantic_model_catalog.jsonl reports[]."""
    index: dict[tuple[str, str], dict[str, Any]] = {}
    duplicates: set[tuple[str, str]] = set()
    for row in read_jsonl(semantic_inventory_file()):
        dataset_id = str(row.get("dataset_id") or "").strip()
        workspace_id = str(row.get("workspace_id") or "").strip()
        if not dataset_id or not workspace_id:
            continue
        ws = workspace_id.lower()
        payload = {
            "dataset_id": dataset_id,
            "dataset_workspace_id": workspace_id,
            "workspace_name": row.get("workspace_name"),
            "workspace_id": workspace_id,
        }
        for rep in row.get("reports") or []:
            report_id = str(rep.get("report_id") or "").strip()
            if not report_id:
                continue
            rid = report_id.lower()
            key = (ws, rid)
            if key in index and index[key].get("dataset_id") != dataset_id:
                duplicates.add(key)
            else:
                index[key] = {**payload, "report_id": report_id, "report_name": rep.get("report_name")}
    for key in duplicates:
        index.pop(key, None)
    return index


def resolve_report_from_inventory(workspace_id: str, report_id: str) -> dict[str, Any] | None:
    """Offline report→dataset when portal catalog is absent. Never guesses from report title."""
    ws = (workspace_id or "").strip().lower()
    rid = (report_id or "").strip().lower()
    if not ws or not rid:
        return None
    hit = load_report_to_dataset_index().get((ws, rid))
    if hit:
        return {**hit, "source": "semantic_inventory", "mapping_status": "mapped_inventory"}
    # Same report_id under another dataset workspace (report workspace != dataset workspace)
    matches: list[dict[str, Any]] = []
    for (_dws, r), row in load_report_to_dataset_index().items():
        if r == rid:
            matches.append(row)
    if len(matches) == 1:
        row = matches[0]
        return {**row, "source": "semantic_inventory", "mapping_status": "mapped_inventory_global_report_id"}
    return None
