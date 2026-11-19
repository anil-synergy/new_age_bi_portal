"""Semantic model metadata via DAX INFO.VIEW functions, plus relevance ranking for schema slices."""

from __future__ import annotations

import asyncio
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from smart_common.grounding import truncate_text
from smart_common.keywords import with_stems

from .powerbi_client import PowerBIClient, PowerBIError

_SYSTEM_TABLE_PREFIXES = ("DateTableTemplate_", "LocalDateTable_")

QUERIES = {
    "tables": "EVALUATE INFO.VIEW.TABLES()",
    "columns": "EVALUATE INFO.VIEW.COLUMNS()",
    "measures": "EVALUATE INFO.VIEW.MEASURES()",
    "relationships": "EVALUATE INFO.VIEW.RELATIONSHIPS()",
    "hierarchies": "EVALUATE INFO.VIEW.HIERARCHIES()",
}

_DAX_REF = re.compile(r"'([^']+)'\[([^\]]+)\]")


@dataclass
class Column:
    name: str
    data_type: str | None = None
    description: str | None = None
    hidden: bool = False


@dataclass
class Measure:
    name: str
    table: str
    expression: str | None = None
    format_string: str | None = None
    description: str | None = None
    display_folder: str | None = None
    hidden: bool = False


@dataclass
class Table:
    name: str
    description: str | None = None
    hidden: bool = False
    columns: list[Column] = field(default_factory=list)
    measures: list[Measure] = field(default_factory=list)


@dataclass
class Relationship:
    from_table: str
    from_column: str
    to_table: str
    to_column: str
    cardinality: str | None = None
    active: bool = True
    cross_filter: str | None = None


@dataclass
class SemanticModel:
    workspace_id: str
    dataset_id: str
    name: str | None
    tables: list[Table]
    relationships: list[Relationship]

    # ------------------------------------------------------------ lookups
    def table(self, name: str) -> Table | None:
        lowered = name.lower()
        return next((t for t in self.tables if t.name.lower() == lowered), None)

    def all_measures(self) -> list[Measure]:
        return [m for t in self.tables for m in t.measures]

    def measure_names(self) -> set[str]:
        return {m.name.lower() for m in self.all_measures()}

    def column_names(self) -> set[str]:
        return {c.name.lower() for t in self.tables for c in t.columns}

    def stats(self) -> dict[str, int]:
        return {
            "tables": len(self.tables),
            "columns": sum(len(t.columns) for t in self.tables),
            "measures": sum(len(t.measures) for t in self.tables),
            "relationships": len(self.relationships),
        }

    def to_dict(self, include_hidden: bool = False, include_expressions: bool = False) -> dict[str, Any]:
        tables = []
        for t in self.tables:
            if t.hidden and not include_hidden:
                continue
            tables.append(
                {
                    "name": t.name,
                    "description": t.description,
                    "columns": [
                        {"name": c.name, "dataType": c.data_type, "description": c.description}
                        for c in t.columns
                        if include_hidden or not c.hidden
                    ],
                    "measures": [
                        {
                            "name": m.name,
                            "formatString": m.format_string,
                            "description": m.description,
                            "displayFolder": m.display_folder,
                            **({"expression": m.expression} if include_expressions else {}),
                        }
                        for m in t.measures
                        if include_hidden or not m.hidden
                    ],
                }
            )
        return {
            "workspaceId": self.workspace_id,
            "datasetId": self.dataset_id,
            "name": self.name,
            "stats": self.stats(),
            "tables": tables,
            "relationships": [asdict(r) for r in self.relationships],
        }


