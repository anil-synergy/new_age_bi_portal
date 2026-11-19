"""Remove spurious equality/TREATAS on columns used only as group-by dimensions."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from .query_plan import QueryPlan

if TYPE_CHECKING:
    from .ontology import ConceptBindings

_CONCEPT_BINDING = {
    "manager_company": "manager",
    "owner_company": "owner",
    "vessel_type": "vessel_type",
    "vessel_subtype": "subtype",
    "incident_status": "status",
}

_GROUPING_LITERALS = frozenset({"doc", "docs", "group", "groups", "manager", "managers", "type", "name", "company"})


def _column_tokens(column: str) -> set[str]:
    parts = re.split(r"[_\s]+", column.lower())
    return {p for p in parts if len(p) >= 3}


def _allowed_literals(qplan: QueryPlan | None, concept: str) -> set[str]:
    if not qplan:
        return set()
    return {fl.raw_value.strip().lower() for fl in qplan.filter_literals if fl.concept == concept and fl.raw_value}


def _is_spurious_literal(literal: str, *, column: str, concept: str, qplan: QueryPlan | None) -> bool:
    lit = literal.strip().lower()
    if not lit:
        return False
    allowed = _allowed_literals(qplan, concept)
    if lit in allowed:
        return False
    if lit in _column_tokens(column):
        return True
    if lit in _GROUPING_LITERALS and qplan and concept in qplan.group_by:
        return True
    return False


def sanitize_group_column_filters(dax: str, qplan: QueryPlan | None, bindings: "ConceptBindings | None") -> str:
    if not dax or not qplan or not qplan.group_by or not bindings:
        return dax
    text = dax
    for concept in qplan.group_by:
        attr = _CONCEPT_BINDING.get(concept)
        if not attr:
            continue
        binding = getattr(bindings, attr, None)
        if not binding:
            continue
        table, column = binding.table, binding.column
        t_esc, c_esc = re.escape(table), re.escape(column)

        def drop_literal(literal: str) -> None:
            nonlocal text
            if not _is_spurious_literal(literal, column=column, concept=concept, qplan=qplan):
                return
            lit_esc = re.escape(literal)
            patterns = [
                rf",\s*'{t_esc}'\s*\[{c_esc}\]\s*=\s*\"{lit_esc}\"",
                rf",\s*'{t_esc}'\s*\[{c_esc}\]\s*=\s*\"{lit_esc}\"",
                rf",\s*TREATAS\s*\(\s*\{{\s*\"{lit_esc}\"\s*\}}\s*,\s*'{t_esc}'\s*\[{c_esc}\]\s*\)",
                rf",\s*FILTER\s*\(\s*'{t_esc}'\s*,\s*'{t_esc}'\s*\[{c_esc}\]\s*=\s*\"{lit_esc}\"\s*\)",
            ]
            for pat in patterns:
                text = re.sub(pat, "", text, flags=re.I)

        for m in re.finditer(rf"'{t_esc}'\s*\[{c_esc}\]\s*=\s*\"([^\"]+)\"", text, re.I):
            drop_literal(m.group(1))
        for m in re.finditer(rf"TREATAS\s*\(\s*\{{\s*\"([^\"]+)\"\s*\}}\s*,\s*'{t_esc}'\s*\[{c_esc}\]", text, re.I):
            drop_literal(m.group(1))

    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r"CALCULATE\s*\(\s*([^,()]+)\s*,\s*\)", r"CALCULATE(\1)", text, flags=re.I)
    return text