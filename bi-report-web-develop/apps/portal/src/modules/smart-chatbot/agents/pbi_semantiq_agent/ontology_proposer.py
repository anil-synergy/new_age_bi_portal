"""Propose ontology improvements from the extracted semantic models (never writes the live ontology).

Mines measure, column, table and display-folder names across all extracted models for business phrases
that clearly belong to an existing concept but are not yet one of its aliases (for example a measure called
"Vessel Count" when the concept ``fleet_count`` only lists "fleet size"). The result is a *draft* proposal in
``learning/proposals/`` in the existing ``ontology_add`` format. A human completes it (evaluation cases are
mandatory) and approves it through ``scripts/apply_learning.py`` or Admin -> SMART Learning, where the
author != approver rule and the retrieval-evaluation gate still apply.

Run: ``python -m pbi_semantiq_agent.ontology_proposer`` (also callable after a sync).
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .metadata_paths import atomic_write_json, metadata_workspace_root, ontology_dir

AUTHOR = "ontology-auto-proposer"
MIN_DATASETS = 2  # a phrase must appear in at least this many datasets
MAX_WORDS = 4
MAX_PHRASES_PER_CONCEPT = 12
_SPLIT = re.compile(r"[^A-Za-z0-9]+")
_CAMEL = re.compile(r"(?<=[a-z])(?=[A-Z])")
_TIME_WORDS = frozenset({"date", "time", "month", "year", "period", "day", "week", "quarter"})
_NOISE = frozenset({"id", "key", "flag", "sort", "order", "index", "tmp", "temp", "calc", "ytd", "py", "ly", "mtd", "qtd"})


def _words(name: str) -> list[str]:
    spaced = _CAMEL.sub(" ", name or "")
    return [w for w in _SPLIT.split(spaced.lower()) if w]


def _phrase(name: str) -> str | None:
    words = _words(name)
    if not words or len(words) > MAX_WORDS or any(w in _NOISE for w in words) or all(w.isdigit() for w in words):
        return None
    return " ".join(words)


def _read(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _model_names(root: Path) -> dict[str, set[str]]:
    """phrase -> set of dataset ids it appears in (measures, columns, display folders)."""
    seen: dict[str, set[str]] = defaultdict(set)
    for meta in (root / "workspaces").glob("*/semantic_models/*/model_metadata.json"):
        dataset_id = meta.parent.name.lower()
        base = meta.parent
        names: list[str] = []
        for rel, key, fields in (
            ("measures.json", "measures", ("name", "displayFolder")),
            ("columns.json", "columns", ("name",)),
        ):
            for row in _read(base / rel).get(key) or []:
                if row.get("hidden"):
                    continue
                names.extend(str(row.get(f) or "") for f in fields)
        for table in _read(base / "tables.json").get("tables") or []:
            if not table.get("hidden"):
                names.append(str(table.get("name") or ""))
        for name in names:
            phrase = _phrase(name)
            if phrase:
                seen[phrase].add(dataset_id)
    return seen


def propose(*, write: bool = True) -> dict[str, Any]:
    """Build (and optionally write) a draft proposal. Returns the proposal plus counts."""
    onto = _read(ontology_dir() / "business_ontology.json")
    aliases_doc = _read(ontology_dir() / "business_aliases.json")
    known_phrases = {str(a).lower() for a in (aliases_doc.get("aliases") or {})}
    concepts = {str(c["id"]): c for c in onto.get("concepts") or [] if c.get("id")}
    for c in concepts.values():
        known_phrases |= {str(a).lower() for a in c.get("aliases") or []}
        known_phrases |= {str(a).lower() for a in c.get("excluded_aliases") or []}

    # concept id -> alias token set (only multi-char tokens, so "id"/"of" never match)
    anchors: dict[str, set[str]] = {}
    for cid, c in concepts.items():
        toks: set[str] = set()
        for alias in c.get("aliases") or []:
            toks |= {t for t in _words(str(alias)) if len(t) > 3}
        if toks:
            anchors[cid] = toks

    evidence = _model_names(metadata_workspace_root())
    per_concept: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for phrase, datasets in evidence.items():
        if phrase in known_phrases or len(datasets) < MIN_DATASETS:
            continue
        words = set(_words(phrase))
        scored = {cid: len(words & toks) for cid, toks in anchors.items() if words & toks}
        if not scored:
            continue
        best = max(scored.values())
        hits = [cid for cid, n in scored.items() if n == best]
        if len(hits) > 1:
            # Share a token (e.g. "incident" and "incident_date"): a phrase belongs to a time concept only
            # when it says so; otherwise prefer the non-time ones.
            wants_time = bool(words & _TIME_WORDS)
            hits = [c for c in hits if (concepts[c].get("semantic_type") == "time") == wants_time]
        if len(hits) == 1:  # still ambiguous -> left to a human
            per_concept[hits[0]].append((phrase, len(datasets)))

    alias_entries = []
    for cid, items in sorted(per_concept.items()):
        top = sorted(items, key=lambda x: (-x[1], x[0]))[:MAX_PHRASES_PER_CONCEPT]
        alias_entries.append({"concept": cid, "phrases": [p for p, _ in top], "evidence_datasets": {p: n for p, n in top}})

    proposal = {
        "id": f"auto-ontology-{datetime.now(timezone.utc).strftime('%Y%m%d')}",
        "author": AUTHOR,
        "status": "draft_needs_review",
        "reason": "Phrases found in several semantic models that match an existing concept but are not yet aliases.",
        "ontology_add": {"aliases": alias_entries} if alias_entries else {},
        "glossary_add": [],
        # Mandatory for apply_learning: a reviewer must add cases that prove the change helps retrieval.
        "eval_cases_add": [],
        "settings": {},
    }
    result = {"proposal": proposal, "concepts": len(alias_entries), "phrases": sum(len(e["phrases"]) for e in alias_entries)}
    if write and alias_entries:
        dest = Path(__file__).resolve().parents[1] / "learning" / "proposals" / f"{proposal['id']}.json"
        if dest.exists():
            result["skipped"] = "draft for today already exists (a reviewer may have edited it)"
        else:
            atomic_write_json(dest, proposal)
            result["path"] = str(dest)
    return result


if __name__ == "__main__":  # pragma: no cover
    out = propose()
    print(json.dumps({k: v for k, v in out.items() if k != "proposal"}, indent=2))