def _pick(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def _bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes"}


def build_model(workspace_id: str, dataset_id: str, name: str | None, raw: dict[str, list[dict[str, Any]]]) -> SemanticModel:
    tables: dict[str, Table] = {}
    for row in raw.get("tables", []):
        tname = _pick(row, "Name", "TableName")
        if not tname or str(tname).startswith(_SYSTEM_TABLE_PREFIXES):
            continue
        tables[tname.lower()] = Table(name=tname, description=_pick(row, "Description"), hidden=_bool(_pick(row, "IsHidden")))

    for row in raw.get("columns", []):
        tname = _pick(row, "Table", "TableName")
        cname = _pick(row, "Name", "ColumnName", "ExplicitName")
        if not tname or not cname or tname.lower() not in tables:
            continue
        if str(cname).startswith("RowNumber-"):
            continue
        tables[tname.lower()].columns.append(
            Column(name=cname, data_type=_pick(row, "DataType"), description=_pick(row, "Description"), hidden=_bool(_pick(row, "IsHidden")))
        )

    for row in raw.get("measures", []):
        tname = _pick(row, "Table", "TableName")
        mname = _pick(row, "Name", "MeasureName")
        if not tname or not mname or tname.lower() not in tables:
            continue
        tables[tname.lower()].measures.append(
            Measure(
                name=mname,
                table=tname,
                expression=_pick(row, "Expression"),
                format_string=_pick(row, "FormatString"),
                description=_pick(row, "Description"),
                display_folder=_pick(row, "DisplayFolder"),
                hidden=_bool(_pick(row, "IsHidden")),
            )
        )

    relationships: list[Relationship] = []
    for row in raw.get("relationships", []):
        from_table, to_table = _pick(row, "FromTable"), _pick(row, "ToTable")
        if not from_table or not to_table:
            continue
        if str(from_table).startswith(_SYSTEM_TABLE_PREFIXES) or str(to_table).startswith(_SYSTEM_TABLE_PREFIXES):
            continue
        from_card, to_card = _pick(row, "FromCardinality"), _pick(row, "ToCardinality")
        relationships.append(
            Relationship(
                from_table=from_table,
                from_column=_pick(row, "FromColumn") or "",
                to_table=to_table,
                to_column=_pick(row, "ToColumn") or "",
                cardinality=f"{from_card}:{to_card}" if from_card and to_card else None,
                active=_bool(_pick(row, "IsActive")) if _pick(row, "IsActive") is not None else True,
                cross_filter=_pick(row, "CrossFilteringBehavior"),
            )
        )

    return SemanticModel(workspace_id, dataset_id, name, list(tables.values()), relationships)


def model_from_dict(data: dict[str, Any]) -> SemanticModel:
    """Rebuild SemanticModel from model.to_dict() / model.json."""
    workspace_id = str(data.get("workspaceId") or "")
    dataset_id = str(data.get("datasetId") or "")
    name = data.get("name")
    tables: list[Table] = []
    for t in data.get("tables") or []:
        tables.append(
            Table(
                name=t["name"],
                description=t.get("description"),
                hidden=bool(t.get("hidden")),
                columns=[
                    Column(
                        name=c["name"],
                        data_type=c.get("dataType"),
                        description=c.get("description"),
                        hidden=bool(c.get("hidden")),
                    )
                    for c in t.get("columns") or []
                ],
                measures=[
                    Measure(
                        name=m["name"],
                        table=t["name"],
                        expression=m.get("expression"),
                        format_string=m.get("formatString"),
                        description=m.get("description"),
                        display_folder=m.get("displayFolder"),
                        hidden=bool(m.get("hidden")),
                    )
                    for m in t.get("measures") or []
                ],
            )
        )
    relationships = [
        Relationship(
            from_table=r.get("from_table") or r.get("fromTable") or "",
            from_column=r.get("from_column") or r.get("fromColumn") or "",
            to_table=r.get("to_table") or r.get("toTable") or "",
            to_column=r.get("to_column") or r.get("toColumn") or "",
            cardinality=r.get("cardinality"),
            active=bool(r.get("active", True)),
            cross_filter=r.get("cross_filter") or r.get("crossFilter"),
        )
        for r in data.get("relationships") or []
    ]
    return SemanticModel(workspace_id, dataset_id, name, tables, relationships)


def parse_hierarchies(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "table": _pick(row, "Table", "TableName"),
                "name": _pick(row, "Name", "HierarchyName"),
                "description": _pick(row, "Description"),
                "hidden": _bool(_pick(row, "IsHidden")),
                "levels": _pick(row, "Levels"),
            }
        )
    return [h for h in out if h.get("table") and h.get("name")]


