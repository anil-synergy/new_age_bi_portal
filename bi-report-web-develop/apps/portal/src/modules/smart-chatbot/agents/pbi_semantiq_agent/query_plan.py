"""Structured query understanding for SemantIQ (physical names come from bindings/schema, not from the LLM)."""

from __future__ import annotations

import calendar
import re
from datetime import date, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field

from .ontology import ConceptBindings, concepts_in_question, _ontology_paths, _read_json

_MONTH = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


class FilterLiteral(BaseModel):
    concept: str = ""
    raw_value: str = ""
    role: Literal["subtype", "type", "manager", "owner", "period", "status", "other"] = "other"
    negate: bool = False
    mandatory: bool = True


class QueryPlan(BaseModel):
    original_question: str
    primary_intent: str = "analytical_scalar"
    aggregation: str = ""
    identifier_concept: str = ""
    output_type: Literal["scalar", "table", "ranked"] = "scalar"
    entities: dict[str, str] = Field(default_factory=dict)
    filter_literals: list[FilterLiteral] = Field(default_factory=list)
    time_filter: dict[str, Any] = Field(default_factory=dict)
    ambiguities: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    subqueries: list[str] = Field(default_factory=list)
    group_by: list[str] = Field(default_factory=list)

    def to_prompt(self) -> str:
        lines = ["QUERY PLAN (business reading — map columns via CANONICAL BINDINGS only):"]
        lines.append(f"- primary_intent: {self.primary_intent}")
        if self.aggregation:
            lines.append(f"- aggregation: {self.aggregation}")
        if self.identifier_concept:
            lines.append(f"- identifier_concept: {self.identifier_concept}")
        lines.append(f"- output_type: {self.output_type}")
        if self.entities:
            lines.append("- entities: " + ", ".join(f"{k}={v!r}" for k, v in self.entities.items()))
        if self.group_by:
            lines.append(
                "- group_by: "
                + ", ".join(self.group_by)
                + " (split/breakdown dimension — do NOT filter the group column to one label unless filter_literals names that value)"
            )
        if self.filter_literals:
            lines.append("- filter_literals:")
            for fl in self.filter_literals:
                neg = " (exclude)" if fl.negate else ""
                req = " [mandatory]" if fl.mandatory else ""
                lines.append(f"  - {fl.role}: {fl.raw_value!r} (concept={fl.concept}){neg}{req}")
        if self.time_filter:
            lines.append("- time_filter: " + ", ".join(f"{k}={v}" for k, v in self.time_filter.items()))
            if self.time_filter.get("mandatory"):
                lines.append("- requires_date_filter: true (explicit user period)")
        if self.ambiguities:
            lines.append("- ambiguities: " + "; ".join(self.ambiguities))
        if self.missing_information:
            lines.append("- missing: " + "; ".join(self.missing_information))
        return "\n".join(lines)


def _month_end_exclusive(year: int, month: int) -> date:
    if month == 12:
        return date(year + 1, 1, 1)
    return date(year, month + 1, 1)


def _extract_quarter(question: str) -> dict[str, Any] | None:
    q = question.lower()
    m = re.search(r"\bq([1-4])\b", q)
    year_match = re.search(r"\b(20\d{2})\b", q)
    if not m or not year_match:
        return None
    qnum = int(m.group(1))
    year = int(year_match.group(1))
    start_month = (qnum - 1) * 3 + 1
    end_month = start_month + 2
    start = date(year, start_month, 1)
    end_excl = _month_end_exclusive(year, end_month)
    return {
        "kind": "quarter",
        "quarter": qnum,
        "year": year,
        "month": None,
        "label": f"Q{qnum} {year}",
        "start_date": start.isoformat(),
        "end_date_exclusive": end_excl.isoformat(),
        "mandatory": True,
        "source": "explicit_user_query",
    }


def _extract_calendar_year(question: str) -> dict[str, Any] | None:
    q = question.lower()
    if re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b", q):
        return None
    if re.search(r"\bq[1-4]\b", q):
        return None
    m = re.search(r"\b(?:during|in|for)\s+(20\d{2})\b", q) or re.search(r"\b(20\d{2})\b", q)
    if not m:
        return None
    year = int(m.group(1))
    return {
        "kind": "year",
        "year": year,
        "month": None,
        "label": str(year),
        "start_date": date(year, 1, 1).isoformat(),
        "end_date_exclusive": date(year + 1, 1, 1).isoformat(),
        "mandatory": True,
        "source": "explicit_user_query",
    }


