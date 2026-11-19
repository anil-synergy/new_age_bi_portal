"""Score correction events into draft ontology/glossary proposals (no ML)."""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pbi_semantiq_agent.metadata_paths import ontology_dir

from .instruction_parser import nearest_concept

_WEIGHT = {
    "instruction_parse": 4.0,
    "clarification_pick": 3.0,
    "feedback_comment": 2.0,
    "upvote_confirm": 0.5,
    "occurrence": 1.0,
    "user": 2.0,
}


@dataclass
class ScoredCandidate:
    kind: str
    score: float
    users: int
    occurrences: int
    payload: dict[str, Any] = field(default_factory=dict)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)


def _concept_ids() -> set[str]:
    path = ontology_dir() / "business_ontology.json"
    if not path.is_file():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    return {str(c.get("id") or "") for c in data.get("concepts") or [] if c.get("id")}


def score_corrections(
    rows: list[dict[str, Any]],
    *,
    promote_score: float = 6.0,
    min_users: int = 2,
) -> list[ScoredCandidate]:
    """Aggregate SQLite correction rows into ranked candidates."""
    alias_buckets: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    report_buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    dataset_buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in rows:
        src = str(row.get("source") or "")
        w = _WEIGHT.get(src, 1.0)
        user = row.get("user_hash")
        if row.get("phrase") and row.get("concept_id"):
            key = (str(row["phrase"]).lower(), str(row["concept_id"]))
            alias_buckets[key].append({**row, "_w": w})
        elif row.get("chosen_title"):
            title = str(row["chosen_title"])
            report_buckets[title.lower()].append({**row, "_w": w})
            if row.get("chosen_dataset_id"):
                dataset_buckets[str(row["chosen_dataset_id"]).lower()].append({**row, "_w": w})
        elif row.get("phrase") and not row.get("concept_id"):
            concept = nearest_concept(str(row["phrase"]))
            if concept:
                key = (str(row["phrase"]).lower(), concept)
                alias_buckets[key].append({**row, "_w": w, "concept_id": concept})

    out: list[ScoredCandidate] = []

    for (phrase, concept), events in alias_buckets.items():
        if concept not in _concept_ids():
            continue
        users = len({e.get("user_hash") for e in events})
        score = sum(float(e.get("_w", 1)) for e in events) + users * _WEIGHT["user"]
        explicit = any(e.get("source") == "instruction_parse" for e in events)
        if score < promote_score or (users < min_users and not (explicit and len(events) >= 2)):
            continue
        out.append(
            ScoredCandidate(
                kind="alias_add",
                score=score,
                users=users,
                occurrences=len(events),
                payload={"concept": concept, "phrases": [phrase]},
                evidence=[{"source": e.get("source"), "n": 1} for e in events[:8]],
                questions=[str(e.get("question") or "") for e in events if e.get("question")][:3],
            )
        )

    for title_key, events in report_buckets.items():
        users = len({e.get("user_hash") for e in events})
        score = sum(float(e.get("_w", 1)) for e in events) + users * _WEIGHT["user"]
        title = str(events[0].get("chosen_title") or title_key)
        if score < promote_score or users < min_users:
            if not (any(e.get("source") == "instruction_parse" for e in events) and len(events) >= 2):
                continue
        ds = next((str(e.get("chosen_dataset_id") or "") for e in events if e.get("chosen_dataset_id")), "")
        out.append(
            ScoredCandidate(
                kind="preferred_report",
                score=score,
                users=users,
                occurrences=len(events),
                payload={"title": title, "dataset_id": ds},
                evidence=[{"source": e.get("source"), "n": 1} for e in events[:8]],
                questions=[str(e.get("question") or "") for e in events if e.get("question")][:3],
            )
        )
        if ds and score >= promote_score:
            out.append(
                ScoredCandidate(
                    kind="preferred_dataset",
                    score=score,
                    users=users,
                    occurrences=len(events),
                    payload={"dataset_id": ds, "title": title},
                    evidence=[{"source": "dataset_aggregate", "n": len(events)}],
                    questions=[str(e.get("question") or "") for e in events if e.get("question")][:1],
                )
            )

    out.sort(key=lambda c: c.score, reverse=True)
    return out


def candidates_to_proposal(
    candidates: list[ScoredCandidate],
    *,
    proposal_id: str,
    author: str = "learning-bot@system",
) -> dict[str, Any]:
    ontology_add: dict[str, Any] = {"aliases": [], "business_aliases": {}, "rules_patch": {}}
    glossary_add: list[dict[str, Any]] = []
    eval_cases: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []

    for cand in candidates:
        evidence.extend(cand.evidence)
        if cand.kind == "alias_add":
            ontology_add["aliases"].append({"concept": cand.payload["concept"], "phrases": cand.payload["phrases"]})
            for q in cand.questions:
                eval_cases.append({"question": q, "expect": ""})
        elif cand.kind == "preferred_report" and cand.payload.get("title"):
            phrase = cand.payload["title"]
            glossary_add.append({"term": phrase, "synonyms": [], "domain": "learned"})
            for q in cand.questions:
                eval_cases.append({"question": q, "expect": cand.payload["title"]})
        elif cand.kind == "preferred_dataset" and cand.payload.get("dataset_id"):
            ontology_add["rules_patch"]["preferred_vessel_inventory_dataset_id"] = cand.payload["dataset_id"]

    if not eval_cases:
        eval_cases = [{"question": "fleet count handymax sppl", "expect": "Fleet Count Vessel Portal"}]

    reason = f"Auto-generated from {len(candidates)} scored correction candidate(s)"
    return {
        "id": proposal_id,
        "author": author,
        "reason": reason,
        "glossary_add": glossary_add,
        "ontology_add": ontology_add,
        "eval_cases_add": eval_cases[:12],
        "evidence": evidence[:20],
        "status": "draft",
    }


def load_corrections(db_path: Path, *, since: float) -> list[dict[str, Any]]:
    if not db_path.is_file():
        return []
    with sqlite3.connect(db_path) as db:
        db.row_factory = sqlite3.Row
        return [dict(r) for r in db.execute("SELECT * FROM corrections WHERE ts >= ? ORDER BY ts DESC", (since,)).fetchall()]