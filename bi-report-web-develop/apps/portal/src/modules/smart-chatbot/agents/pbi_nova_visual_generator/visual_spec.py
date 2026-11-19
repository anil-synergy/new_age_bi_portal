"""Visual specs that map 1:1 onto the portal's ChartPayload / KpiPayload types.

Every number in a spec is copied from the query rows; nothing here is model-generated.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .chart_extensions import (
    ADVANCED_KINDS,
    CARTESIAN_KINDS,
    MAP_KINDS,
    SCATTER_KINDS,
    ChartType,
    asks_chart_kind,
    build_echarts_option,
    buildable_chart,
    map_region_for_question,
    _geo_category,
    _lat_lon_columns,
    _sankey_columns,
)

_PIE_EXPLICIT = re.compile(r"\b(pie|donut|doughnut)\s*(chart|graph)?\b", re.I)
_TABLE_EXPLICIT = re.compile(
    r"\b(as\s+a\s+)?table\b|\btable\s+visual\b|\bgive\s+(me\s+)?(a\s+)?table\b|\bin\s+table\s+form\b",
    re.I,
)
_MATRIX_EXPLICIT = re.compile(r"\b(matrix|pivot|crosstab)\s*(visual|chart|table)?\b", re.I)
_SHARE_WORDS = re.compile(r"\b(share|split|breakdown|distribution|mix|composition|proportion|percentage of)\b", re.I)
_TREND_WORDS = re.compile(r"\b(trend|over time|monthly|weekly|daily|yearly|quarterly|by month|by year|by quarter|timeline)\b", re.I)
_LINE_EXPLICIT = re.compile(r"\bline\s*(chart|graph)\b", re.I)
_BAR_EXPLICIT = re.compile(r"\bbar\s*(chart|graph)\b", re.I)
PIE_SLICE_CAP = 12
_DATE_NAME = re.compile(r"(date|month|year|quarter|week|period|day|time)", re.I)
_PRIOR_NAME = re.compile(r"(prior|previous|last|ly|py|budget|target)", re.I)


class Dataset(BaseModel):
    label: str
    data: list[float]


class ChartPayload(BaseModel):
    type: ChartType
    labels: list[str]
    datasets: list[Dataset]
    echarts_option: dict[str, Any] | None = None
    map_region: Literal["world", "india"] | None = None
    encoding: dict[str, str] = Field(default_factory=dict)


class KpiPayload(BaseModel):
    label: str
    value: str | float
    delta: float | None = None


class TablePayload(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    truncated: bool = False


class MatrixPayload(BaseModel):
    row_field: str
    column_field: str
    value_field: str
    row_labels: list[str]
    column_labels: list[str]
    cells: list[list[float]]
    truncated: bool = False


class VisualSpec(BaseModel):
    kind: Literal["chart", "kpi", "table", "matrix", "none"]
    title: str = ""
    chart: ChartPayload | None = None
    kpi: KpiPayload | None = None
    kpis: list[KpiPayload] = Field(default_factory=list)
    table: TablePayload | None = None
    matrix: MatrixPayload | None = None
    rationale: str = ""
    x_column: str | None = None
    y_columns: list[str] = Field(default_factory=list)
    points: int = 0
    truncated: bool = False


class ColumnProfile(BaseModel):
    name: str
    role: Literal["numeric", "date", "category"]
    distinct: int


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_date(value: Any) -> bool:
    if not isinstance(value, str) or len(value) < 8:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _meta_by_name(meta: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    return {str(m.get("name")): m for m in (meta or []) if isinstance(m, dict) and m.get("name")}


def profile(columns: list[str], rows: list[dict[str, Any]], meta: list[dict[str, Any]] | None = None) -> list[ColumnProfile]:
    """Column roles. ``meta`` (SemanticModel-derived ``column_meta``) overrides guesses from the values:
    a numeric identifier such as an IMO number is a dimension, not something to chart as a measure."""
    known = _meta_by_name(meta)
    profiles = []
    for col in columns:
        values = [r.get(col) for r in rows if r.get(col) is not None]
        declared = (known.get(col) or {}).get("role")
        if values and all(_is_number(v) for v in values):
            # Year-like integer columns used as an axis behave like dates.
            looks_year = _DATE_NAME.search(col) and all(isinstance(v, int) or float(v).is_integer() for v in values)
            role = "date" if looks_year else "numeric"
            if declared == "dimension" and not looks_year:
                role = "category"
            elif declared == "date":
                role = "date"
        elif values and all(_is_date(v) for v in values):
            role = "date"
        else:
            role = "category"
        profiles.append(ColumnProfile(name=col, role=role, distinct=len({str(v) for v in values})))
    return profiles


def format_value(value: float, unit: str | None = None, format_string: str | None = None) -> str:
    """Human text for a KPI. ``unit`` / ``format_string`` come from the model's measure definition."""
    if unit == "percent":
        # A "0.0%" measure stores ratios (0.123 -> 12.3%).
        pct = value * 100 if abs(value) <= 1.5 else value
        return f"{pct:,.1f}%"
    prefix = ""
    if unit == "currency" and format_string:
        symbol = next((s for s in "$€£¥" if s in format_string), "")
        prefix = symbol
    body = f"{int(value):,}" if float(value).is_integer() else f"{value:,.2f}"
    return f"{prefix}{body}"