def _extract_month_year(question: str) -> dict[str, Any]:
    q = question.lower()
    year_match = re.search(r"\b(20\d{2})\b", q)
    year = int(year_match.group(1)) if year_match else None
    month = None
    month_name = ""
    for name, num in _MONTH.items():
        if re.search(rf"\b{name}\b", q):
            month = num
            month_name = name
            break
    if not month and not year:
        return {}

    out: dict[str, Any] = {"source": "explicit_user_query", "mandatory": True}
    if month:
        out["month"] = month
        out["month_name"] = month_name
        out["kind"] = "month"
    if year:
        out["year"] = year
    if month and year:
        out["label"] = f"{month_name.title()} {year}"
        start = date(year, month, 1)
        out["start_date"] = start.isoformat()
        out["end_date_exclusive"] = _month_end_exclusive(year, month).isoformat()
    elif year:
        out["label"] = str(year)
    return out


def _extract_relative_month(question: str, *, today: date | None = None) -> dict[str, Any]:
    q = question.lower()
    today = today or date.today()
    if "last month" in q:
        first_this = today.replace(day=1)
        end_excl = first_this
        last_day_prev = first_this - timedelta(days=1)
        start = last_day_prev.replace(day=1)
        return {
            "kind": "month",
            "month": start.month,
            "year": start.year,
            "month_name": calendar.month_name[start.month].lower(),
            "label": f"{calendar.month_name[start.month]} {start.year}",
            "start_date": start.isoformat(),
            "end_date_exclusive": end_excl.isoformat(),
            "mandatory": True,
            "source": "relative_last_month",
        }
    if "this month" in q or "current month" in q:
        start = today.replace(day=1)
        excl = _month_end_exclusive(today.year, today.month)
        return {
            "kind": "month",
            "month": today.month,
            "year": today.year,
            "month_name": calendar.month_name[today.month].lower(),
            "label": f"{calendar.month_name[today.month]} {today.year}",
            "start_date": start.isoformat(),
            "end_date_exclusive": excl.isoformat(),
            "mandatory": True,
            "source": "relative_current_month",
        }
    return {}


def _extract_between_dates(question: str) -> dict[str, Any] | None:
    q = question.lower()
    m = re.search(
        r"between\s+(\d{1,2})\s+([a-z]+)\s+and\s+(\d{1,2})\s+([a-z]+)\s+(20\d{2})",
        q,
    )
    if not m:
        return None
    d1, m1, d2, m2, y = int(m.group(1)), m.group(2), int(m.group(3)), m.group(4), int(m.group(5))
    mon1 = _MONTH.get(m1[:3], _MONTH.get(m1))
    mon2 = _MONTH.get(m2[:3], _MONTH.get(m2))
    if not mon1 or not mon2:
        return None
    start = date(y, mon1, d1)
    end_incl = date(y, mon2, d2)
    end_excl = end_incl + timedelta(days=1)
    return {
        "kind": "range",
        "label": f"{start.isoformat()}..{end_incl.isoformat()}",
        "start_date": start.isoformat(),
        "end_date_exclusive": end_excl.isoformat(),
        "mandatory": True,
        "source": "explicit_user_query",
    }


def extract_time_filter(question: str, *, today: date | None = None) -> dict[str, Any]:
    between = _extract_between_dates(question)
    if between:
        return between
    quarter = _extract_quarter(question)
    if quarter:
        return quarter
    rel = _extract_relative_month(question, today=today)
    if rel:
        return rel
    month_year = _extract_month_year(question)
    if month_year.get("month") and month_year.get("year"):
        return month_year
    cal_year = _extract_calendar_year(question)
    if cal_year:
        return cal_year
    return month_year


_MANAGER_CODE_STOP = frozenset(
    {"group", "groups", "doc", "docs", "type", "name", "company", "the", "manager", "managers", "each", "all"}
)

_GROUP_CUE = re.compile(
    r"(?:split\s+by|breakdown\s+by|grouped?\s+by|group\s+by|(?:pie|bar|line)\s+chart[^.]{0,80}?\s+by|"
    r"(?<!\w)(?:by|per|across)\s+)([a-z][\w\s/&-]{0,40})",
    re.I,
)

