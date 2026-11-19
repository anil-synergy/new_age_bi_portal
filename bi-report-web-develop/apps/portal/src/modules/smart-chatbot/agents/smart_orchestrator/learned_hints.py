"""Per-conversation overlay hints — never written to ontology files."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class LearnedHints:
    """Thread-scoped aliases and routing preferences learned from chat."""

    alias_to_concept: dict[str, str] = field(default_factory=dict)
    preferred_dataset_id: str | None = None
    preferred_report_title: str | None = None
    excluded_titles: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "alias_to_concept": dict(self.alias_to_concept),
            "preferred_dataset_id": self.preferred_dataset_id,
            "preferred_report_title": self.preferred_report_title,
            "excluded_titles": list(self.excluded_titles),
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any] | None) -> LearnedHints:
        if not raw:
            return cls()
        aliases = raw.get("alias_to_concept") or {}
        return cls(
            alias_to_concept={str(k).lower(): str(v) for k, v in aliases.items() if k and v},
            preferred_dataset_id=str(raw["preferred_dataset_id"]) if raw.get("preferred_dataset_id") else None,
            preferred_report_title=str(raw["preferred_report_title"]) if raw.get("preferred_report_title") else None,
            excluded_titles=[str(t) for t in raw.get("excluded_titles") or [] if t],
        )

    def merge_event(self, event: dict[str, Any]) -> None:
        kind = event.get("kind")
        if kind == "alias":
            phrase = str(event.get("phrase") or "").strip().lower()
            concept = str(event.get("concept_id") or "").strip()
            if phrase and concept:
                self.alias_to_concept[phrase] = concept
        elif kind == "preferred_report":
            title = str(event.get("chosen_title") or "").strip()
            ds = str(event.get("chosen_dataset_id") or "").strip()
            if title:
                self.preferred_report_title = title
            if ds:
                self.preferred_dataset_id = ds.lower()
        elif kind == "exclude_title":
            title = str(event.get("title") or "").strip().lower()
            if title and title not in self.excluded_titles:
                self.excluded_titles.append(title)

    def ontology_hint_payload(self) -> dict[str, Any] | None:
        if not self.alias_to_concept:
            return None
        return {"alias_to_concept": dict(self.alias_to_concept)}


def merge_hints(state_hints: dict[str, Any] | None, events: list[dict[str, Any]]) -> dict[str, Any]:
    hints = LearnedHints.from_dict(state_hints)
    for ev in events:
        hints.merge_event(ev)
    return hints.to_dict()