def _label(value: Any) -> str:
    if isinstance(value, str) and _is_date(value):
        return value[:10]
    if value is None:
        return "(blank)"
    if _is_number(value) and float(value).is_integer():
        return str(int(value))
    return str(value)


def asks_pie(question: str) -> bool:
    return bool(_PIE_EXPLICIT.search(question) or _SHARE_WORDS.search(question))


def asks_table(question: str) -> bool:
    return bool(_TABLE_EXPLICIT.search(question))


def asks_matrix(question: str) -> bool:
    return bool(_MATRIX_EXPLICIT.search(question))


def _matrix_dims(profiles: list[ColumnProfile]) -> tuple[str, str, str] | None:
    cats = [p for p in profiles if p.role == "category"]
    numeric = [p.name for p in profiles if p.role == "numeric"]
    if len(cats) < 2 or not numeric:
        return None
    row_dim, col_dim = cats[0], cats[1]
    if col_dim.distinct > row_dim.distinct:
        row_dim, col_dim = col_dim, row_dim
    return row_dim.name, col_dim.name, numeric[0]


def _pivot_matrix(
    rows: list[dict[str, Any]],
    row_field: str,
    col_field: str,
    value_field: str,
    *,
    max_rows: int,
    max_cols: int,
) -> MatrixPayload:
    bucket: dict[tuple[str, str], float] = {}
    for r in rows:
        rv, cv = _label(r.get(row_field)), _label(r.get(col_field))
        v = float(r[value_field]) if _is_number(r.get(value_field)) else 0.0
        key = (rv, cv)
        bucket[key] = bucket.get(key, 0.0) + v
    row_labels = sorted({k[0] for k in bucket})
    col_labels = sorted({k[1] for k in bucket})
    truncated = False
    if len(row_labels) > max_rows:
        row_labels = row_labels[:max_rows]
        truncated = True
    if len(col_labels) > max_cols:
        col_labels = col_labels[:max_cols]
        truncated = True
    cells = [[bucket.get((rv, cv), 0.0) for cv in col_labels] for rv in row_labels]
    return MatrixPayload(
        row_field=row_field,
        column_field=col_field,
        value_field=value_field,
        row_labels=row_labels,
        column_labels=col_labels,
        cells=cells,
        truncated=truncated,
    )