_EXTRA_GROUP_ALIASES = {
    "doc": "manager_company",
    "docs": "manager_company",
    "technical manager": "manager_company",
    "manager groups": "manager_company",
    "manager group": "manager_company",
    "ship owner": "owner_company",
    "vessel type": "vessel_type",
    "ship type": "vessel_type",
    "sub type": "vessel_subtype",
    "subtype": "vessel_subtype",
    "vessel subtype": "vessel_subtype",
    "status": "incident_status",
}


def _alias_map() -> dict[str, str]:
    _, alias_path, _ = _ontology_paths()
    aliases = dict(_read_json(alias_path).get("aliases") or {})
    for key, val in _EXTRA_GROUP_ALIASES.items():
        aliases[key.lower()] = val
    return {str(k).lower(): str(v) for k, v in aliases.items()}


def _phrase_to_concept(phrase: str, aliases: dict[str, str]) -> str | None:
    p = re.sub(r"\s+", " ", (phrase or "").strip().lower()).strip(" .,;")
    if not p:
        return None
    if p in aliases:
        return aliases[p]
    for key in sorted(aliases, key=len, reverse=True):
        if p == key or p.endswith(key) or key in p:
            if len(key) >= 3 or p == key:
                return aliases[key]
    tokens = set(re.findall(r"[a-z]+", p))
    if "doc" in tokens or ("manager" in tokens and "group" in tokens):
        return "manager_company"
    if "owner" in tokens:
        return "owner_company"
    return None


def extract_group_by(question: str) -> list[str]:
    """Concept ids the user asked to split or break down by (not filter values)."""
    aliases = _alias_map()
    found: list[str] = []
    seen: set[str] = set()
    for m in _GROUP_CUE.finditer(question):
        phrase = m.group(1).strip()
        phrase = re.split(r"\b(?:and|with|for|in|on|where)\b", phrase, maxsplit=1, flags=re.I)[0].strip()
        concept = _phrase_to_concept(phrase, aliases)
        if concept and concept not in seen:
            seen.add(concept)
            found.append(concept)
    return found


def _fleet_aggregation(question: str, concepts: set[str]) -> str:
    q = question.lower()
    if "fleet_count" in concepts or any(w in q for w in ("how many", "no of", "number of", "count", "fleet size")):
        return "distinct_count"
    return ""


def coerce_query_plan(value: QueryPlan | dict[str, Any] | None) -> QueryPlan | None:
    if value is None:
        return None
    if isinstance(value, QueryPlan):
        return value
    if isinstance(value, dict):
        return QueryPlan.model_validate(value)
    return None


