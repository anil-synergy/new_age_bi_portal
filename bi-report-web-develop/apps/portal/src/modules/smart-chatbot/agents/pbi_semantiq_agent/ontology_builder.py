"""Generate ontology concept bindings from extracted semantic-model schemas.

Output (under ``ontology_dir()``):

* ``concept_bindings.auto.jsonl``   - unambiguous matches; loaded at runtime. Reviewed rows in
  ``concept_bindings.jsonl`` always override these.
* ``concept_bindings.review.jsonl`` - ambiguous or weak matches. Never used at runtime; a human can
  promote a row into ``concept_bindings.jsonl``.

Only column bindings are generated. New concepts, aliases and rules are *not* written here; they go
through the reviewed proposal flow (see ``ontology_proposer``).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from smart_common.logging import log

from .metadata import SemanticModel
from .metadata_paths import atomic_write_jsonl, ontology_dir, read_jsonl
from .ontology import AUTO_BINDINGS_FILE, REVIEW_BINDINGS_FILE, _clear_bindings_cache
from .vessel_master import VESSEL_ATTR_CONCEPTS, vessel_master_table

logger = logging.getLogger(__name__)

_NORM = re.compile(r"[^a-z0-9]+")
# Concepts resolved per question (calendar paths) or measure-based; not column-bound here.
_SKIP_CONCEPTS = frozenset({"reporting_period"})
AUTO_MIN_SCORE = 0.85
GENERIC_NAME_MAX_LEN = 4  # "Name", "Date", "Type": too common to trust outside the vessel master


def _norm(text: str) -> str:
    return _NORM.sub("", (text or "").lower())


@dataclass(frozen=True)
class Candidate:
    table: str
    column: str
    data_type: str | None
    score: float
    reason: str

    def key(self) -> tuple[str, str]:
        return (self.table.lower(), self.column.lower())


def _read_json(path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    except (OSError, json.JSONDecodeError):
        return {}


def candidates_for(
    model: SemanticModel, allow_names: list[str], *, master: str | None, prefer_master: bool
) -> list[Candidate]:
    """All plausible columns for a concept, best first. Mirrors ``ontology._match_column`` scoring."""
    allowed = {_norm(n) for n in allow_names if n}
    out: dict[tuple[str, str], Candidate] = {}
    for table in model.tables:
        if table.hidden:
            continue
        in_master = bool(master) and table.name.lower() == master.lower()
        for col in table.columns:
            if col.hidden:
                continue
            key = _norm(col.name)
            if not key:
                continue
            if key in allowed:
                generic = len(key) <= GENERIC_NAME_MAX_LEN
                score, reason = 0.85, "exact_name"
                if generic and not (in_master and prefer_master):
                    score, reason = 0.6, "generic_name"
            elif any(len(a) > 4 and a in key for a in allowed):
                score, reason = 0.7, "partial_name"
            else:
                continue
            if in_master and prefer_master:
                score = min(score + 0.07, 0.95)
                reason += "+vessel_master"
            cand = Candidate(table.name, col.name, col.data_type, round(score, 3), reason)
            out[cand.key()] = cand
    return sorted(out.values(), key=lambda c: (-c.score, c.table.lower(), c.column.lower()))


def schema_hash(model: SemanticModel) -> str:
    blob = "|".join(
        sorted(f"{t.name}.{c.name}:{c.data_type}" for t in model.tables if not t.hidden for c in t.columns if not c.hidden)
    )
    return hashlib.blake2b(blob.encode("utf-8"), digest_size=8).hexdigest()


def generate_bindings(model: SemanticModel, dataset_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return ``(auto_rows, review_rows)`` for one dataset."""
    base = ontology_dir()
    concepts = _read_json(base / "business_ontology.json").get("concepts") or []
    rules = _read_json(base / "business_rules.json")
    extra = ((rules.get("vessel_dimension_table") or {}).get("columns_by_concept") or {})
    master = vessel_master_table(model, rules)
    now = datetime.now(timezone.utc).isoformat()
    sh = schema_hash(model)

    auto: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    for spec in concepts:
        cid = str(spec.get("id") or "")
        allow = list(dict.fromkeys([*(spec.get("column_allow_names") or []), *(extra.get(cid) or [])]))
        if not cid or not allow or cid in _SKIP_CONCEPTS:
            continue
        cands = candidates_for(model, allow, master=master, prefer_master=cid in VESSEL_ATTR_CONCEPTS)
        if not cands:
            continue
        best = cands[0]
        tied = [c for c in cands[1:] if abs(c.score - best.score) < 1e-6]
        row = {
            "dataset_id": dataset_id.lower(),
            "concept": cid,
            "table": best.table,
            "column": best.column,
            "data_type": best.data_type,
            "confidence": best.score,
            "source": "auto_scan",
            "reason": best.reason,
            "scanned_at": now,
            "schema_hash": sh,
        }
        if best.score >= AUTO_MIN_SCORE and not tied:
            auto.append(row)
        else:
            row["alternatives"] = [{"table": c.table, "column": c.column, "score": c.score} for c in cands[1:4]]
            row["review_reason"] = "ambiguous" if tied else "low_confidence"
            review.append(row)
    return auto, review