def buildable(
    kind: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    x: str | None,
    ys: list[str],
    *,
    question: str = "",
    allow_pie_on_date: bool = False,
) -> bool:
    """Whether rows can be plotted as the given chart kind (values still copied from rows)."""
    profiles = profile(columns, rows)
    by_name = {p.name: p for p in profiles}
    numeric = [p.name for p in profiles if p.role == "numeric"]
    if kind == "table":
        return bool(rows)
    if kind == "matrix":
        return _matrix_dims(profile(columns, rows)) is not None
    if not rows:
        return False
    if kind == "kpi":
        return len(rows) == 1 and bool(numeric)
    cartesian_ok = False
    if x and ys and numeric:
        xp = by_name.get(x)
        if xp is not None:
            if kind in ("pie", "donut"):
                cartesian_ok = bool(
                    len(numeric) == 1
                    and len(ys) == 1
                    and xp.role in ("category", "date")
                    and (xp.role != "date" or allow_pie_on_date or asks_pie(question))
                )
            else:
                cartesian_ok = True
    lat_lon = _lat_lon_columns(columns)
    geo_col = _geo_category(columns)
    sankey = _sankey_columns(columns, numeric)
    extended = CARTESIAN_KINDS | SCATTER_KINDS | MAP_KINDS | ADVANCED_KINDS
    if kind in extended:
        return buildable_chart(
            kind,
            cartesian_ok=cartesian_ok,
            numeric_count=len(numeric),
            lat_lon=lat_lon,
            geo_col=geo_col,
            sankey_cols=sankey,
            row_count=len(rows),
        )
    if kind in ("bar", "line", "pie"):
        return cartesian_ok
    return False


def _explicit_chart_allowlist(
    question: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    x: str | None,
    ys: list[str],
    profiles: list[ColumnProfile],
) -> list[ChartType]:
    candidates: list[ChartType] = [
        "donut",
        "area",
        "stacked-bar",
        "horizontal-bar",
        "combo",
        "funnel",
        "gauge",
        "radar",
        "sankey",
        "treemap",
        "sunburst",
        "scatter",
        "map",
        "geo-scatter",
        "geo-lines",
        "heatmap",
    ]
    out: list[ChartType] = []
    for kind in candidates:
        if not asks_chart_kind(question, kind):
            continue
        if buildable(kind, columns, rows, x, ys, question=question):
            out.append(kind)
    if _lat_lon_columns(columns) and "geo-scatter" not in out:
        if buildable("geo-scatter", columns, rows, x, ys, question=question):
            out.append("geo-scatter")
    if _geo_category(columns) and "map" not in out:
        if buildable("map", columns, rows, x, ys, question=question):
            out.append("map")
    return out


