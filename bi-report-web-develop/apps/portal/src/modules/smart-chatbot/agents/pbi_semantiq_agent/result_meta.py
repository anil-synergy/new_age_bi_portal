"""Describe each result column (role, format, unit) from the semantic model.

Lets the visual agent (N.O.V.A.) format values with the model's own format strings and tell dimensions,
measures and dates apart without guessing from the numbers. Metadata only - no row values are added.
"""

from __future__ import annotations

import re
from typing import Any

from .metadata import SemanticModel

_BRACKET = re.compile(r"^(?:'?([^'\[]+)'?)?\[(.+)\]$")
_DATE_TYPES = {"datetime", "date", "time", "datetimeoffset"}
_NUMERIC_TYPES = {"int64", "double", "decimal", "currency", "number", "integer"}


def _split(name: str) -> tuple[str | None, str]:
    """``'Table'[Col]`` / ``Table[Col]`` / ``[Measure]`` / ``Alias`` -> (table or None, bare name)."""
    m = _BRACKET.match(name.strip())
    if m:
        return (m.group(1) or None), m.group(2)
    return None, name.strip()


def _unit(format_string: str | None) -> str | None:
    if not format_string:
        return None
    f = format_string
    if "%" in f:
        return "percent"
    if re.search(r"[$€£¥]|usd|eur", f, re.I):
        return "currency"
    return None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def build_column_meta(columns: list[str], rows: list[dict[str, Any]], model: SemanticModel | None) -> list[dict[str, Any]]:
    measures = {}
    cols: dict[str, list[tuple[str, Any]]] = {}
    if model is not None:
        for m in model.all_measures():
            measures.setdefault(m.name.lower(), m)
        for t in model.tables:
            for c in t.columns:
                cols.setdefault(c.name.lower(), []).append((t.name, c))
    meta: list[dict[str, Any]] = []
    for name in columns:
        table, bare = _split(name)
        key = bare.lower()
        entry: dict[str, Any] = {"name": name, "label": bare}
        sample = next((r.get(name) for r in rows[:20] if r.get(name) is not None), None)
        measure = measures.get(key)
        candidates = cols.get(key) or []
        if table:
            candidates = [c for c in candidates if c[0].lower() == table.lower()] or candidates
        if measure is not None and not (table and candidates):
            entry.update(role="measure", format=measure.format_string, unit=_unit(measure.format_string), source="measure")
            if measure.display_folder:
                entry["folder"] = measure.display_folder
        elif candidates:
            tname, col = candidates[0]
            dtype = (col.data_type or "").lower()
            if dtype in _DATE_TYPES:
                role = "date"
            elif dtype in _NUMERIC_TYPES and _is_number(sample) and not re.search(r"\b(id|key|code|imo|no|number)\b", key):
                role = "measure"  # numeric column surfaced as a value (e.g. SUM-less projection)
            else:
                role = "dimension"
            entry.update(role=role, data_type=col.data_type, table=tname, source="column")
        else:  # alias created in the query (SUMMARIZECOLUMNS "Alias", expr)
            role = "measure" if _is_number(sample) else ("date" if re.search(r"date|month|year|period", key) else "dimension")
            entry.update(role=role, source="alias")
        meta.append(entry)
    return meta
