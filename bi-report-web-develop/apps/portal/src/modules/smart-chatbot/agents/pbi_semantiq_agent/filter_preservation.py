"""Pre-execute checks: mandatory filters from QueryPlan must appear in planned DAX."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .ontology import ConceptBindings, SemanticModel
    from .query_plan import QueryPlan

_MONTH_YEAR = re.compile(r"\bYEAR\s*\(|MONTH\s*\(", re.I)
_DATE_LITERAL = re.compile(r"\bDATE\s*\(\s*\d+\s*,\s*\d+", re.I)
_PERIOD_FNS = re.compile(r"\b(DATESBETWEEN|DATESINPERIOD|DATEADD|PARALLELPERIOD|SAMEPERIODLASTYEAR)\s*\(", re.I)
_HALF_OPEN = re.compile(r">=?\s*DATE\s*\(|<=\s*DATE\s*\(|\bDATE\s*\(\s*\d+", re.I)
_TREATAS = re.compile(r"\bTREATAS\s*\(", re.I)
_REMOVE = re.compile(r"\b(REMOVEFILTERS|ALLSELECTED|ALLEXCEPT)\s*\(", re.I)
_CALENDAR_TABLE = re.compile(r"calendar|dim[\s_-]*date|^dates?$|date table", re.I)

_CONCEPT_BINDINGS = {
    "vessel_subtype": "subtype",
    "vessel_type": "vessel_type",
    "manager_company": "manager",
    "owner_company": "owner",
    "incident_status": "status",
}


def mandatory_time_filter(plan: "QueryPlan | None") -> bool:
    if not plan or not plan.time_filter:
        return False
    return bool(plan.time_filter.get("mandatory"))


def mandatory_dimension_filters(plan: "QueryPlan | None") -> bool:
    if not plan:
        return False
    for fl in plan.filter_literals:
        if fl.role == "period":
            continue
        if fl.mandatory and fl.raw_value:
            return True
    return False


def requires_mandatory_filter_validation(plan: "QueryPlan | None", bindings: "ConceptBindings | None") -> bool:
    if mandatory_time_filter(plan):
        return bool(bindings and bindings.date)
    return mandatory_dimension_filters(plan)


def _dax_references_column(dax: str, table: str, column: str) -> bool:
    text = dax or ""
    return bool(
        re.search(rf"'{re.escape(table)}'\s*\[{re.escape(column)}\]", text, re.I)
        or re.search(rf"{re.escape(table)}\s*\[{re.escape(column)}\]", text, re.I)
    )


def _treatas_has_literal(dax: str, raw_value: str, table: str, column: str) -> bool:
    if not dax or not raw_value:
        return False
    escaped = re.escape(raw_value)
    if not re.search(rf'TREATAS\s*\(\s*\{{\s*"{escaped}"', dax, re.I):
        return False
    return _dax_references_column(dax, table, column)


def dax_has_time_constraint(dax: str, plan: "QueryPlan | None", bindings: "ConceptBindings | None") -> bool:
    text = dax or ""
    if _MONTH_YEAR.search(text) or _DATE_LITERAL.search(text) or _PERIOD_FNS.search(text):
        return True
    if _HALF_OPEN.search(text):
        return True
    if bindings and bindings.date:
        col = bindings.date.column
        table = bindings.date.table
        if _dax_references_column(text, table, col) and (
            _MONTH_YEAR.search(text) or _DATE_LITERAL.search(text) or ">=" in text or "<" in text
        ):
            return True
    if bindings and bindings.fact_date and bindings.date_via_calendar:
        col = bindings.fact_date.column
        table = bindings.fact_date.table
        if _dax_references_column(text, table, col) and (
            _MONTH_YEAR.search(text) or _DATE_LITERAL.search(text) or ">=" in text
        ):
            return True
    if plan and plan.time_filter:
        year = plan.time_filter.get("year")
        month = plan.time_filter.get("month")
        if year and str(year) in text:
            if month is None or str(month) in text:
                return True
    return False


def dax_strips_filters(dax: str, bindings: "ConceptBindings | None") -> str | None:
    if not bindings:
        return None
    text = dax or ""
    if not _REMOVE.search(text) and not re.search(r"\bALL\s*\(", text, re.I):
        return None
    targets: list[str] = []
    if bindings.date:
        targets.extend([bindings.date.column, bindings.date.table])
    if bindings.fact_date:
        targets.extend([bindings.fact_date.column, bindings.fact_date.table])
    targets.append("Calendar")
    if any(re.search(re.escape(t), text, re.I) for t in targets if t):
        return "DAX uses ALL/REMOVEFILTERS/ALLSELECTED on a date or calendar column"
    calc = re.search(r"CALCULATE\s*\(", text, re.I)
    if calc and re.search(r"\bALL\s*\(\s*\)", text, re.I):
        return "DAX uses bare ALL() inside CALCULATE which can drop user filter context"
    return None


def _measure_expr_clears_dates(expr: str, bindings: "ConceptBindings | None") -> bool:
    expr_l = (expr or "").lower()
    if "removefilters" in expr_l:
        if "calendar" in expr_l:
            return True
        if bindings and bindings.date and bindings.date.table.lower() in expr_l:
            return True
        if bindings and bindings.fact_date and bindings.fact_date.table.lower() in expr_l:
            return True
    if re.search(r"all\s*\(\s*'?calendar", expr_l):
        return True
    if bindings and bindings.date:
        t = bindings.date.table.lower()
        c = bindings.date.column.lower()
        if re.search(rf"all\s*\(\s*'?{re.escape(t)}'?", expr_l) and c in expr_l:
            return True
    return False


def measure_strips_date_filters(model: "SemanticModel | None", dax: str, bindings: "ConceptBindings | None") -> str | None:
    if not model or not dax:
        return None
    refs = re.findall(r"\[([^\]]+)\]", dax)
    for name in refs:
        for m in model.all_measures():
            if m.name == name and m.expression and _measure_expr_clears_dates(m.expression, bindings):
                return f"Measure [{name}] may clear date or calendar filter context"
    return None


def literal_filters_satisfied(dax: str, plan: "QueryPlan | None", bindings: "ConceptBindings | None") -> list[str]:
    """Return list of missing mandatory literal filters (empty = ok)."""
    missing: list[str] = []
    if not plan:
        return missing
    text = (dax or "").lower()
    for fl in plan.filter_literals:
        if fl.role == "period":
            continue
        if not fl.raw_value or not fl.mandatory:
            continue
        val = fl.raw_value.lower()
        if val in text:
            continue
        binding_attr = _CONCEPT_BINDINGS.get(fl.concept)
        binding = getattr(bindings, binding_attr, None) if bindings and binding_attr else None
        if binding and _treatas_has_literal(dax or "", fl.raw_value, binding.table, binding.column):
            continue
        if fl.negate and binding and binding.column.lower() in text and "<>" in text:
            continue
        if binding and binding.column.lower() in text and val in text:
            continue
        if binding is None and fl.role == "status":
            if val in text:
                continue
        missing.append(f"{fl.concept}={fl.raw_value!r}")
    return missing


def unbound_mandatory_literals(plan: "QueryPlan | None", bindings: "ConceptBindings | None") -> list[str]:
    if not plan or not bindings:
        return []
    gaps: list[str] = []
    for fl in plan.filter_literals:
        if fl.role == "period" or not fl.mandatory or not fl.raw_value:
            continue
        attr = _CONCEPT_BINDINGS.get(fl.concept)
        if not attr:
            continue
        if getattr(bindings, attr, None) is None:
            gaps.append(f"{fl.concept}={fl.raw_value!r}")
    return gaps


def check_filter_preservation(
    dax: str,
    plan: "QueryPlan | None",
    bindings: "ConceptBindings | None",
    model: "SemanticModel | None" = None,
) -> str | None:
    """None if ok; otherwise human-readable error for guard → plan retry."""
    unbound = unbound_mandatory_literals(plan, bindings)
    if unbound:
        return "Mandatory filter not bound to a model column: " + ", ".join(unbound)

    has_time = mandatory_time_filter(plan)
    has_dims = mandatory_dimension_filters(plan)

    if not has_time and not has_dims:
        return None

    if has_time:
        if bindings and not bindings.date:
            return "User asked for a calendar period but reporting_period is not bound to a model column."
        if not dax_has_time_constraint(dax, plan, bindings):
            label = (plan.time_filter or {}).get("label") if plan else "the requested period"
            return (
                f"DAX must filter {label} on the bound event/reporting or Calendar date "
                "(YEAR/MONTH, DATESBETWEEN, or half-open DATE bounds)."
            )

    strip = dax_strips_filters(dax, bindings)
    if strip:
        return strip

    mstrip = measure_strips_date_filters(model, dax, bindings)
    if mstrip:
        return mstrip

    lit_missing = literal_filters_satisfied(dax, plan, bindings)
    if lit_missing:
        return "Mandatory dimension filters missing from DAX: " + ", ".join(lit_missing)

    return None