def _replace_dataset_rows(path, dataset_ids: set[str], new_rows: list[dict[str, Any]]) -> int:
    """Rewrite ``path`` keeping rows of other datasets; rows for ``dataset_ids`` are replaced."""
    keep = [r for r in read_jsonl(path) if str(r.get("dataset_id") or "").lower() not in dataset_ids]
    atomic_write_jsonl(path, [*keep, *new_rows])
    return len(new_rows)


def _load_model(workspace_id: str, dataset_id: str) -> SemanticModel | None:
    from .catalog_disk import get_catalog_store

    return get_catalog_store()._model_from_artifact_dir(workspace_id, dataset_id)


def update_bindings_for_models(
    model_outcomes: list[dict[str, Any]],
    records: list[dict[str, Any]],
    *,
    full: bool = False,
) -> dict[str, Any]:
    """Regenerate bindings for the datasets that were just (re-)extracted.

    ``full`` also drops binding rows of datasets that no longer exist in the portal catalogue.
    """
    base = ontology_dir()
    targets: dict[str, str] = {}
    for o in model_outcomes:
        ds, ws = str(o.get("dataset_id") or ""), str(o.get("workspace_id") or "")
        if ds and ws:
            targets[ds.lower()] = ws

    auto_rows: list[dict[str, Any]] = []
    review_rows: list[dict[str, Any]] = []
    done: set[str] = set()
    for ds, ws in targets.items():
        model = _load_model(ws, ds)
        if model is None:
            continue
        a, r = generate_bindings(model, ds)
        auto_rows.extend(a)
        review_rows.extend(r)
        done.add(ds)

    auto_path, review_path = base / AUTO_BINDINGS_FILE, base / REVIEW_BINDINGS_FILE
    if done:
        _replace_dataset_rows(auto_path, done, auto_rows)
        _replace_dataset_rows(review_path, done, review_rows)
    removed = 0
    if full:
        live = {str(r.get("dataset_id") or "").lower() for r in records if r.get("dataset_id")}
        for path in (auto_path, review_path):
            rows = read_jsonl(path)
            kept = [r for r in rows if str(r.get("dataset_id") or "").lower() in live]
            if len(kept) != len(rows):
                removed += len(rows) - len(kept)
                atomic_write_jsonl(path, kept)
    _clear_bindings_cache()
    result = {
        "status": "ok",
        "datasets": len(done),
        "auto": len(auto_rows),
        "review": len(review_rows),
        "removed_stale": removed,
    }
    log(logger, logging.INFO, "ontology_bindings_updated", **{k: v for k, v in result.items() if k != "status"})
    return result


def regenerate_all() -> dict[str, Any]:
    """Rebuild bindings from every extracted model on disk (CLI / admin use)."""
    from .metadata_paths import metadata_workspace_root

    outcomes: list[dict[str, Any]] = []
    root = metadata_workspace_root() / "workspaces"
    if root.is_dir():
        for meta in root.glob("*/semantic_models/*/model_metadata.json"):
            outcomes.append({"workspace_id": meta.parent.parent.parent.name, "dataset_id": meta.parent.name})
    return update_bindings_for_models(outcomes, [], full=False)


if __name__ == "__main__":  # pragma: no cover
    print(json.dumps(regenerate_all(), indent=2))
