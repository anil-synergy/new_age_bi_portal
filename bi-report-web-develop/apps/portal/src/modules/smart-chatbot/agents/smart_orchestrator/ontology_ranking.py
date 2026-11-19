"""Ontology-aware retrieval boosts (fleet count vs tanker title false friends)."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from pbi_semantiq_agent.inventory_loader import enriched_row, enriched_search_text
from pbi_semantiq_agent.metadata_paths import ontology_dir
from pbi_semantiq_agent.ontology import concepts_in_question

from .query_norm import normalize_report_label


_RULES_MTIME: float = -1.0
_RULES_CACHE: dict[str, Any] | None = None


def _rules() -> dict[str, Any]:
    global _RULES_MTIME, _RULES_CACHE
    path = ontology_dir() / "business_rules.json"
    if not path.is_file():
        return {}
    try:
        mtime = path.stat().st_mtime
        if _RULES_CACHE is not None and mtime == _RULES_MTIME:
            return _RULES_CACHE
        _RULES_CACHE = json.loads(path.read_text(encoding="utf-8"))
        _RULES_MTIME = mtime
        return _RULES_CACHE
    except (json.JSONDecodeError, OSError):
        return {}


def clear_rules_cache() -> None:
    global _RULES_MTIME, _RULES_CACHE
    _RULES_MTIME = -1.0
    _RULES_CACHE = None


def _count_cue(question: str) -> bool:
    q = (question or "").lower()
    if re.search(r"\bincidents?\b", q):
        return False
    return any(
        token in q
        for token in (
            "how many",
            "no of",
            "number of",
            "find no of",
            "fleet size",
            "fleet count",
            "vessel count",
            "vessel portal",
        )
    ) or (re.search(r"\bcount\b", q) and not re.search(r"\baccount\b", q))


def _vessel_inventory_scope(question: str, concepts: set[str]) -> bool:
    q = (question or "").lower()
    return (
        "fleet_count" in concepts
        or "vessel_type" in concepts
        or "vessel_subtype" in concepts
        or "vessel_identifier" in concepts
        or any(w in q for w in ("tanker", "tankers", "handymax", "bulk", "vessel", "ship", "sppl"))
    )


_REGISTER_CONCEPTS = frozenset({"vessel_type", "vessel_subtype", "manager_company", "vessel_identifier", "fleet_count", "owner_company", "vessel_deadweight"})
_REGISTER_WORDS = ("tanker", "handymax", "sppl", "vessel", "ship", "imo", "doc", "fleet", "dwt", "deadweight")
_DEFAULT_MODULE_TERMS = ("injur", "incident", "near miss", "accident", "audit", "inspection", "certificate", "crew", "cadet")


def vessel_register_dataset_id(question: str, rules: dict[str, Any] | None = None) -> str | None:
    """Dataset id of the vessel register ('dump of IMO and attributes') for a plain vessel question.

    A question about vessels, IMO numbers, sub types, vessel types or managers goes to the register unless it names
    a specific module (injury, incident, audit...). Those module names are listed in business_rules.json
    (``vessel_register_route.module_terms``) so the rule is data, not code.
    """
    rules = _rules() if rules is None else rules
    route = rules.get("vessel_register_route") or {}
    dataset_id = str(route.get("dataset_id") or rules.get("preferred_vessel_inventory_dataset_id") or "").lower()
    if not dataset_id:
        return None
    q = (question or "").lower()
    module_terms = tuple(route.get("module_terms") or _DEFAULT_MODULE_TERMS)
    if any(term in q for term in module_terms):
        return None
    concepts = concepts_in_question(question)
    if concepts & _REGISTER_CONCEPTS or any(re.search(rf"\b{re.escape(w)}s?\b", q) for w in _REGISTER_WORDS):
        return dataset_id
    return None


def question_signals(question: str) -> dict[str, Any]:
    """Intent flags for one question. Called once per candidate, so the result is memoised per question.

    Callers must not mutate the returned dict.
    """
    return _question_signals_cached(question or "")


@lru_cache(maxsize=256)
def _question_signals_cached(question: str) -> dict[str, Any]:
    q = question.lower()
    concepts = concepts_in_question(question)
    fleet = "fleet_count" in concepts or (
        _vessel_inventory_scope(question, concepts) and _count_cue(question)
    )
    subtype_manager = "vessel_subtype" in concepts or "manager_company" in concepts or ("handymax" in q and "sppl" in q)
    tanker_only = bool(re.search(r"\btankers?\b", q)) and not fleet
    incident = "incident" in concepts or bool(re.search(r"\bincidents?\b", q))
    return {
        "fleet_count_intent": fleet,
        "subtype_manager_intent": subtype_manager,
        "tanker_token_only": tanker_only,
        "incident_intent": incident,
        "concepts": concepts,
    }


def catalog_ontology_adjustment(
    question: str,
    item: dict[str, Any],
    *,
    learned_hints: dict[str, Any] | None = None,
) -> float:
    """Score delta applied during catalog rerank."""
    signals = question_signals(question)
    delta = 0.0
    hints = learned_hints or {}
    pref_ds = str(hints.get("preferred_dataset_id") or "").lower()
    pref_title = normalize_report_label(str(hints.get("preferred_report_title") or "")).lower()
    item_title = normalize_report_label(str(item.get("title") or item.get("report_name") or "")).lower()
    item_ds = str(item.get("dataset_id") or "").lower()
    for excl in hints.get("excluded_titles") or []:
        if str(excl).lower() in item_title:
            delta -= 0.5
    if pref_ds and item_ds == pref_ds:
        delta += 0.4
    if pref_title and pref_title in item_title:
        delta += 0.35
    if signals.get("incident_intent"):
        title = normalize_report_label(str(item.get("title") or item.get("report_name") or "")).lower()
        menu = str(item.get("menu_path") or item.get("category_name") or "").lower()
        if str(item.get("source") or "") == "portal" and ("incident" in title or "incident" in menu):
            delta += 0.45
        elif title in {"incident", "incidents"} and str(item.get("source") or "workspace") == "workspace" and not item.get("report_id"):
            delta -= 0.3
    if not signals["fleet_count_intent"] and not signals["subtype_manager_intent"] and not signals.get("incident_intent"):
        return delta
    title = normalize_report_label(str(item.get("title") or item.get("report_name") or ""))
    title_l = title.lower()
    fleet_delta = 0.0
    rules = _rules()
    ws = str(item.get("dataset_workspace_id") or item.get("workspace_id") or "")
    ds = str(item.get("dataset_id") or "")
    for needle in rules.get("tanker_false_friend_titles") or []:
        if needle in title_l and signals["fleet_count_intent"]:
            fleet_delta -= 0.35
    if signals["fleet_count_intent"]:
        preferred_id = str(rules.get("preferred_vessel_inventory_dataset_id") or "").lower()
        if preferred_id and ds.lower() == preferred_id:
            fleet_delta += 0.55
        for pref in rules.get("preferred_vessel_inventory_titles") or []:
            if pref in title_l:
                fleet_delta += 0.45
        if "fleet count" in title_l or "vessel portal" in title_l:
            fleet_delta += 0.45
        if "fleet" in title_l and "count" in title_l:
            fleet_delta += 0.25
    if ds:
        enriched = enriched_row(ws, ds)
        if enriched:
            blob = enriched_search_text(enriched).lower()
            if signals["fleet_count_intent"] and "fleet operations" in blob and "vessel" in blob:
                fleet_delta += 0.2
    aliases = rules.get("report_title_aliases") or {}
    if signals["fleet_count_intent"]:
        for alias, dataset_ids in aliases.items():
            if alias in title or alias in question.lower():
                if ds.lower() in {d.lower() for d in dataset_ids}:
                    fleet_delta += 0.3
    return delta + fleet_delta


def catalog_hard_veto(question: str, item: dict[str, Any]) -> bool:
    """Block selection when ontology/metadata contradict keyword-only vector matches."""
    signals = question_signals(question)
    # Bare workspace Incident is penalized in catalog_ontology_adjustment, not hard-vetoed,
    # so _unread_model can fall back when the preferred portal report is unreadable.
    if not signals["fleet_count_intent"]:
        return False
    title = normalize_report_label(str(item.get("title") or item.get("report_name") or "")).lower()
    if "fleet count" in title or "vessel portal" in title:
        return False
    rules = _rules()
    for needle in rules.get("tanker_false_friend_titles") or []:
        if needle in title:
            return True
    if signals["tanker_token_only"] and "tanker" in title and "fleet" not in title:
        return True
    return False


def strong_ontology_catalog_match(question: str, candidate_score: float, metadata_boost: float) -> bool:
    signals = question_signals(question)
    if not signals["fleet_count_intent"] and not signals["subtype_manager_intent"]:
        return False
    return metadata_boost >= 0.35 or candidate_score >= 0.55