def build_dax_dependencies(model: SemanticModel) -> dict[str, Any]:
    measures = model.all_measures()
    by_measure: dict[str, list[dict[str, str]]] = {}
    references: set[str] = set()
    for measure in measures:
        expr = measure.expression or ""
        if not expr.strip():
            continue
        refs: list[dict[str, str]] = []
        for table, column in _DAX_REF.findall(expr):
            refs.append({"table": table, "column": column})
            references.add(f"{table}[{column}]")
        if refs:
            by_measure[f"{measure.table}[{measure.name}]"] = refs
    return {"measure_count": len(measures), "referenced_columns": sorted(references), "by_measure": by_measure}


async def load_model(client: PowerBIClient, workspace_id: str, dataset_id: str, *, user: str | None, name: str | None = None) -> SemanticModel:
    model, _, _ = await load_model_extended(client, workspace_id, dataset_id, user=user, name=name)
    return model


_REQUIRED_INFO_VIEW = ("tables", "columns")
_OPTIONAL_INFO_VIEW = ("measures", "relationships", "hierarchies")


async def _info_view_rows(
    client: PowerBIClient,
    workspace_id: str,
    dataset_id: str,
    user: str | None,
    key: str,
    *,
    required: bool,
) -> list[dict[str, Any]]:
    try:
        out = await client.execute_dax_with_rls_retry(workspace_id, dataset_id, QUERIES[key], user=user)
        return list(out.get("rows") or [])
    except (PowerBIError, RuntimeError):
        if required:
            raise
        return []


