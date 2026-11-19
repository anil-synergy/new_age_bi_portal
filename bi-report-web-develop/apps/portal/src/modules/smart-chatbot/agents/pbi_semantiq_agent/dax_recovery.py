"""Classify DAX / XMLA failures for bounded recovery routing."""

from __future__ import annotations


def classify_dax_error(message: str) -> str:
    text = (message or "").lower()
    if any(token in text for token in ("permission", "denied", "not authorized", "forbidden", "rls")):
        return "permission"
    if any(token in text for token in ("cannot be found", "does not exist", "unknown", "invalid column", "invalid table")):
        return "metadata"
    if any(token in text for token in ("syntax", "token", "parse", "expected", "the syntax for")):
        return "syntax"
    if "timeout" in text or "timed out" in text:
        return "timeout"
    return "execution"


REPAIR_BUDGET: dict[str, int] = {
    "syntax": 2,
    "metadata": 1,
    "execution": 1,
    "filter_missing": 2,
    "filter_leakage": 1,
    "timeout": 0,
    "permission": 0,
}

MAX_TOTAL_REPAIRS = 3


def can_retry(error_class: str, repair_counts: dict[str, int], attempts: int) -> bool:
    if attempts >= MAX_TOTAL_REPAIRS:
        return False
    if error_class in ("permission", "timeout"):
        return False
    budget = REPAIR_BUDGET.get(error_class, 0)
    return repair_counts.get(error_class, 0) < budget
