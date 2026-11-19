"""Shared apply logic for glossary + ontology learning proposals."""

from __future__ import annotations

import asyncio
import json
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from smart_orchestrator.query_norm import default_glossary_path
from smart_orchestrator.settings import OrchestratorSettings

from .ontology_merge import default_ontology_dir, merge_ontology_files, validate_ontology_add
from .ontology_ranking import clear_rules_cache

ROOT = Path(__file__).resolve().parents[1]
AUDIT_DIR = ROOT / "learning" / "audit"
DEFAULT_CASES = ROOT / "learning" / "eval" / "retrieval_cases.json"


def merge_glossary(glossary: dict, additions: list[dict]) -> dict:
    merged = json.loads(json.dumps(glossary))
    terms = {t["term"].lower(): t for t in merged.setdefault("terms", [])}
    for add in additions:
        name = str(add["term"]).strip()
        synonyms = [str(s).strip() for s in add.get("synonyms", []) if str(s).strip()]
        if name.lower() in terms:
            existing = terms[name.lower()]
            existing["synonyms"] = sorted(set(existing.get("synonyms", [])) | set(synonyms), key=str.lower)
        else:
            entry = {"term": name, "synonyms": synonyms, "domain": add.get("domain", "")}
            merged["terms"].append(entry)
            terms[name.lower()] = entry
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    previous = str(glossary.get("version", "0"))
    serial = int(previous.rsplit(".", 1)[1]) + 1 if previous.startswith(today) and "." in previous else 1
    merged["version"] = f"{today}.{serial}"
    return merged


def validate_proposal(proposal: dict) -> list[str]:
    errors: list[str] = []
    if not proposal.get("id") or not proposal.get("author") or not proposal.get("reason"):
        errors.append("proposal needs id, author and reason")
    if not proposal.get("eval_cases_add"):
        errors.append("proposal must add at least one evaluation case that demonstrates the fix")
    known = set(OrchestratorSettings.model_fields)
    for name in proposal.get("settings", {}):
        if name.lower() not in known:
            errors.append(f"unknown setting {name}")
    for add in proposal.get("glossary_add", []):
        if not isinstance(add, dict) or not str(add.get("term", "")).strip():
            errors.append("every glossary_add entry needs a term")
    ontology_add = proposal.get("ontology_add") or {}
    if ontology_add:
        onto_path = default_ontology_dir() / "business_ontology.json"
        if onto_path.is_file():
            ontology = json.loads(onto_path.read_text(encoding="utf-8"))
            errors.extend(validate_ontology_add(ontology, ontology_add))
        else:
            errors.append("ontology directory not found for ontology_add validation")
    return errors


async def run_eval_gates(
    new_glossary: dict,
    new_cases: dict,
    baseline_glossary_path: Path,
    *,
    settings_overrides: dict[str, Any],
    min_accuracy: float,
) -> tuple[list[str], dict[str, Any]]:
    import sys

    scripts = Path(__file__).resolve().parents[1] / "scripts"
    sys.path.insert(0, str(scripts))
    from retrieval_eval import evaluate  # noqa: E402

    errors: list[str] = []
    audit: dict[str, Any] = {}
    with tempfile.TemporaryDirectory() as tmp:
        cases_file = Path(tmp) / "cases.json"
        glossary_file = Path(tmp) / "glossary.json"
        cases_file.write_text(json.dumps(new_cases), encoding="utf-8")
        glossary_file.write_text(json.dumps(new_glossary), encoding="utf-8")
        baseline = await evaluate(cases_file, baseline_glossary_path, {})
        candidate = await evaluate(cases_file, glossary_file, dict(settings_overrides))
    summary = lambda r: {k: r[k] for k in ("cases", "accuracy", "nonprod_leaks", "ask_rate")}  # noqa: E731
    audit["baseline"], audit["candidate"] = summary(baseline), summary(candidate)
    audit["failures"] = [row for row in candidate["rows"] if not row["ok"] or row["leak"]]
    if candidate["nonprod_leaks"]:
        errors.append(f"{candidate['nonprod_leaks']} non-production leak(s)")
    if candidate["accuracy"] < min_accuracy:
        errors.append(f"accuracy {candidate['accuracy']:.1%} is below {min_accuracy:.0%}")
    if candidate["accuracy"] < baseline["accuracy"]:
        errors.append(f"accuracy drops from {baseline['accuracy']:.1%} to {candidate['accuracy']:.1%}")
    return errors, audit


