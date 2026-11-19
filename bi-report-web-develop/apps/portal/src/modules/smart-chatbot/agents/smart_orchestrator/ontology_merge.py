"""Add-only merge for SemantIQ ontology JSON (used by apply_learning and tests)."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pbi_semantiq_agent.metadata_paths import ontology_dir

def bump_version(previous: str) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    serial = int(previous.rsplit(".", 1)[1]) + 1 if previous.startswith(today) and "." in previous else 1
    return f"{today}.{serial}"


def _known_concept_ids(ontology: dict[str, Any]) -> set[str]:
    return {str(c.get("id") or "") for c in ontology.get("concepts") or [] if c.get("id")}


def validate_ontology_add(ontology: dict[str, Any], add: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    known = _known_concept_ids(ontology)
    for entry in add.get("aliases") or []:
        concept = str(entry.get("concept") or "")
        if concept not in known:
            errors.append(f"unknown concept {concept}")
    for _alias, target in (add.get("business_aliases") or {}).items():
        if str(target) not in known:
            errors.append(f"unknown business_aliases target {target}")
    rules = add.get("rules_patch") or {}
    if "preferred_vessel_inventory_dataset_id" in rules and not str(rules.get("preferred_vessel_inventory_dataset_id") or "").strip():
        errors.append("preferred_vessel_inventory_dataset_id cannot be empty")
    return errors


def merge_ontology_files(
    base_dir: Path,
    ontology_add: dict[str, Any],
    *,
    sync_packaged: bool = False,
) -> tuple[dict[str, Any], str]:
    """Merge allowlisted keys into business_ontology, business_aliases, business_rules."""
    onto_path = base_dir / "business_ontology.json"
    alias_path = base_dir / "business_aliases.json"
    rules_path = base_dir / "business_rules.json"
    ontology = json.loads(onto_path.read_text(encoding="utf-8"))
    aliases_doc = json.loads(alias_path.read_text(encoding="utf-8")) if alias_path.is_file() else {"version": "0", "aliases": {}}
    rules = json.loads(rules_path.read_text(encoding="utf-8")) if rules_path.is_file() else {"version": "0", "rules": []}

    errors = validate_ontology_add(ontology, ontology_add)
    if errors:
        raise ValueError("; ".join(errors))

    concepts = {str(c["id"]): c for c in ontology.get("concepts") or [] if c.get("id")}
    for entry in ontology_add.get("aliases") or []:
        cid = str(entry.get("concept") or "")
        spec = concepts.get(cid)
        if not spec:
            continue
        existing = {str(a).lower() for a in spec.get("aliases") or []}
        for phrase in entry.get("phrases") or []:
            p = str(phrase).strip()
            if p and p.lower() not in existing:
                spec.setdefault("aliases", []).append(p)
                existing.add(p.lower())

    alias_map = aliases_doc.setdefault("aliases", {})
    for phrase, concept in (ontology_add.get("business_aliases") or {}).items():
        key = str(phrase).strip().lower()
        if key:
            alias_map[key] = str(concept)

    patch = ontology_add.get("rules_patch") or {}
    list_keys = ("preferred_vessel_inventory_titles", "tanker_false_friend_titles")
    for key, value in patch.items():
        if key == "report_title_aliases" and isinstance(value, dict):
            merged = rules.setdefault("report_title_aliases", {})
            for alias, ids in value.items():
                merged[str(alias)] = sorted(set(merged.get(str(alias), [])) | {str(i) for i in ids})
        elif key in list_keys and isinstance(value, list):
            existing = {str(x).lower() for x in rules.get(key, [])}
            rules[key] = list(rules.get(key, [])) + [str(v) for v in value if str(v).lower() not in existing]
        elif key == "preferred_vessel_inventory_dataset_id":
            rules[key] = str(value).strip()
        elif isinstance(value, (str, int, float, bool)):
            rules[key] = value

    ver = bump_version(str(ontology.get("version", "0")))
    ontology["version"] = ver
    aliases_doc["version"] = ver
    rules["version"] = ver

    onto_path.write_text(json.dumps(ontology, indent=2) + "\n", encoding="utf-8")
    alias_path.write_text(json.dumps(aliases_doc, indent=2) + "\n", encoding="utf-8")
    rules_path.write_text(json.dumps(rules, indent=2) + "\n", encoding="utf-8")

    if sync_packaged:
        packaged = Path(__file__).resolve().parents[1] / "pbi_semantiq_agent" / "ontology"
        packaged.mkdir(parents=True, exist_ok=True)
        for name in ("business_ontology.json", "business_aliases.json", "business_rules.json"):
            shutil.copy2(base_dir / name, packaged / name)

    return {"ontology_version": ver, "paths": [str(onto_path), str(alias_path), str(rules_path)]}, ver


def default_ontology_dir() -> Path:
    return ontology_dir()