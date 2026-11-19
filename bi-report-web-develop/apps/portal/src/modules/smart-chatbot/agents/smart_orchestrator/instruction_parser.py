"""Deterministic parsing of in-chat user instructions for the learning loop."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from pbi_semantiq_agent.metadata_paths import ontology_dir

from .query_norm import content_tokens, normalize_report_label


@lru_cache
def _concept_ids() -> frozenset[str]:
    path = ontology_dir() / "business_ontology.json"
    if not path.is_file():
        return frozenset()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return frozenset()
    return frozenset(str(c.get("id") or "") for c in data.get("concepts") or [] if c.get("id"))


_MEANS = re.compile(
    r"\b(?P<left>[\w\s]{2,40})\s+(?:means?|is(?:\s+the)?|refers?\s+to)\s+(?P<right>[\w\s]{2,40})\b",
    re.I,
)
_PREFERRED = re.compile(
    r"\b(?:use|open|meant?|should\s+use|try)\s+(?:report\s+)?(?P<title>.{3,80}?)(?:\s+report)?\s*$",
    re.I,
)
_NOT_REPORT = re.compile(r"\bnot\s+(?:the\s+)?(?P<title>.{3,60}?)(?:\s+report)?\b", re.I)


def nearest_concept(phrase: str, concept_hint: str | None = None) -> str | None:
    if concept_hint and concept_hint in _concept_ids():
        return concept_hint
    path = ontology_dir() / "business_ontology.json"
    if not path.is_file():
        return None
    try:
        ontology = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    ptoks = set(content_tokens(phrase, drop_generic=False))
    if not ptoks:
        return None
    best_id = None
    best_score = 0.0
    for entry in ontology.get("concepts") or []:
        cid = str(entry.get("id") or "")
        if not cid:
            continue
        for alias in [cid.replace("_", " "), *(entry.get("aliases") or [])]:
            atoks = set(content_tokens(str(alias), drop_generic=False))
            if not atoks:
                continue
            score = len(ptoks & atoks) / len(ptoks | atoks)
            if score > best_score:
                best_score = score
                best_id = cid
    if best_score < 0.15:
        return None
    return best_id


def match_catalog_title(text: str, catalog: list[dict[str, Any]]) -> dict[str, Any] | None:
    needle = normalize_report_label(text).lower()
    if not needle:
        return None
    best: dict[str, Any] | None = None
    best_len = 0
    for item in catalog:
        if not isinstance(item, dict):
            continue
        title = normalize_report_label(str(item.get("title") or "")).lower()
        if not title:
            continue
        if needle in title or title in needle:
            if len(title) > best_len:
                best_len = len(title)
                best = item
    return best


def parse_user_message(
    message: str,
    *,
    catalog: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Return structured learning/correction events (may be empty)."""
    events: list[dict[str, Any]] = []
    text = (message or "").strip()
    if not text:
        return events

    for m in _MEANS.finditer(text):
        left = m.group("left").strip()
        right = m.group("right").strip()
        concept = nearest_concept(right) or nearest_concept(left)
        if concept:
            events.append(
                {
                    "kind": "alias",
                    "source": "instruction_parse",
                    "phrase": left.lower(),
                    "concept_id": concept,
                    "question": text[:500],
                }
            )

    pm = _PREFERRED.search(text)
    if pm and catalog:
        item = match_catalog_title(pm.group("title").strip(), catalog)
        if item:
            events.append(
                {
                    "kind": "preferred_report",
                    "source": "instruction_parse",
                    "chosen_title": str(item.get("title") or ""),
                    "chosen_dataset_id": str(item.get("dataset_id") or ""),
                    "question": text[:500],
                }
            )

    for m in _NOT_REPORT.finditer(text):
        title = m.group("title").strip()
        if catalog:
            item = match_catalog_title(title, catalog)
            if item:
                events.append(
                    {
                        "kind": "exclude_title",
                        "source": "instruction_parse",
                        "title": str(item.get("title") or ""),
                        "question": text[:500],
                    }
                )

    return events