def apply_proposal(
    proposal: dict,
    *,
    approved_by: str,
    apply_writes: bool,
    min_accuracy: float = 0.9,
    glossary_path: Path | None = None,
    cases_path: Path | None = None,
    sync_packaged: bool = True,
) -> dict[str, Any]:
    glossary_path = glossary_path or default_glossary_path()
    cases_path = cases_path or DEFAULT_CASES

    errors = validate_proposal(proposal)
    if approved_by.strip().lower() == str(proposal.get("author", "")).strip().lower():
        errors.append("the approver must not be the author")

    glossary = json.loads(glossary_path.read_text(encoding="utf-8"))
    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    new_glossary = merge_glossary(glossary, proposal.get("glossary_add", []))
    new_cases = {**cases, "cases": cases["cases"] + list(proposal.get("eval_cases_add", []))}

    audit: dict[str, Any] = {
        "proposal": proposal,
        "approved_by": approved_by,
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "applied": False,
        "errors": list(errors),
    }

    if not errors:
        eval_errors, eval_audit = asyncio.run(
            run_eval_gates(new_glossary, new_cases, glossary_path, settings_overrides=dict(proposal.get("settings", {})), min_accuracy=min_accuracy)
        )
        audit.update(eval_audit)
        errors.extend(eval_errors)
        audit["errors"] = errors

    ontology_version: str | None = None
    if not errors and apply_writes:
        glossary_path.write_text(json.dumps(new_glossary, indent=2) + "\n", encoding="utf-8")
        cases_path.write_text(json.dumps(new_cases, indent=2) + "\n", encoding="utf-8")
        audit["applied"] = True
        audit["glossary_version"] = new_glossary["version"]
        if proposal.get("ontology_add"):
            meta, ontology_version = merge_ontology_files(
                default_ontology_dir(),
                proposal["ontology_add"],
                sync_packaged=sync_packaged,
            )
            audit["ontology"] = meta
            audit["ontology_version"] = ontology_version
            clear_rules_cache()
        proposal_path = PROPOSALS_DIR / f"{proposal.get('id')}.json"
        if proposal_path.is_file():
            stored = json.loads(proposal_path.read_text(encoding="utf-8"))
            stored["status"] = "applied"
            proposal_path.write_text(json.dumps(stored, indent=2) + "\n", encoding="utf-8")

    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    audit_file = AUDIT_DIR / f"{int(time.time())}-{proposal.get('id', 'proposal')}.json"
    audit_file.write_text(json.dumps(audit, indent=2, default=str), encoding="utf-8")
    audit["audit_file"] = str(audit_file)
    return audit


PROPOSALS_DIR = ROOT / "learning" / "proposals"


def list_proposals() -> list[dict[str, Any]]:
    if not PROPOSALS_DIR.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for path in sorted(PROPOSALS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
            row["_path"] = str(path.name)
            out.append(row)
        except json.JSONDecodeError:
            continue
    return out


def load_proposal(proposal_id: str) -> dict[str, Any] | None:
    direct = PROPOSALS_DIR / f"{proposal_id}.json"
    if direct.is_file():
        return json.loads(direct.read_text(encoding="utf-8"))
    for path in PROPOSALS_DIR.glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("id") == proposal_id:
            return data
    return None


def reject_proposal(proposal_id: str, *, rejected_by: str, reason: str) -> dict[str, Any]:
    proposal = load_proposal(proposal_id) or {"id": proposal_id}
    audit = {
        "proposal": proposal,
        "rejected_by": rejected_by,
        "reason": reason,
        "applied": False,
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    audit_file = AUDIT_DIR / f"{int(time.time())}-{proposal_id}-reject.json"
    audit_file.write_text(json.dumps(audit, indent=2), encoding="utf-8")
    path = PROPOSALS_DIR / f"{proposal_id}.json"
    if path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
        data["status"] = "rejected"
        path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return {"status": "rejected", "audit_file": str(audit_file)}