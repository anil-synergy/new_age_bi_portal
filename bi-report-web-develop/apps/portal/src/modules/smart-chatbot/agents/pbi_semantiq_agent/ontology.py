"""Organisation ontology: concept detection, model-scoped bindings, result validation."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from .metadata import SemanticModel, resolve_calendar_date
from .metadata_paths import ontology_dir, read_jsonl
from .vessel_master import VESSEL_ATTR_CONCEPTS, vessel_master_table

_NORM = re.compile(r"[^a-z0-9]+")
_CALENDAR_TABLE = re.compile(r"calendar|dim[\s_-]*date|^dates?$|date table", re.I)
_VISUAL_GROUP_MEASURES = {"type group"}


def _norm(text: str) -> str:
    return _NORM.sub("", (text or "").lower())


def _norm_name(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


@dataclass
class FieldBinding:
    concept: str
    table: str
    column: str
    data_type: str | None = None
    confidence: float = 0.0
    source: str = "model_scan"


@dataclass
class ConceptBindings:
    dataset_id: str
    concepts: set[str] = field(default_factory=set)
    vessel_id: FieldBinding | None = None
    vessel_type: FieldBinding | None = None
    subtype: FieldBinding | None = None
    owner: FieldBinding | None = None
    manager: FieldBinding | None = None
    date: FieldBinding | None = None
    status: FieldBinding | None = None
    fact_date: FieldBinding | None = None
    date_via_calendar: bool = False
    calendar_relationship: str | None = None
    count_measure: str | None = None
    exclusions: list[str] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)
    visual_labels: list[str] = field(default_factory=list)
    vessel_master_table: str | None = None
    vessel_name: FieldBinding | None = None
    handover_date: FieldBinding | None = None
    takeover_date: FieldBinding | None = None

    def to_prompt(self) -> str:
        lines = ["CANONICAL BINDINGS (use exact spellings when present):"]
        if self.vessel_master_table:
            lines.append(
                f"- vessel_master_dimension: '{self.vessel_master_table}' "
                "(prefer this table for manager/DOC, type, subtype, owner, IMO, vessel name, handover/takeover filters; "
                "relate facts via IMO when the model has that relationship)"
            )
        for label, binding in (
            ("vessel_identifier", self.vessel_id),
            ("vessel_name", self.vessel_name),
            ("vessel_type", self.vessel_type),
            ("vessel_subtype", self.subtype),
            ("owner_company", self.owner),
            ("manager_company", self.manager),
            ("vessel_handover_date", self.handover_date),
            ("vessel_takeover_date", self.takeover_date),
            ("reporting_period", self.date),
        ):
            if binding:
                lines.append(f"- {label}: '{binding.table}'[{binding.column}]")
            elif label in self.concepts:
                lines.append(f"- {label}: (not bound in model — state in assumptions)")
        if self.date_via_calendar and self.calendar_relationship:
            lines.append(f"- period filter path: {self.calendar_relationship}")
            if self.fact_date:
                lines.append(
                    f"- event date on fact: '{self.fact_date.table}'[{self.fact_date.column}] "
                    "(filter the Calendar one-side when relationships allow)"
                )
        if self.status:
            lines.append(f"- incident_status: '{self.status.table}'[{self.status.column}]")
        if self.count_measure:
            lines.append(f"- validated count measure candidate: {self.count_measure}")
        if self.exclusions:
            lines.append("EXCLUDED FOR THIS QUESTION: " + ", ".join(self.exclusions))
        if self.visual_labels:
            lines.append("VISUAL LABELS (do not EVALUATE as measures):")
            for row in self.visual_labels[:12]:
                lines.append(f"- {row}")
        if self.unmatched:
            lines.append("UNMATCHED QUESTION TOKENS: " + ", ".join(self.unmatched[:8]))
        return "\n".join(lines)


@lru_cache
def _ontology_paths() -> tuple[Path, Path, Path]:
    base = ontology_dir()
    return base / "business_ontology.json", base / "business_aliases.json", base / "business_rules.json"


_json_cache: dict[str, tuple[tuple[float, int], dict[str, Any]]] = {}


def _read_json(path: Path) -> dict[str, Any]:
    """Parsed ontology JSON, re-read only when the file changes (mtime or size).

    Callers must treat the result as read-only. It was re-parsed on every question per candidate before,
    which cost seconds per retrieval.
    """
    try:
        st = path.stat()
    except OSError:
        return {}
    sig = (st.st_mtime, st.st_size)
    key = str(path)
    hit = _json_cache.get(key)
    if hit and hit[0] == sig:
        return hit[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {}
    _json_cache[key] = (sig, data)
    return data


BINDINGS_FILE = "concept_bindings.jsonl"  # reviewed / manual rows (always win)
AUTO_BINDINGS_FILE = "concept_bindings.auto.jsonl"  # generated from model schemas on every sync
REVIEW_BINDINGS_FILE = "concept_bindings.review.jsonl"  # ambiguous matches, never used at runtime

_bindings_cache: dict[str, Any] = {"sig": None, "value": {}}


def _file_sig(path: Path) -> tuple[float, int] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return (st.st_mtime, st.st_size)


def _read_binding_rows(path: Path, default_source: str) -> dict[str, dict[str, FieldBinding]]:
    out: dict[str, dict[str, FieldBinding]] = {}
    for row in read_jsonl(path):
        ds = str(row.get("dataset_id") or "").lower()
        concept = str(row.get("concept") or "")
        table = str(row.get("table") or "")
        column = str(row.get("column") or "")
        if not ds or not concept or not table or not column:
            continue
        out.setdefault(ds, {})[concept] = FieldBinding(
            concept=concept,
            table=table,
            column=column,
            data_type=row.get("data_type"),
            confidence=float(row.get("confidence") or 0.95),
            source=str(row.get("source") or default_source),
        )
    return out


def load_concept_bindings() -> dict[str, dict[str, FieldBinding]]:
    """Per dataset_id -> concept -> binding. Auto rows first, reviewed/manual rows override.

    Re-read automatically when either file changes (mtime/size), so sync results apply without a restart.
    """
    base = ontology_dir()
    manual, auto = base / BINDINGS_FILE, base / AUTO_BINDINGS_FILE
    sig = (str(base), _file_sig(manual), _file_sig(auto))
    if _bindings_cache["sig"] == sig:
        return _bindings_cache["value"]
    merged = _read_binding_rows(auto, "auto_scan")
    for ds, concepts in _read_binding_rows(manual, "binding_file").items():
        merged.setdefault(ds, {}).update(concepts)
    _bindings_cache["sig"] = sig
    _bindings_cache["value"] = merged
    return merged


def _clear_bindings_cache() -> None:
    _bindings_cache["sig"] = None


def load_visual_mappings(dataset_id: str, report_id: str | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    ds = dataset_id.lower()
    for row in read_jsonl(ontology_dir() / "measure_visual_mapping.jsonl"):
        if str(row.get("dataset_id") or "").lower() != ds:
            continue
        if report_id and row.get("report_id") and str(row.get("report_id")).lower() != report_id.lower():
            continue
        rows.append(row)
    return rows


def concepts_in_question(question: str, *, hints: dict[str, Any] | None = None) -> set[str]:
    ontology_path, alias_path, _ = _ontology_paths()
    ontology = _read_json(ontology_path)
    aliases = _read_json(alias_path).get("aliases") or {}
    q = (question or "").lower()
    found: set[str] = set()
    for entry in ontology.get("concepts") or []:
        cid = str(entry.get("id") or "")
        if not cid:
            continue
        for alias in entry.get("aliases") or []:
            if str(alias).lower() in q:
                found.add(cid)
    for alias, target in aliases.items():
        if alias.lower() in q:
            found.add(str(target))
    overlay = (hints or {}).get("alias_to_concept") or {}
    for phrase, concept in overlay.items():
        if str(phrase).lower() in q:
            found.add(str(concept))
    return found


def _kpi_measure_ref(model: SemanticModel, allow_names: list[str]) -> str | None:
    allowed = {_norm(n) for n in allow_names}
    for m in model.all_measures():
        if m.hidden:
            continue
        key = _norm(m.name)
        if key in allowed or any(a in key for a in allowed if len(a) > 3):
            return f"[{m.name}]"
    return None


def _pick_reporting_date(
    question: str,
    model: SemanticModel,
    file_bindings: dict[str, FieldBinding],
    pick: Any,
    concepts: set[str],
) -> FieldBinding | None:
    reported = any(w in question.lower() for w in ("reported", "lodged", "submitted", "created", "closed"))
    if "incident_date" in file_bindings and not reported:
        return file_bindings["incident_date"]
    if reported:
        for concept in ("reported_date", "reporting_period"):
            if concept in file_bindings:
                return file_bindings[concept]
        reported_cols = ["REPORTED_DATE", "DATE_REPORTED", "CREATED_DATE", "CLOSED_DATE"]
        binding = _match_column(model, reported_cols)
        if binding:
            binding.concept = "reporting_period"
            return binding
    if "incident" in concepts or re.search(r"\bincidents?\b", question, re.I):
        event_cols = ["DATE_OF_INCIDENT", "INCIDENT_DATE", "OCCURRENCE_DATE", "EVENT_DATE"]
        binding = _match_column(model, event_cols)
        if binding:
            binding.concept = "reporting_period"
            return binding
    return pick("reporting_period") if pick else None


def _upgrade_date_binding(model: SemanticModel, fact: FieldBinding | None) -> FieldBinding | None:
    if not fact:
        path = resolve_calendar_date(model)
    else:
        path = resolve_calendar_date(model, fact_table=fact.table, fact_column=fact.column)
    if not path:
        return fact
    return FieldBinding(
        "reporting_period",
        path.table,
        path.column,
        "DateTime",
        0.95 if path.active else 0.85,
        "calendar_rel",
    )


def _match_column_in_table(table: Any, allow_names: list[str], *, source: str, base_confidence: float) -> FieldBinding | None:
    allowed = {_norm(n) for n in allow_names}
    best: FieldBinding | None = None
    if table.hidden:
        return None
    for col in table.columns:
        if col.hidden:
            continue
        key = _norm(col.name)
        if key in allowed or any(a in key for a in allowed if len(a) > 4):
            cand = FieldBinding("scan", table.name, col.name, col.data_type, base_confidence, source)
            if best is None or cand.confidence > best.confidence:
                best = cand
        elif _norm_name(col.name) in {_norm_name(n) for n in allow_names}:
            best = FieldBinding("scan", table.name, col.name, col.data_type, min(base_confidence + 0.1, 0.95), source)
    return best


def _match_column(model: SemanticModel, allow_names: list[str], *, prefer_table: str | None = None) -> FieldBinding | None:
    if prefer_table:
        table = model.table(prefer_table)
        if table:
            hit = _match_column_in_table(table, allow_names, source="vessel_master", base_confidence=0.92)
            if hit:
                return hit
    allowed = {_norm(n) for n in allow_names}
    best: FieldBinding | None = None
    for table in model.tables:
        if table.hidden:
            continue
        for col in table.columns:
            if col.hidden:
                continue
            key = _norm(col.name)
            if key in allowed or any(a in key for a in allowed if len(a) > 4):
                cand = FieldBinding("scan", table.name, col.name, col.data_type, 0.7, "model_scan")
                if best is None or cand.confidence > best.confidence:
                    best = cand
            elif _norm_name(col.name) in {_norm_name(n) for n in allow_names}:
                best = FieldBinding("scan", table.name, col.name, col.data_type, 0.85, "model_scan")
    return best


def _distinctcount_measure(model: SemanticModel, identifier: FieldBinding) -> str | None:
    ref = f"'{identifier.table}'[{identifier.column}]"
    needle = _norm(identifier.column)
    for m in model.all_measures():
        if m.hidden:
            continue
        expr = (m.expression or "").lower()
        if "distinctcount" in expr and needle in _norm(expr):
            return f"'{m.table}'[{m.name}]"
        if "distinctcount" in expr and identifier.table.lower() in expr:
            return f"'{m.table}'[{m.name}]"
    return None


def bind_concepts(
    question: str,
    model: SemanticModel,
    dataset_id: str,
    *,
    catalog_entry: dict[str, Any] | None = None,
    hints: dict[str, Any] | None = None,
) -> ConceptBindings:
    concepts = concepts_in_question(question, hints=hints)
    rules = _read_json(_ontology_paths()[2])
    file_bindings = load_concept_bindings().get(dataset_id.lower(), {})
    ontology = _read_json(_ontology_paths()[0])
    concept_defs = {str(c["id"]): c for c in ontology.get("concepts") or [] if c.get("id")}

    out = ConceptBindings(dataset_id=dataset_id.lower(), concepts=concepts)
    master = vessel_master_table(model, rules)
    out.vessel_master_table = master

    def pick(concept_id: str) -> FieldBinding | None:
        if concept_id in file_bindings:
            return file_bindings[concept_id]
        spec = concept_defs.get(concept_id) or {}
        allow = list(spec.get("column_allow_names") or [])
        extra = ((rules.get("vessel_dimension_table") or {}).get("columns_by_concept") or {}).get(concept_id) or []
        allow = list(dict.fromkeys([*allow, *extra]))
        prefer = master if master and concept_id in VESSEL_ATTR_CONCEPTS else None
        if allow:
            binding = _match_column(model, allow, prefer_table=prefer)
            if binding:
                binding.concept = concept_id
                return binding
        return None

    if "fleet_count" in concepts or "vessel_identifier" in concepts:
        out.vessel_id = pick("vessel_identifier")
    if "vessel_type" in concepts:
        out.vessel_type = pick("vessel_type")
    if "vessel_subtype" in concepts:
        out.subtype = pick("vessel_subtype")
    if "owner_company" in concepts:
        out.owner = pick("owner_company")
    if "manager_company" in concepts:
        out.manager = pick("manager_company")
    if "vessel_name" in concepts or re.search(r"\b(vessel|ship)\s+name\b", question, re.I):
        out.vessel_name = pick("vessel_name")
        out.concepts.add("vessel_name")
    if re.search(r"\bhand\s*over\b", question, re.I):
        out.handover_date = pick("vessel_handover_date")
        out.concepts.add("vessel_handover_date")
    if re.search(r"\btake\s*over\b", question, re.I):
        out.takeover_date = pick("vessel_takeover_date")
        out.concepts.add("vessel_takeover_date")
    if "reporting_period" in concepts or re.search(r"\b(20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b", question, re.I):
        fact_date = _pick_reporting_date(question, model, file_bindings, pick, concepts)
        out.fact_date = fact_date
        calendar_path = resolve_calendar_date(
            model,
            fact_table=fact_date.table if fact_date else None,
            fact_column=fact_date.column if fact_date else None,
        )
        upgraded = _upgrade_date_binding(model, fact_date)
        if upgraded and calendar_path and _CALENDAR_TABLE.search(upgraded.table):
            out.date = upgraded
            out.date_via_calendar = True
            out.calendar_relationship = calendar_path.describe()
        else:
            out.date = fact_date
        out.concepts.add("reporting_period")

    q_lower = question.lower()
    if any(w in q_lower for w in ("open", "closed", "pending", "status")) or re.search(
        r"\b(excluding|exclude|except)\b.*\bclosed\b", q_lower
    ):
        status_cols = ["STATUS", "INCIDENT_STATUS", "STATE", "CASE_STATUS"]
        status_binding = _match_column(model, status_cols)
        if status_binding:
            status_binding.concept = "incident_status"
            out.status = status_binding
            out.concepts.add("incident_status")

    if "incident" in concepts or re.search(r"\bincidents?\b", question, re.I):
        out.concepts.add("incident")
        spec = concept_defs.get("incident") or {}
        allow = list(spec.get("measure_allow_names") or [])
        out.count_measure = out.count_measure or _kpi_measure_ref(model, allow)

    for rule in rules.get("rules") or []:
        when = set(rule.get("when_concepts") or [])
        if when and not (when & concepts):
            continue
        for measure in rule.get("forbid_measures") or []:
            out.exclusions.append(f"measure[{measure}]")
        for col in rule.get("forbid_count_of") or []:
            out.exclusions.append(f"column[{col}]")

    if out.vessel_id and "fleet_count" in concepts:
        out.count_measure = _distinctcount_measure(model, out.vessel_id)

    report_id = str((catalog_entry or {}).get("report_id") or "")
    visuals = (catalog_entry or {}).get("visual_titles") or []
    mappings = load_visual_mappings(dataset_id, report_id or None)
    for title in visuals:
        title_s = str(title).strip()
        if title_s:
            mapped = next((m for m in mappings if str(m.get("visual_title") or "").lower() == title_s.lower()), None)
            if mapped and mapped.get("measure"):
                out.visual_labels.append(f"{title_s} → measure {mapped['measure']}")
            else:
                out.visual_labels.append(f"{title_s} → use bound identifier or validated fleet measure, not as DAX measure name")

    if "handymax" in question.lower() and not out.subtype:
        out.unmatched.append("handymax (no subtype column bound)")
    if "sppl" in question.lower() and not out.manager:
        out.unmatched.append("SPPL (no manager column bound)")

    # region agent log
    try:
        from .xmla_client import _agent_log

        _agent_log(
            hypothesis_id="IMO-A,B",
            location="ontology.py:bind_concepts",
            message="vessel master bindings",
            data={
                "vessel_master_table": master,
                "manager": f"{out.manager.table}[{out.manager.column}]" if out.manager else None,
                "manager_source": out.manager.source if out.manager else None,
                "vessel_type": f"{out.vessel_type.table}[{out.vessel_type.column}]" if out.vessel_type else None,
                "vessel_id": f"{out.vessel_id.table}[{out.vessel_id.column}]" if out.vessel_id else None,
            },
        )
    except Exception:
        pass
    # endregion

    return out


def apply_binding_slice_adjustments(bindings: ConceptBindings, measure_scores: list[tuple[float, Any]]) -> list[tuple[float, Any]]:
    adjusted: list[tuple[float, Any]] = []
    for score, measure in measure_scores:
        name = _norm_name(measure.name)
        if name in _VISUAL_GROUP_MEASURES or any(ex.endswith(f"[{measure.name}]") for ex in bindings.exclusions):
            score -= 2.0
        elif bindings.exclusions and f"measure[{measure.name}]" in bindings.exclusions:
            score -= 3.0
        if bindings.count_measure and f"'{measure.table}'[{measure.name}]" == bindings.count_measure:
            score += 1.5
        if bindings.subtype and name == "type group":
            score -= 2.5
        adjusted.append((score, measure))
    return adjusted


def _dax_escape(value: str) -> str:
    return (value or "").replace('"', '""')


def _treatas_literal(binding: FieldBinding, raw_value: str) -> str:
    literal = _dax_escape(raw_value)
    return f'TREATAS({{"{literal}"}}, \'{binding.table}\'[{binding.column}])'


def _plan_literals(plan: "QueryPlan | None") -> dict[str, str]:
    literals: dict[str, str] = {}
    if not plan:
        return literals
    for fl in plan.filter_literals:
        if fl.raw_value and fl.role != "period":
            literals[fl.concept] = fl.raw_value
    for key, val in (plan.entities or {}).items():
        literals.setdefault(key, val)
    return literals


def _date_filter_clauses(bindings: ConceptBindings, plan: "QueryPlan | None") -> list[str]:
    if not bindings.date or not plan or not plan.time_filter:
        return []
    t, c = bindings.date.table, bindings.date.column
    ref = f"'{t}'[{c}]"
    tf = plan.time_filter
    start = tf.get("start_date")
    end_excl = tf.get("end_date_exclusive")
    if start and end_excl:
        y1, m1, d1 = (int(x) for x in start.split("-"))
        y2, m2, d2 = (int(x) for x in end_excl.split("-"))
        return [f"{ref} >= DATE({y1}, {m1}, {d1})", f"{ref} < DATE({y2}, {m2}, {d2})"]
    month, year = tf.get("month"), tf.get("year")
    if month and year:
        return [f"YEAR({ref}) = {int(year)}", f"MONTH({ref}) = {int(month)}"]
    if year and not month:
        return [f"YEAR({ref}) = {int(year)}"]
    return []


def _dimension_filter_clauses(bindings: ConceptBindings, plan: "QueryPlan | None") -> list[str]:
    literals = _plan_literals(plan)
    filters: list[str] = []
    if bindings.subtype and literals.get("vessel_subtype"):
        filters.append(_treatas_literal(bindings.subtype, literals["vessel_subtype"]))
    if bindings.vessel_type and literals.get("vessel_type"):
        filters.append(_treatas_literal(bindings.vessel_type, literals["vessel_type"]))
    if bindings.manager and literals.get("manager_company"):
        filters.append(_treatas_literal(bindings.manager, literals["manager_company"]))
    if bindings.owner and literals.get("owner_company"):
        filters.append(_treatas_literal(bindings.owner, literals["owner_company"]))
    if bindings.status:
        for fl in (plan.filter_literals if plan else []):
            if fl.role != "status" or not fl.raw_value:
                continue
            if fl.negate:
                filters.append(
                    f"'{bindings.status.table}'[{bindings.status.column}] <> \"{_dax_escape(fl.raw_value)}\""
                )
            else:
                filters.append(_treatas_literal(bindings.status, fl.raw_value))
    return filters


def _measure_from_planned_dax(planned_dax: str) -> str | None:
    hits = re.findall(r"\[([^\]]+)\]", planned_dax or "")
    if not hits:
        return None
    return f"[{hits[0]}]"


def validation_dax(bindings: ConceptBindings, planned_dax: str, plan: "QueryPlan | None" = None) -> str | None:
    """Independent check with the same mandatory filters as the query plan."""
    from .filter_preservation import requires_mandatory_filter_validation

    if not plan or not requires_mandatory_filter_validation(plan, bindings):
        if "fleet_count" not in bindings.concepts or not bindings.vessel_id:
            return None
    filters = _dimension_filter_clauses(bindings, plan) + _date_filter_clauses(bindings, plan)
    if not filters:
        return None

    if "fleet_count" in bindings.concepts and bindings.vessel_id:
        ident = bindings.vessel_id
        filter_expr = ", ".join(filters)
        return (
            "EVALUATE ROW("
            f"\"ValidationCount\", CALCULATE(DISTINCTCOUNT('{ident.table}'[{ident.column}]), {filter_expr})"
            ")"
        )

    if bindings.date or bindings.count_measure or _measure_from_planned_dax(planned_dax):
        measure = bindings.count_measure or _measure_from_planned_dax(planned_dax)
        if not measure:
            return None
        filter_expr = ", ".join(filters)
        return f'EVALUATE ROW("ValidationCount", CALCULATE({measure}, {filter_expr}))'

    return None


@dataclass
class ValidationOutcome:
    status: str
    message: str = ""
    validation_value: float | None = None
    planned_value: float | None = None


def classify_execution(rows: list[dict[str, Any]], *, dax_error: str | None = None) -> ValidationOutcome:
    if dax_error:
        return ValidationOutcome("dax_error", dax_error[:500])
    if not rows:
        return ValidationOutcome("empty", "Query returned no rows.")
    numeric = []
    for row in rows:
        for value in row.values():
            if isinstance(value, (int, float)):
                numeric.append(float(value))
    if not numeric:
        return ValidationOutcome("ok")
    if all(v == 0 for v in numeric):
        return ValidationOutcome("zero", "All numeric values are zero.")
    return ValidationOutcome("ok")


def reconcile_values(
    planned: ValidationOutcome,
    validation_rows: list[dict[str, Any]] | None,
    *,
    mandatory_time_filter: bool = False,
    mandatory_filters: bool = False,
) -> ValidationOutcome:
    if not validation_rows or planned.status not in {"zero", "ok"}:
        return planned
    val_nums = [float(v) for row in validation_rows for v in row.values() if isinstance(v, (int, float))]
    if not val_nums:
        return planned
    validation_value = val_nums[0]
    planned_value = planned.planned_value
    if planned.status == "zero" and validation_value > 0:
        return ValidationOutcome(
            "assumed",
            f"Planned query returned 0 but validation DISTINCTCOUNT is {validation_value}.",
            validation_value=validation_value,
            planned_value=planned_value or 0.0,
        )
    enforce = mandatory_filters or mandatory_time_filter
    if enforce and planned_value is not None:
        if abs(planned_value - validation_value) > max(1.0, 0.05 * max(abs(validation_value), 1.0)):
            return ValidationOutcome(
                "filter_leakage",
                f"Planned value {planned_value} does not match independently filtered validation {validation_value}.",
                validation_value=validation_value,
                planned_value=planned_value,
            )
    return planned


def extract_primary_value(rows: list[dict[str, Any]]) -> float | None:
    for row in rows:
        for value in row.values():
            if isinstance(value, (int, float)):
                return float(value)
    return None