def recommend(
    question: str, columns: list[str], rows: list[dict[str, Any]], meta: list[dict[str, Any]] | None = None
) -> tuple[list[ChartType | Literal["kpi", "table", "matrix"]], str | None, list[str]]:
    """Allowed visual kinds (best first), the x column and the y columns."""
    profiles = profile(columns, rows, meta)
    numeric = [p.name for p in profiles if p.role == "numeric"]
    dims = [p for p in profiles if p.role != "numeric"]
    if not rows:
        return ["table"], None, numeric
    if asks_table(question):
        allowed: list[ChartType | Literal["kpi", "table", "matrix"]] = ["table"]
        if _matrix_dims(profiles):
            allowed.append("matrix")
        if numeric:
            allowed.extend(["bar", "line"])
        x = dims[0].name if dims else None
        return allowed, x, numeric
    if asks_matrix(question) and _matrix_dims(profiles):
        dims_pick = _matrix_dims(profiles)
        assert dims_pick is not None
        return ["matrix", "table", "bar"], dims_pick[0], [dims_pick[2]]
    if not numeric:
        return ["table"], None, []
    if len(rows) == 1 and not dims:
        return ["kpi", "table"], None, numeric
    if len(rows) == 1:
        return ["kpi", "bar", "table"], dims[0].name, numeric
    x = next((p for p in dims if p.role == "date"), dims[0] if dims else None)
    if x is None:
        return ["table"], None, numeric
    explicit_pie = asks_pie(question)
    if len(numeric) == 1 and explicit_pie:
        return ["pie", "bar", "table"], x.name, numeric
    if (x.role == "date" or _TREND_WORDS.search(question)) and not explicit_pie:
        if _LINE_EXPLICIT.search(question):
            return ["line", "bar", "table"], x.name, numeric
        return ["line", "bar", "table"], x.name, numeric
    if _BAR_EXPLICIT.search(question):
        return ["bar", "line", "pie", "table"], x.name, numeric
    if len(numeric) == 1 and x.distinct <= 6 and _SHARE_WORDS.search(question):
        return ["pie", "bar", "table"], x.name, numeric
    if len(numeric) == 1 and x.distinct <= 6:
        return ["bar", "pie", "table"], x.name, numeric
    _extra = _explicit_chart_allowlist(question, columns, rows, x.name if x else None, numeric, profiles)
    if _extra:
        base: list[ChartType | Literal["table"]] = ["bar", "line", "table"] if x else ["table"]
        return _extra + [k for k in base if k not in _extra], x.name if x else None, numeric
    if _matrix_dims(profiles):
        dims_pick = _matrix_dims(profiles)
        assert dims_pick is not None
        return ["matrix", "bar", "table"], dims_pick[0], [dims_pick[2]]
    return ["bar", "line", "table"], x.name, numeric


def _rollup_pie_rows(
    ordered: list[dict[str, Any]],
    x: str,
    y: str,
    max_slices: int,
) -> tuple[list[dict[str, Any]], bool]:
    if len(ordered) <= max_slices:
        return ordered, False
    ranked = sorted(ordered, key=lambda r: -(float(r.get(y) or 0)))
    keep = max(max_slices - 1, 1)
    top = ranked[:keep]
    rest = ranked[keep:]
    other = sum(float(r[y]) for r in rest if _is_number(r.get(y)))
    if other > 0:
        template = dict(top[0]) if top else {x: "Other", y: other}
        template[x] = "Other"
        template[y] = other
        top.append(template)
    return top, True


