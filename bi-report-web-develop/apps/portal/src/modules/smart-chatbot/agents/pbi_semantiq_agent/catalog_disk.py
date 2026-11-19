"""Local pbi_semantic_metadata index (portal catalog jsonl, legacy catalog.json, artifacts)."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from smart_common.keywords import with_stems

from .metadata import SemanticModel, Table, Column, Measure, Relationship, model_from_dict
from .inventory_loader import enriched_row, enriched_search_text, load_enriched_inventory, resolve_report_from_inventory
from .metadata_paths import legacy_metadata_root, metadata_workspace_root, model_artifact_dir, portal_catalog_file, read_jsonl, report_artifact_dir

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {
    "the", "a", "an", "of", "for", "by", "in", "on", "to", "and", "or", "is", "are", "what", "which", "show", "me",
}


def metadata_root() -> Path:
    """Legacy slug tree root (catalog.json); portal catalog lives under workspace root."""
    return legacy_metadata_root()


def slugify(text: str, *, max_len: int = 56) -> str:
    raw = re.sub(r"[^\w\s-]", "", (text or "").strip(), flags=re.UNICODE)
    raw = re.sub(r"[\s_]+", "-", raw.lower()).strip("-")
    if not raw:
        raw = "item"
    return raw[:max_len]


def menu_slug(menu_path: str) -> str:
    parts = [slugify(p, max_len=32) for p in (menu_path or "uncategorized").split(">")]
    return "/".join(p for p in parts if p)


@dataclass
class CatalogStore:
    root: Path
    _mtime: float = 0.0
    _index: dict[str, Any] | None = None
    _portal_mtime: float = 0.0
    _portal_rows: list[dict[str, Any]] | None = None
    _artifact_cache: dict[str, dict[str, Any]] | None = None
    _enriched_mtime: float = 0.0
    _enriched_index: dict[tuple[str, str], dict[str, Any]] | None = None

    @classmethod
    def default(cls) -> CatalogStore:
        return cls(metadata_root())

    def _load_legacy(self) -> dict[str, Any]:
        path = self.root / "catalog.json"
        if not path.is_file():
            return {"reports": []}
        mtime = path.stat().st_mtime
        if self._index is not None and mtime == self._mtime:
            return self._index
        self._index = json.loads(path.read_text(encoding="utf-8"))
        self._mtime = mtime
        return self._index

    def _load_enriched(self) -> dict[tuple[str, str], dict[str, Any]]:
        from .metadata_paths import resolve_enriched_catalog_path

        path = resolve_enriched_catalog_path()
        if not path:
            self._enriched_index = {}
            return self._enriched_index
        mtime = path.stat().st_mtime
        if self._enriched_index is not None and mtime == self._enriched_mtime:
            return self._enriched_index
        load_enriched_inventory.cache_clear()
        self._enriched_index = load_enriched_inventory()
        self._enriched_mtime = mtime
        return self._enriched_index

    def enriched_text(self, workspace_id: str, dataset_id: str) -> str:
        row = self._load_enriched().get((workspace_id.lower(), dataset_id.lower()))
        if not row:
            row = enriched_row(workspace_id, dataset_id)
        return enriched_search_text(row) if row else ""

    def _load_portal(self) -> list[dict[str, Any]]:
        path = portal_catalog_file()
        if not path.is_file():
            return []
        mtime = path.stat().st_mtime
        if self._portal_rows is not None and mtime == self._portal_mtime:
            return self._portal_rows
        self._portal_rows = read_jsonl(path)
        self._portal_mtime = mtime
        self._artifact_cache = None
        return self._portal_rows

    def reports(self) -> list[dict[str, Any]]:
        portal = self._load_portal()
        if portal:
            return [self._enriched_row(row) for row in portal]
        return list(self._load_legacy().get("reports") or [])

    def _artifact_tokens(self, row: dict[str, Any]) -> dict[str, list[str]]:
        ws = str(row.get("workspace_id") or "")
        report_id = str(row.get("report_id") or "")
        dataset_ws = str(row.get("dataset_workspace_id") or ws)
        dataset_id = str(row.get("dataset_id") or "")
        cache_key = f"{ws}|{report_id}|{dataset_ws}|{dataset_id}"
        if self._artifact_cache is None:
            self._artifact_cache = {}
        if cache_key in self._artifact_cache:
            return self._artifact_cache[cache_key]

        pages: list[str] = []
        visuals: list[str] = []
        measures: list[str] = []
        columns: list[str] = []
        tables: list[str] = []

        report_dir = report_artifact_dir(ws, report_id)
        pages_path = report_dir / "pages.json"
        if pages_path.is_file():
            try:
                data = json.loads(pages_path.read_text(encoding="utf-8"))
                for page in data.get("pages") or []:
                    if page.get("displayName"):
                        pages.append(str(page["displayName"]))
                    elif page.get("name"):
                        pages.append(str(page["name"]))
            except json.JSONDecodeError:
                pass
        visuals_path = report_dir / "visuals.json"
        if visuals_path.is_file():
            try:
                data = json.loads(visuals_path.read_text(encoding="utf-8"))
                for visual in data.get("visuals") or []:
                    title = visual.get("title") or visual.get("name")
                    if title:
                        visuals.append(str(title))
            except json.JSONDecodeError:
                pass

        model_dir = model_artifact_dir(dataset_ws, dataset_id) if dataset_id else None
        if model_dir and model_dir.is_dir():
            for file_name, bucket in (
                ("measures.json", measures),
                ("columns.json", columns),
                ("tables.json", tables),
            ):
                path = model_dir / file_name
                if not path.is_file():
                    continue
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    continue
                key = file_name.split(".")[0]
                for item in data.get(key) or []:
                    name = item.get("name")
                    if name:
                        bucket.append(str(name))

        payload = {
            "page_names": pages,
            "visual_titles": visuals,
            "measure_names": measures,
            "column_names": columns,
            "table_names": tables,
        }
        self._artifact_cache[cache_key] = payload
        return payload

    def _enriched_row(self, row: dict[str, Any]) -> dict[str, Any]:
        tokens = self._artifact_tokens(row)
        return {
            **row,
            **tokens,
            "measure_names": tokens["measure_names"] or row.get("measure_names") or [],
            "table_names": tokens["table_names"] or row.get("table_names") or [],
            "page_names": tokens["page_names"],
            "visual_titles": tokens["visual_titles"],
        }

    def enrichment_for_item(self, item: dict[str, Any]) -> str:
        ws = str(item.get("workspace_id") or "").lower()
        report_id = str(item.get("report_id") or "").lower()
        dws = str(item.get("dataset_workspace_id") or item.get("workspace_id") or "").lower()
        dataset_id = str(item.get("dataset_id") or "").lower()
        business = self.enriched_text(dws or ws, dataset_id) if dataset_id else ""
        for row in self._load_portal():
            if str(row.get("workspace_id") or "").lower() == ws and str(row.get("report_id") or "").lower() == report_id:
                enriched = self._enriched_row(row)
                parts = [
                    business,
                    " ".join(enriched.get("visual_titles") or []),
                    " ".join(enriched.get("page_names") or []),
                    " ".join(enriched.get("measure_names") or []),
                    " ".join(enriched.get("column_names") or []),
                ]
                return " ".join(p for p in parts if p).strip()
        if business:
            return business
        if dataset_id:
            return self.enriched_text(dws or ws, dataset_id)
        return ""

    def by_dataset(self, workspace_id: str, dataset_id: str) -> dict[str, Any] | None:
        ws, ds = workspace_id.lower(), dataset_id.lower()
        for row in self.reports():
            dws = str(row.get("dataset_workspace_id") or row.get("workspace_id") or "").lower()
            if dws == ws and str(row.get("dataset_id") or "").lower() == ds:
                return row
        for row in self.reports():
            if str(row.get("workspace_id", "")).lower() == ws and str(row.get("dataset_id", "")).lower() == ds:
                return row
        return None

    def by_report(self, workspace_id: str, report_id: str) -> dict[str, Any] | None:
        ws, rid = workspace_id.lower(), report_id.lower()
        for row in self.reports():
            if str(row.get("workspace_id", "")).lower() == ws and str(row.get("report_id", "")).lower() == rid:
                return row
        return None

    def resolve_report_dataset(self, workspace_id: str, report_id: str) -> dict[str, Any] | None:
        """Deterministic (workspace_id, report_id) → dataset_id / dataset_workspace_id without title guessing."""
        entry = self.by_report(workspace_id, report_id)
        if entry and str(entry.get("dataset_id") or "").strip():
            dws = str(entry.get("dataset_workspace_id") or entry.get("workspace_id") or workspace_id)
            return {
                "report_id": report_id,
                "workspace_id": workspace_id,
                "dataset_id": str(entry["dataset_id"]),
                "dataset_workspace_id": dws,
                "source": "portal_catalog",
                "mapping_status": entry.get("mapping_status") or "mapped",
                "catalog_entry": entry,
                "title": entry.get("title") or entry.get("report_name"),
            }
        inv = resolve_report_from_inventory(workspace_id, report_id)
        if inv and str(inv.get("dataset_id") or "").strip():
            dws = str(inv.get("dataset_workspace_id") or inv.get("workspace_id") or workspace_id)
            return {
                "report_id": report_id,
                "workspace_id": workspace_id,
                "dataset_id": str(inv["dataset_id"]),
                "dataset_workspace_id": dws,
                "source": inv.get("source") or "semantic_inventory",
                "mapping_status": inv.get("mapping_status") or "mapped_inventory",
                "title": inv.get("report_name"),
            }
        return None

    def model_json_path(self, entry: dict[str, Any]) -> Path | None:
        rel = entry.get("disk_path")
        if not rel:
            dataset_ws = str(entry.get("dataset_workspace_id") or entry.get("workspace_id") or "")
            dataset_id = str(entry.get("dataset_id") or "")
            if dataset_ws and dataset_id:
                legacy = model_artifact_dir(dataset_ws, dataset_id) / "model_metadata.json"
                return legacy if legacy.is_file() else None
            return None
        path = self.root / str(rel) / "model.json"
        return path if path.is_file() else None

    def _model_from_artifact_dir(self, workspace_id: str, dataset_id: str) -> SemanticModel | None:
        base = model_artifact_dir(workspace_id, dataset_id)
        meta_path = base / "model_metadata.json"
        measures_path = base / "measures.json"
        columns_path = base / "columns.json"
        relationships_path = base / "relationships.json"
        if not measures_path.is_file():
            return None
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
            measures_rows = json.loads(measures_path.read_text(encoding="utf-8")).get("measures") or []
            column_rows = json.loads(columns_path.read_text(encoding="utf-8")).get("columns") if columns_path.is_file() else []
            rel_rows = json.loads(relationships_path.read_text(encoding="utf-8")).get("relationships") if relationships_path.is_file() else []
        except json.JSONDecodeError:
            return None

        tables: dict[str, Table] = {}
        for row in column_rows or []:
            tname = str(row.get("table") or "")
            if not tname:
                continue
            tables.setdefault(tname.lower(), Table(name=tname))
            tables[tname.lower()].columns.append(
                Column(
                    name=str(row.get("name") or ""),
                    data_type=row.get("dataType"),
                    description=row.get("description"),
                    hidden=bool(row.get("hidden")),
                )
            )
        for row in measures_rows:
            tname = str(row.get("table") or "")
            if not tname:
                continue
            tables.setdefault(tname.lower(), Table(name=tname))
            tables[tname.lower()].measures.append(
                Measure(
                    name=str(row.get("name") or ""),
                    table=tname,
                    expression=row.get("expression"),
                    format_string=row.get("formatString"),
                    description=row.get("description"),
                    display_folder=row.get("displayFolder"),
                    hidden=bool(row.get("hidden")),
                )
            )
        relationships = [
            Relationship(
                from_table=r.get("from_table") or "",
                from_column=r.get("from_column") or "",
                to_table=r.get("to_table") or "",
                to_column=r.get("to_column") or "",
                cardinality=r.get("cardinality"),
                active=bool(r.get("active", True)),
                cross_filter=r.get("cross_filter"),
            )
            for r in rel_rows or []
        ]
        return SemanticModel(
            workspace_id,
            dataset_id,
            meta.get("dataset_name"),
            list(tables.values()),
            relationships,
        )

    def load_model_from_disk(self, workspace_id: str, dataset_id: str) -> SemanticModel | None:
        entry = self.by_dataset(workspace_id, dataset_id)
        artifact = self._model_from_artifact_dir(
            str(entry.get("dataset_workspace_id") if entry else workspace_id) or workspace_id,
            dataset_id,
        )
        if artifact:
            return artifact
        if not entry:
            return None
        path = self.model_json_path(entry)
        if not path or not path.name == "model.json":
            if path and path.name == "model_metadata.json":
                return self._model_from_artifact_dir(workspace_id, dataset_id)
            legacy_path = self.root / str(entry.get("disk_path") or "") / "model.json"
            path = legacy_path if legacy_path.is_file() else path
        if not path or not path.is_file():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return model_from_dict(data)

    def _tokens(self, text: str) -> set[str]:
        words = {w for w in _WORD.findall((text or "").lower()) if w not in _STOP and len(w) > 1}
        return with_stems(words)

    def _search_blob(self, row: dict[str, Any]) -> str:
        dws = str(row.get("dataset_workspace_id") or row.get("workspace_id") or "")
        ds = str(row.get("dataset_id") or "")
        business = self.enriched_text(dws, ds) if ds else ""
        return " ".join(
            filter(
                None,
                [
                    row.get("title"),
                    row.get("menu_path"),
                    row.get("dataset_name"),
                    row.get("workspace_name"),
                    row.get("report_name"),
                    business,
                    " ".join(row.get("measure_names") or []),
                    " ".join(row.get("table_names") or []),
                    " ".join(row.get("page_names") or []),
                    " ".join(row.get("visual_titles") or []),
                    " ".join(row.get("column_names") or []),
                ],
            )
        )

    def resolve_ids(self, question: str) -> dict[str, Any] | None:
        """Return a single catalog row when the question uniquely matches one report/model."""
        q = self._tokens(question)
        if not q:
            return None
        scored: list[tuple[float, dict[str, Any]]] = []
        for row in self.reports():
            t = self._tokens(self._search_blob(row))
            overlap = len(q & t)
            if overlap == 0:
                continue
            score = overlap / max(len(q), 1)
            if row.get("title") and all(tok in self._tokens(str(row["title"])) for tok in q if len(tok) > 3):
                score += 0.5
            scored.append((score, row))
        if not scored:
            return None
        scored.sort(key=lambda x: -x[0])
        best, second = scored[0][0], scored[1][0] if len(scored) > 1 else 0.0
        if best < 0.35:
            return None
        if second and best - second < 0.15:
            return None
        return scored[0][1]

    def search(self, query: str, *, limit: int = 15) -> list[dict[str, Any]]:
        q = self._tokens(query)
        if not q:
            return []
        out: list[tuple[float, dict[str, Any]]] = []
        seen_ds: set[str] = set()
        for row in self.reports():
            t = self._tokens(self._search_blob(row))
            overlap = len(q & t)
            if overlap:
                ds = str(row.get("dataset_id") or "").lower()
                if ds:
                    seen_ds.add(ds)
                out.append((overlap / len(q), {**row, "score": round(overlap / len(q), 3)}))
        for (workspace_id, dataset_id), enriched in self._load_enriched().items():
            if dataset_id in seen_ds:
                continue
            title = " ".join(str(n) for n in enriched.get("report_names") or [])
            blob = " ".join(filter(None, [title, enriched_search_text(enriched), enriched.get("workspace_name")]))
            t = self._tokens(blob)
            overlap = len(q & t)
            if not overlap:
                continue
            synthetic = {
                "title": title or dataset_id,
                "report_name": title,
                "workspace_id": workspace_id,
                "dataset_workspace_id": workspace_id,
                "dataset_id": dataset_id,
                "workspace_name": enriched.get("workspace_name"),
                "source": "enriched_catalog",
            }
            out.append((overlap / len(q), {**synthetic, "score": round(overlap / len(q), 3)}))
        out.sort(key=lambda x: -x[0])
        return [row for _, row in out[:limit]]

    def datasources_summary(self, entry: dict[str, Any] | None) -> str:
        if not entry:
            return ""
        lines = ["DATA CONNECTIONS (from portal metadata):"]
        for dtype in entry.get("datasource_types") or []:
            lines.append(f"- {dtype}")
        for kind in entry.get("source_kinds") or []:
            lines.append(f"- source: {kind}")
        for ds in entry.get("datasources") or []:
            dtype = ds.get("datasourceType") or "Unknown"
            details = ds.get("connectionDetails") or {}
            brief = ", ".join(f"{k}={v}" for k, v in list(details.items())[:6] if v and "password" not in k.lower())
            lines.append(f"- {dtype}: {brief or '(details redacted)'}")
        if entry.get("last_refresh"):
            lines.append(f"- last_refresh: {entry.get('last_refresh')} ({entry.get('refresh_status') or 'unknown'})")
        mode = entry.get("storage_mode")
        if mode:
            lines.append(f"- storage: {mode}")
        return "\n".join(lines)


@lru_cache
def get_catalog_store() -> CatalogStore:
    return CatalogStore.default()


def workspace_metadata_root() -> Path:
    return metadata_workspace_root()