async def load_model_extended(
    client: PowerBIClient,
    workspace_id: str,
    dataset_id: str,
    *,
    user: str | None,
    name: str | None = None,
) -> tuple[SemanticModel, list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """Load model schema via XMLA INFO.VIEW (XMLA_Test: tables+columns required; rest optional)."""
    raw: dict[str, list[dict[str, Any]]] = {}
    for key in _REQUIRED_INFO_VIEW:
        raw[key] = await _info_view_rows(client, workspace_id, dataset_id, user, key, required=True)
    for key in _OPTIONAL_INFO_VIEW:
        raw[key] = await _info_view_rows(client, workspace_id, dataset_id, user, key, required=False)
    hierarchies = parse_hierarchies(raw.get("hierarchies") or [])
    return build_model(workspace_id, dataset_id, name, raw), hierarchies, raw


# ------------------------------------------------------------------ relevance
_WORD = re.compile(r"[a-z0-9]+")
_STOP = {
    "the", "a", "an", "of", "for", "by", "in", "on", "to", "and", "or", "is", "are", "what", "which", "show", "me",
    "give", "list", "how", "many", "much", "per", "with", "top", "from", "this", "that", "last", "vs", "all", "my",
}


_TIME = re.compile(
    r"\b(today|yesterday|day|days|week|weeks|month|months|year|years|date|period|ytd|mtd|qtd|"
    r"january|february|march|april|may|june|july|august|september|october|november|december|"
    r"jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|last month|this month|current month|q[1-4]|20\d{2})\b",
    re.I,
)
_CALENDAR_TABLE = re.compile(r"calendar|dim[\s_-]*date|^dates?$|date table", re.I)
_DATE_NAME = re.compile(r"date", re.I)


def asks_for_time(question: str) -> bool:
    return bool(_TIME.search(question or ""))


def _tokens(text: str | None) -> set[str]:
    words = {w for w in _WORD.findall((text or "").lower()) if w not in _STOP}
    return with_stems(words)


def _split_identifier(name: str) -> str:
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", name).replace("_", " ")


def _score(query: set[str], *texts: str | None) -> float:
    if not query:
        return 0.0
    tokens: set[str] = set()
    for text in texts:
        tokens |= _tokens(_split_identifier(text) if text else text)
    overlap = query & tokens
    partial = sum(1 for q in query - overlap for t in tokens if len(q) > 3 and (q in t or t in q))
    return len(overlap) + 0.5 * partial


@dataclass
class SchemaSlice:
    tables: list[str]
    measures: list[Measure]
    columns: list[tuple[str, Column]]
    relationships: list[Relationship]
    date_filters: list[str] = field(default_factory=list)
    binding_notes: str = ""

    def to_prompt(self, extra: str = "", *, max_expressions: int = 14, expression_chars: int = 320) -> str:
        """Prompt text for the DAX planner.

        The best-matching measures (the slice is ordered by relevance) include their DAX definition so the
        model can tell which measure already does the aggregation/filtering the question needs, instead of
        guessing from the name. ``max_expressions`` keeps the prompt small.
        """
        lines = []
        if extra.strip():
            lines.append(extra.strip())
        if self.binding_notes.strip():
            lines.append(self.binding_notes.strip())
        lines.append("MEASURES (use these for aggregations whenever one fits):")
        shown = 0
        for m in self.measures:
            fmt = f" | format: {m.format_string}" if m.format_string else ""
            folder = f" | folder: {m.display_folder}" if getattr(m, "display_folder", None) else ""
            desc = f" | {truncate_text(m.description, 120)}" if m.description else ""
            lines.append(f"- '{m.table}'[{m.name}]{fmt}{folder}{desc}")
            expr = " ".join((m.expression or "").split())
            if expr and shown < max_expressions:
                lines.append(f"    := {truncate_text(expr, expression_chars)}")
                shown += 1
        lines.append("COLUMNS:")
        for table, c in self.columns:
            desc = f" | {truncate_text(c.description, 100)}" if c.description else ""
            lines.append(f"- '{table}'[{c.name}] ({c.data_type or 'unknown'}){desc}")
        if self.relationships:
            lines.append("RELATIONSHIPS (many side -> one side):")
            for r in self.relationships:
                flag = "" if r.active else " (inactive: use USERELATIONSHIP)"
                both = " (filters both directions)" if "both" in (r.cross_filter or "").lower() else ""
                lines.append(f"- '{r.from_table}'[{r.from_column}] -> '{r.to_table}'[{r.to_column}] {r.cardinality or ''}{flag}{both}")
        if self.date_filters:
            lines.append("DATE FILTERS (use one of these for last/this/previous day, week, month or year):")
            lines.extend(f"- {hint}" for hint in self.date_filters)
        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        return {
            "tables": self.tables,
            "measures": [{"table": m.table, "name": m.name, "formatString": m.format_string, "description": m.description} for m in self.measures],
            "columns": [{"table": t, "name": c.name, "dataType": c.data_type} for t, c in self.columns],
            "relationships": [asdict(r) for r in self.relationships],
        }


def select_slice(
    model: SemanticModel,
    question: str,
    *,
    max_measures: int = 25,
    max_columns: int = 45,
    bindings: Any | None = None,
) -> SchemaSlice:
    query = _tokens(question)
    measure_scores = [
        (_score(query, m.name, m.description, m.display_folder, m.table), m)
        for m in model.all_measures()
        if not m.hidden
    ]
    if bindings is not None:
        try:
            from .ontology import apply_binding_slice_adjustments

            measure_scores = apply_binding_slice_adjustments(bindings, measure_scores)
        except ImportError:
            pass
    column_scores = [
        (_score(query, c.name, c.description, t.name) + (0.25 if _score(query, t.name) else 0), t.name, c)
        for t in model.tables
        if not t.hidden
        for c in t.columns
        if not c.hidden
    ]
    measure_scores.sort(key=lambda s: -s[0])
    column_scores.sort(key=lambda s: -s[0])

    measures = [m for s, m in measure_scores if s > 0][:max_measures]
    if len(measures) < 8:
        measures += [m for _, m in measure_scores if m not in measures][: 8 - len(measures)]
    columns = [(t, c) for s, t, c in column_scores if s > 0][:max_columns]

    tables = {m.table for m in measures} | {t for t, _ in columns}
    for t in model.tables:
        if not t.hidden and _score(query, t.name):
            tables.add(t.name)
    # Bring in the one-side dimension tables related to selected tables so filters/grouping are possible.
    related = [r for r in model.relationships if r.from_table in tables or r.to_table in tables]
    for r in related:
        tables.add(r.to_table)
        tables.add(r.from_table)

    date_filters: list[str] = []
    if asks_for_time(question):
        dated, date_filters = _date_context(model, tables)
        for item in reversed(dated):
            if item not in columns:
                columns.insert(0, item)
        columns = columns[:max_columns]
        for table, _col in dated:
            tables.add(table)

    if len(columns) < max_columns:
        for t in model.tables:
            if t.name in tables and not t.hidden:
                for c in t.columns:
                    if not c.hidden and (t.name, c) not in columns and len(columns) < max_columns:
                        columns.append((t.name, c))
    master_cols_added = 0
    if bindings is not None:
        for binding in (
            bindings.vessel_id,
            bindings.subtype,
            bindings.manager,
            bindings.date,
            bindings.vessel_name,
            bindings.handover_date,
            bindings.takeover_date,
            bindings.vessel_type,
            bindings.owner,
        ):
            if binding:
                tables.add(binding.table)
                col = model.table(binding.table)
                if col:
                    match = next((c for c in col.columns if c.name == binding.column), None)
                    if match and (binding.table, match) not in columns:
                        columns.insert(0, (binding.table, match))
        if getattr(bindings, "vessel_master_table", None):
            from .vessel_master import master_columns_for_slice, question_touches_vessel_attrs, vessel_dimension_config
            from .ontology import _read_json, _ontology_paths

            master_name = bindings.vessel_master_table
            rules = _read_json(_ontology_paths()[2])
            cfg = vessel_dimension_config(rules)
            master = model.table(master_name)
            if master and question_touches_vessel_attrs(question, getattr(bindings, "concepts", set()) or set()):
                tables.add(master_name)
                for col_name in master_columns_for_slice(master, cfg):
                    match = next((c for c in master.columns if c.name == col_name and not c.hidden), None)
                    if match and (master_name, match) not in columns:
                        columns.insert(0, (master_name, match))
                        master_cols_added += 1
                # region agent log
                try:
                    from .xmla_client import _agent_log

                    _agent_log(
                        hypothesis_id="IMO-B",
                        location="metadata.py:select_slice",
                        message="IMO_MASTER_LIST slice injection",
                        data={"master_table": master_name, "columns_added": master_cols_added},
                    )
                except Exception:
                    pass
                # endregion
    relationships = [r for r in model.relationships if r.from_table in tables and r.to_table in tables]
    notes = bindings.to_prompt() if bindings is not None else ""
    return SchemaSlice(sorted(tables), measures, columns, relationships, date_filters, binding_notes=notes)


def relationship_lookup_side(rel: Relationship) -> tuple[str, str]:
    """One-side (lookup) table and column for a model relationship."""
    card = (rel.cardinality or "").lower().replace(" ", "")
    if "manytoone" in card or card.endswith(":one") or ":one" in card:
        return rel.to_table, rel.to_column
    if "onetomany" in card or card.startswith("one:"):
        return rel.from_table, rel.from_column
    return rel.to_table, rel.to_column


_lookup_side = relationship_lookup_side


def _column(model: SemanticModel, table: str, name: str) -> Column | None:
    found = model.table(table)
    if not found or not name:
        return None
    return next((c for c in found.columns if c.name.lower() == name.lower() and not c.hidden), None)


def _is_date(col: Column | None, name: str, table: str) -> bool:
    if _CALENDAR_TABLE.search(table) and _DATE_NAME.search(name or ""):
        return True
    if col and col.data_type and "date" in col.data_type.lower():
        return True
    return bool(_DATE_NAME.search(name or "")) and bool(_CALENDAR_TABLE.search(table) or (col and col.data_type and "date" in col.data_type.lower()))


def _date_context(model: SemanticModel, focus: set[str]) -> tuple[list[tuple[str, Column]], list[str]]:
    """Related calendar [Date] columns, plus date columns on the selected fact tables."""
    chosen: list[tuple[str, Column]] = []
    hints: list[str] = []
    seen: set[tuple[str, str]] = set()

    def add(table: str, col: Column) -> None:
        key = (table.lower(), col.name.lower())
        if key in seen:
            return
        seen.add(key)
        chosen.append((table, col))

    for rel in model.relationships:
        if focus and rel.from_table not in focus and rel.to_table not in focus:
            continue
        lookup_table, lookup_column = relationship_lookup_side(rel)
        col = _column(model, lookup_table, lookup_column)
        if _is_date(col, lookup_column, lookup_table):
            if col:
                add(lookup_table, col)
            inactive = "" if rel.active else " (inactive: use USERELATIONSHIP in CALCULATE)"
            hints.append(
                f"Filter '{lookup_table}'[{lookup_column}] (one side of "
                f"'{rel.from_table}'[{rel.from_column}] -> '{rel.to_table}'[{rel.to_column}], {rel.cardinality or 'related'}){inactive}. "
                f"Use it for the period, for example CALCULATE(<measure>, DATESINPERIOD('{lookup_table}'[{lookup_column}], TODAY(), -1, DAY))."
            )
        fact_col = _column(model, rel.from_table, rel.from_column)
        if fact_col and fact_col.data_type and "date" in fact_col.data_type.lower():
            add(rel.from_table, fact_col)

    for table in model.tables:
        if table.hidden or table.name not in focus:
            continue
        for col in table.columns:
            if col.hidden:
                continue
            if col.data_type and "date" in col.data_type.lower():
                add(table.name, col)
    return chosen[:8], hints[:6]


@dataclass
class CalendarDatePath:
    table: str
    column: str
    active: bool
    cardinality: str | None
    cross_filter: str | None
    from_table: str
    from_column: str
    to_table: str
    to_column: str

    def describe(self) -> str:
        flag = "active" if self.active else "inactive (USERELATIONSHIP required)"
        return (
            f"'{self.table}'[{self.column}] via "
            f"'{self.from_table}'[{self.from_column}] -> '{self.to_table}'[{self.to_column}] "
            f"({self.cardinality or 'related'}, {flag})"
        )


def resolve_calendar_date(
    model: SemanticModel,
    *,
    fact_table: str | None = None,
    fact_column: str | None = None,
) -> CalendarDatePath | None:
    """Prefer Calendar/DimDate [Date] on the one-side of a relationship to the fact date."""
    candidates: list[tuple[int, CalendarDatePath]] = []
    fact_t = (fact_table or "").lower()
    fact_c = (fact_column or "").lower()

    for rel in model.relationships:
        lookup_table, lookup_column = relationship_lookup_side(rel)
        if not _CALENDAR_TABLE.search(lookup_table):
            continue
        col = _column(model, lookup_table, lookup_column)
        if not _is_date(col, lookup_column, lookup_table):
            continue
        if fact_t and fact_table and fact_column:
            ends = {
                (rel.from_table.lower(), rel.from_column.lower()),
                (rel.to_table.lower(), rel.to_column.lower()),
            }
            if (fact_t, fact_c) not in ends:
                continue
        path = CalendarDatePath(
            table=lookup_table,
            column=lookup_column,
            active=rel.active,
            cardinality=rel.cardinality,
            cross_filter=rel.cross_filter,
            from_table=rel.from_table,
            from_column=rel.from_column,
            to_table=rel.to_table,
            to_column=rel.to_column,
        )
        score = (10 if rel.active else 0) + (5 if fact_t else 0)
        candidates.append((score, path))

    if not candidates:
        for table in model.tables:
            if table.hidden or not _CALENDAR_TABLE.search(table.name):
                continue
            for col in table.columns:
                if col.hidden:
                    continue
                if _is_date(col, col.name, table.name):
                    candidates.append(
                        (
                            1,
                            CalendarDatePath(
                                table=table.name,
                                column=col.name,
                                active=True,
                                cardinality=None,
                                cross_filter=None,
                                from_table="",
                                from_column="",
                                to_table=table.name,
                                to_column=col.name,
                            ),
                        )
                    )
                    break

    if not candidates:
        return None
    candidates.sort(key=lambda item: -item[0])
    return candidates[0][1]


def search(model: SemanticModel, query: str, limit: int = 20) -> list[dict[str, Any]]:
    tokens = _tokens(query)
    hits: list[tuple[float, dict[str, Any]]] = []
    for t in model.tables:
        if t.hidden:
            continue
        score = _score(tokens, t.name, t.description)
        if score:
            hits.append((score + 0.1, {"kind": "table", "table": t.name, "name": t.name, "description": t.description}))
        for c in t.columns:
            if c.hidden:
                continue
            score = _score(tokens, c.name, c.description)
            if score:
                hits.append((score, {"kind": "column", "table": t.name, "name": c.name, "dataType": c.data_type, "description": c.description}))
        for m in t.measures:
            if m.hidden:
                continue
            score = _score(tokens, m.name, m.description, m.display_folder)
            if score:
                hits.append((score + 0.2, {"kind": "measure", "table": t.name, "name": m.name, "formatString": m.format_string, "description": m.description}))
    hits.sort(key=lambda h: -h[0])
    return [dict(h[1], score=round(h[0], 2)) for h in hits[:limit]]