def build_spec(
    kind: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    x: str | None,
    ys: list[str],
    *,
    title: str,
    max_points: int,
    rationale: str = "",
    meta: list[dict[str, Any]] | None = None,
) -> VisualSpec:
    known = _meta_by_name(meta)
    if not rows:
        return VisualSpec(kind="none", title=title, rationale=rationale)

    if kind == "table":
        cap = max(max_points * 4, 50)
        slice_rows = rows[:cap]
        return VisualSpec(
            kind="table",
            title=title,
            rationale=rationale,
            points=len(rows),
            truncated=len(rows) > cap,
            table=TablePayload(columns=columns, rows=slice_rows, truncated=len(rows) > cap),
        )

    if kind == "matrix":
        pick = _matrix_dims(profile(columns, rows))
        if pick is None:
            return build_spec("table", columns, rows, x, ys, title=title, max_points=max_points, rationale=rationale)
        row_field, col_field, value_field = pick
        matrix = _pivot_matrix(
            rows,
            row_field,
            col_field,
            value_field,
            max_rows=max_points,
            max_cols=min(max_points, 24),
        )
        return VisualSpec(
            kind="matrix",
            title=title,
            rationale=rationale,
            matrix=matrix,
            x_column=row_field,
            y_columns=[value_field],
            points=len(rows),
            truncated=matrix.truncated,
        )

    if kind == "kpi":
        row = rows[0]
        kpis = [
            KpiPayload(
                label=str((known.get(y) or {}).get("label") or y),
                value=format_value(float(row[y]), (known.get(y) or {}).get("unit"), (known.get(y) or {}).get("format")),
            )
            for y in ys
            if _is_number(row.get(y))
        ]
        if len(kpis) >= 2 and _PRIOR_NAME.search(ys[1]) and float(row[ys[1]]) != 0:
            change = (float(row[ys[0]]) - float(row[ys[1]])) / abs(float(row[ys[1]])) * 100
            kpis[0].delta = round(change, 2)
        if x and row.get(x) is not None:
            for k in kpis:
                k.label = f"{k.label} ({_label(row[x])})"
        return VisualSpec(kind="kpi", title=title, kpi=kpis[0] if kpis else None, kpis=kpis, rationale=rationale, y_columns=ys, points=1)

    if kind in MAP_KINDS | ADVANCED_KINDS or kind == "scatter":
        region = map_region_for_question(title) if kind in MAP_KINDS else None
        eopt = build_echarts_option(kind, rows, x, ys, columns=columns, map_region=region)
        if eopt is None and kind in ADVANCED_KINDS:
            return build_spec("bar", columns, rows, x, ys, title=title, max_points=max_points, rationale=rationale)
        labels = [_label(r.get(x)) for r in rows[:max_points]] if x else [str(i) for i in range(min(len(rows), max_points))]
        datasets = (
            [Dataset(label=ys[0], data=[float(r[ys[0]]) if _is_number(r.get(ys[0])) else 0.0 for r in rows[:max_points]])]
            if ys
            else []
        )
        if kind == "scatter" and len(ys) >= 2:
            datasets = [
                Dataset(label=ys[0], data=[float(r.get(ys[0]) or 0) for r in rows[:max_points]]),
                Dataset(label=ys[1], data=[float(r.get(ys[1]) or 0) for r in rows[:max_points]]),
            ]
            labels = [str(i) for i in range(len(rows[:max_points]))]
        enc: dict[str, str] = {}
        ll = _lat_lon_columns(columns)
        if ll:
            enc = {"lat": ll[0], "lon": ll[1]}
        chart_type: ChartType = kind  # type: ignore[assignment]
        return VisualSpec(
            kind="chart",
            title=title,
            chart=ChartPayload(
                type=chart_type,
                labels=labels,
                datasets=datasets,
                echarts_option=eopt,
                map_region=region if kind in MAP_KINDS else None,
                encoding=enc,
            ),
            rationale=rationale,
            x_column=x,
            y_columns=ys[:4],
            points=len(labels),
            truncated=len(rows) > max_points,
        )

    sort_kind = "line" if kind in ("area",) else "pie" if kind == "donut" else kind
    ordered = list(rows)
    truncated = False
    if sort_kind == "line":
        ordered.sort(key=lambda r: str(r.get(x)))
    elif ys and len(ordered) > max_points:
        ordered.sort(key=lambda r: -(float(r.get(ys[0]) or 0)))
    if len(ordered) > max_points:
        ordered = ordered[-max_points:] if sort_kind == "line" else ordered[:max_points]
        truncated = True
    if sort_kind == "pie":
        ys = ys[:1]
        ordered = [r for r in ordered if _is_number(r.get(ys[0])) and float(r[ys[0]]) > 0]
        pie_cap = min(max_points, PIE_SLICE_CAP)
        ordered, pie_rolled = _rollup_pie_rows(ordered, x, ys[0], pie_cap)
        truncated = truncated or pie_rolled

    labels = [_label(r.get(x)) for r in ordered]
    datasets = [Dataset(label=y, data=[float(r[y]) if _is_number(r.get(y)) else 0.0 for r in ordered]) for y in ys[:4]]
    chart_type = kind if kind in CARTESIAN_KINDS else ("bar" if kind not in ("line", "pie", "donut", "area") else kind)
    return VisualSpec(
        kind="chart",
        title=title,
        chart=ChartPayload(type=chart_type, labels=labels, datasets=datasets),  # type: ignore[arg-type]
        rationale=rationale,
        x_column=x,
        y_columns=ys[:4],
        points=len(labels),
        truncated=truncated,
    )