def build_query_plan(question: str, bindings: ConceptBindings | None) -> QueryPlan:
    """Deterministic plan from question + ontology bindings (no fabricated table/column names)."""
    concepts = concepts_in_question(question)
    q = question.lower()
    plan = QueryPlan(original_question=question.strip())

    if re.search(r"\b(incidents?|injur(?:y|ies))\b", q):
        plan.aggregation = plan.aggregation or "count"
        concepts.add("incident")
        if plan.output_type == "scalar":
            plan.primary_intent = "count_incidents"

    if "fleet_count" in concepts:
        plan.primary_intent = "count_distinct_vessels"
        plan.identifier_concept = "vessel_identifier"
        plan.aggregation = "distinct_count"
        plan.output_type = "scalar"
    elif any(w in q for w in ("top ", "rank", "highest", "lowest")):
        plan.output_type = "ranked"
        plan.primary_intent = "ranked_breakdown"
    elif any(w in q for w in ("split by", "breakdown", " pie", " chart", "graph", "by ", "per ", "across ")):
        plan.output_type = "table"
        plan.primary_intent = "dimensional_breakdown"

    plan.group_by = extract_group_by(question)
    group_only = set(plan.group_by)

    agg = _fleet_aggregation(question, concepts)
    if agg and not plan.aggregation:
        plan.aggregation = agg

    if "handymax" in q:
        plan.entities["vessel_subtype"] = "Handymax"
        plan.filter_literals.append(FilterLiteral(concept="vessel_subtype", raw_value="Handymax", role="subtype"))
    for token, concept, role in (
        ("panamax", "vessel_subtype", "subtype"),
        ("supramax", "vessel_subtype", "subtype"),
        ("handysize", "vessel_subtype", "subtype"),
    ):
        if token in q:
            label = token.title()
            plan.entities["vessel_subtype"] = label
            plan.filter_literals.append(FilterLiteral(concept="vessel_subtype", raw_value=label, role="subtype"))

    if re.search(r"\btanker", q) and "vessel_type" not in plan.entities:
        plan.entities["vessel_type"] = "Tanker"
        plan.filter_literals.append(FilterLiteral(concept="vessel_type", raw_value="Tanker", role="type"))
    if re.search(r"\bbulk", q):
        plan.entities["vessel_type"] = "Bulk"
        plan.filter_literals.append(FilterLiteral(concept="vessel_type", raw_value="Bulk", role="type"))

    if "sppl" in q and "manager_company" not in group_only:
        plan.entities["manager_company"] = "SPPL"
        plan.filter_literals.append(FilterLiteral(concept="manager_company", raw_value="SPPL", role="manager"))
    manager_match = re.search(r"\bmanager\s+(?:group\s+)?([A-Za-z]{2,12})\b", question, re.I)
    if manager_match and "manager_company" not in plan.entities and "manager_company" not in group_only:
        code = manager_match.group(1).upper()
        if code.lower() not in _MANAGER_CODE_STOP:
            plan.entities["manager_company"] = code
            plan.filter_literals.append(FilterLiteral(concept="manager_company", raw_value=code, role="manager"))
            concepts.add("manager_company")

    owner_match = re.search(
        r"\bowner\s+(?:of\s+)?[\"']?([A-Za-z][\w&.-]{0,40})",
        question,
        re.I,
    )
    if owner_match:
        owner_name = owner_match.group(1).strip().rstrip("?.,")
        if owner_name.lower() not in {"the", "a", "an", "for", "in", "of"}:
            plan.entities["owner_company"] = owner_name
            plan.filter_literals.append(
                FilterLiteral(concept="owner_company", raw_value=owner_name, role="owner", mandatory=True)
            )
            concepts.add("owner_company")
    elif "owner" in q and "manager" not in q and "manager group" not in q:
        plan.ambiguities.append("Question mentions owner; verify owner vs manager_company columns in bindings.")

    for status_val in ("open", "closed", "pending"):
        if re.search(rf"\b{status_val}\b", q):
            label = status_val.capitalize()
            if not any(fl.raw_value.lower() == status_val for fl in plan.filter_literals if fl.role == "status"):
                negate = any(w in q for w in ("excluding", "exclude", "except")) and status_val == "closed"
                plan.filter_literals.append(
                    FilterLiteral(
                        concept="incident_status",
                        raw_value=label,
                        role="status",
                        negate=negate,
                        mandatory=not negate,
                    )
                )

    if any(w in q for w in ("excluding", "exclude", "except")) and "closed" in q:
        if not any(fl.role == "status" and fl.raw_value.lower() == "closed" for fl in plan.filter_literals):
            plan.filter_literals.append(
                FilterLiteral(concept="incident_status", raw_value="closed", role="status", negate=True)
            )

    time_f = extract_time_filter(question)
    if time_f:
        plan.time_filter = time_f
        plan.filter_literals.append(
            FilterLiteral(
                concept="reporting_period",
                raw_value=time_f.get("label") or str(time_f),
                role="period",
                mandatory=True,
            )
        )

    if plan.group_by:
        stop = {s.lower() for s in _MANAGER_CODE_STOP}
        plan.filter_literals = [
            fl
            for fl in plan.filter_literals
            if not (fl.concept in group_only and fl.raw_value.strip().lower() in stop)
        ]
        for concept in group_only:
            val = plan.entities.get(concept, "")
            if val.strip().lower() in stop:
                plan.entities.pop(concept, None)

    if bindings:
        for note in bindings.unmatched:
            plan.missing_information.append(note)
        if "vessel_subtype" in concepts and not bindings.subtype:
            plan.missing_information.append("vessel_subtype concept not bound to a column")
        if "manager_company" in concepts and not bindings.manager:
            plan.missing_information.append("manager_company concept not bound to a column")
        if plan.aggregation == "distinct_count" and not bindings.vessel_id:
            plan.missing_information.append("vessel_identifier not bound — cannot validate distinct vessel count")
        if time_f.get("mandatory") and not bindings.date:
            plan.missing_information.append("reporting_period not bound — cannot enforce date filter in DAX")

    return plan
