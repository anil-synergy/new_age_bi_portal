"""Deterministic DAX for simple one-dimension breakdowns (no LLM)."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from .filter_preservation import mandatory_dimension_filters, mandatory_time_filter
from .query_plan import QueryPlan

if TYPE_CHECKING:
    from .metadata import SemanticModel
    from .ontology import ConceptBindings

_CONCEPT_BINDING = {
    "manager_company": "manager",
    "owner_company": "owner",
    "vessel_type": "vessel_type",
    "vessel_subtype": "subtype",
    "reporting_period": "date",
    "incident_status": "status",
}


def _binding_for_concept(bindings: "ConceptBindings", concept: str):
    attr = _CONCEPT_BINDING.get(concept)
    if not attr:
        return None
    return getattr(bindings, attr, None)


def _pick_measure(question: str, bindings: "ConceptBindings", model: "SemanticModel") -> str | None:
    if bindings.count_measure:
        return bindings.count_measure
    q = question.lower()
    keywords = []
    if re.search(r"\binjur", q):
        keywords.extend(["injury", "injuries", "incident"])
    if "count" in q or "total" in q:
        keywords.append("count")
    best: str | None = None
    best_score = 0
    for measure in model.all_measures():
        if measure.hidden:
            continue
        name = measure.name.lower()
        score = sum(2 for kw in keywords if kw in name)
        if "total" in q and "total" in name:
            score += 1
        if score > best_score:
            best_score = score
            best = f"'{measure.table}'[{measure.name}]"
    return best


def _result_label(question: str) -> str:
    q = question.lower()
    if re.search(r"\binjur", q):
        return "Total Injuries"
    if "count" in q or "total" in q:
        return "Total"
    return "Value"


def try_grouped_breakdown_dax(
    question: str,
    qplan: QueryPlan | None,
    bindings: "ConceptBindings | None",
    model: "SemanticModel | None",
) -> tuple[str, str] | None:
    if not qplan or not bindings or not model:
        return None
    if not qplan.group_by or qplan.output_type == "ranked":
        return None
    if len(qplan.group_by) != 1:
        return None
    if mandatory_time_filter(qplan) or mandatory_dimension_filters(qplan):
        return None
    concept = qplan.group_by[0]
    field = _binding_for_concept(bindings, concept)
    if not field:
        return None
    measure = _pick_measure(question, bindings, model)
    if not measure:
        return None
    col_ref = f"'{field.table}'[{field.column}]"
    label = _result_label(question)
    dax = f'EVALUATE SUMMARIZECOLUMNS({col_ref}, "{label}", CALCULATE({measure}))'
    desc = f"{label} by {field.column}"
    return dax, desc