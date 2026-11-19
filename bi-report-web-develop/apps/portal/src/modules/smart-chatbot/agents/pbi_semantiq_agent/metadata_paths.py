"""Paths and atomic writers for the SemantIQ metadata intelligence layer."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Iterable

CATALOG_SCHEMA_VERSION = "1.0"


def metadata_workspace_root() -> Path:
    """Writable root (default: checked-in Workspace_semantic_metadata/)."""
    env = os.environ.get("PBI_METADATA_ROOT", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parent / "pbi_semantic_metadata" / "Workspace_semantic_metadata"


def legacy_metadata_root() -> Path:
    return Path(__file__).resolve().parent / "pbi_semantic_metadata"


def portal_catalog_file() -> Path:
    return metadata_workspace_root() / "portal_report_semantic_catalog.jsonl"


def semantic_inventory_file() -> Path:
    return metadata_workspace_root() / "semantic_model_catalog.jsonl"


def semantic_enriched_catalog_file() -> Path:
    """Enriched dataset inventory (business domains, entities, systems)."""
    return metadata_workspace_root() / "semantic_model_catalog_enriched.jsonl"


def resolve_enriched_catalog_path() -> Path | None:
    """First existing enriched catalog: workspace root, package default, then env override."""
    override = os.environ.get("PBI_ENRICHED_CATALOG", "").strip()
    if override:
        path = Path(override)
        if path.is_file():
            return path
    for candidate in (
        semantic_enriched_catalog_file(),
        Path(__file__).resolve().parent / "semantic_model_catalog_enriched.jsonl",
    ):
        if candidate.is_file():
            return candidate
    return None


def ontology_dir() -> Path:
    packaged = Path(__file__).resolve().parent / "ontology"
    workspace = metadata_workspace_root() / "ontology"

    def _readable(root: Path) -> bool:
        probe = root / "business_ontology.json"
        if not probe.is_file():
            return False
        try:
            probe.read_text(encoding="utf-8")
            return True
        except OSError:
            return False

    if _readable(workspace):
        return workspace
    if packaged.is_dir():
        return packaged
    return workspace


def sync_state_file() -> Path:
    return metadata_workspace_root() / "sync_state.json"


def report_artifact_dir(workspace_id: str, report_id: str) -> Path:
    return metadata_workspace_root() / "workspaces" / workspace_id / "reports" / report_id


def model_artifact_dir(workspace_id: str, dataset_id: str) -> Path:
    return metadata_workspace_root() / "workspaces" / workspace_id / "semantic_models" / dataset_id


def sync_logs_dir() -> Path:
    return metadata_workspace_root() / "sync_logs"


def extraction_logs_dir() -> Path:
    return metadata_workspace_root() / "extraction_logs"


def _atomic_replace(tmp: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.replace(tmp, dest)


def atomic_write_text(dest: Path, text: str, *, encoding: str = "utf-8") -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=dest.parent, prefix=f".{dest.name}.", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding=encoding) as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        _atomic_replace(tmp, dest)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def atomic_write_json(dest: Path, data: Any) -> None:
    atomic_write_text(dest, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def atomic_write_jsonl(dest: Path, records: Iterable[dict[str, Any]]) -> None:
    lines = [json.dumps(row, ensure_ascii=False) for row in records]
    atomic_write_text(dest, "\n".join(lines) + ("\n" if lines else ""))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def append_jsonl_log(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
