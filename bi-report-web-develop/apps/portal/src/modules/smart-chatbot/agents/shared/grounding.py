"""Deterministic anti-hallucination checks.

* Numbers written by an LLM must be traceable to values computed in code.
* Confidence is a product of validator outcomes, never the model's self-rating.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

_NUMBER = re.compile(r"(?<![\w.])[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])[-+]?\d+(?:\.\d+)?")
_SCALES = {"k": 1e3, "thousand": 1e3, "m": 1e6, "mn": 1e6, "million": 1e6, "b": 1e9, "bn": 1e9, "billion": 1e9}
_SCALE_AFTER = re.compile(r"\s?(k|thousand|mn|m|million|bn|b|billion)\b", re.IGNORECASE)


@dataclass(frozen=True)
class FoundNumber:
    text: str
    value: float
    is_percent: bool


def extract_numbers(text: str) -> list[FoundNumber]:
    found: list[FoundNumber] = []
    for match in _NUMBER.finditer(text or ""):
        raw = match.group(0)
        try:
            value = float(raw.replace(",", ""))
        except ValueError:
            continue
        tail = text[match.end(): match.end() + 12]
        is_percent = tail.startswith("%") or tail.lower().startswith(" percent")
        scale = _SCALE_AFTER.match(tail)
        if scale and not is_percent:
            value *= _SCALES[scale.group(1).lower()]
        found.append(FoundNumber(raw, value, is_percent))
    return found


def numeric_values(values: Iterable[Any]) -> list[float]:
    out: list[float] = []
    for v in values:
        if isinstance(v, bool) or v is None:
            continue
        if isinstance(v, (int, float)):
            if math.isfinite(float(v)):
                out.append(float(v))
        elif isinstance(v, str):
            out.extend(n.value for n in extract_numbers(v))
    return out


def allowed_values_from_rows(rows: list[dict[str, Any]]) -> list[float]:
    return numeric_values(value for row in rows for value in row.values())


def _matches(candidate: float, allowed: float, is_percent: bool) -> bool:
    targets = [allowed]
    if is_percent:
        targets.append(allowed * 100)
    for target in targets:
        if target == candidate:
            return True
        scale = max(abs(target), abs(candidate), 1e-9)
        # Displayed values are usually rounded; accept the rounding a human writer would apply.
        if abs(target - candidate) / scale <= 0.006:
            return True
        for digits in (0, 1, 2):
            if round(target, digits) == candidate:
                return True
    return False


@dataclass
class GroundingReport:
    coverage: float
    total: int
    ungrounded: list[str] = field(default_factory=list)


def check_grounding(text: str, allowed: Iterable[float], *, also_allowed_text: str = "") -> GroundingReport:
    """Share of numbers in ``text`` that match an allowed value (or appear in ``also_allowed_text``)."""
    allowed_list = list(allowed)
    free = {n.value for n in extract_numbers(also_allowed_text)}
    numbers = extract_numbers(text)
    if not numbers:
        return GroundingReport(coverage=1.0, total=0)
    ungrounded = [
        n.text
        for n in numbers
        if n.value not in free and not any(_matches(n.value, a, n.is_percent) for a in allowed_list)
    ]
    coverage = 1.0 - len(ungrounded) / len(numbers)
    return GroundingReport(coverage=coverage, total=len(numbers), ungrounded=ungrounded)


@dataclass
class Confidence:
    components: dict[str, float]

    @property
    def score(self) -> float:
        score = 1.0
        for value in self.components.values():
            score *= max(0.0, min(1.0, value))
        return round(score, 4)

    def passes(self, threshold: float) -> bool:
        return self.score >= threshold

    def as_dict(self) -> dict[str, Any]:
        return {"score": self.score, "components": self.components}


def truncate_text(value: str | None, limit: int) -> str:
    if not value:
        return ""
    value = " ".join(value.split())
    return value if len(value) <= limit else value[: limit - 1] + "…"
