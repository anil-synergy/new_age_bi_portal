"""Extended chart kinds, buildability rules, and ECharts option builders (data copied from rows only)."""

from __future__ import annotations

import re
from typing import Any, Literal

ChartType = Literal[
    "bar",
    "line",
    "pie",
    "donut",
    "area",
    "stacked-bar",
    "horizontal-bar",
    "combo",
    "scatter",
    "funnel",
    "treemap",
    "sunburst",
    "gauge",
    "radar",
    "sankey",
    "graph",
    "chord",
    "parallel",
    "themeRiver",
    "tree",
    "heatmap",
    "boxplot",
    "candlestick",
    "calendar-heatmap",
    "map",
    "geo-scatter",
    "geo-lines",
]

CARTESIAN_KINDS = frozenset({"bar", "line", "pie", "donut", "area", "stacked-bar", "horizontal-bar", "combo"})
SCATTER_KINDS = frozenset({"scatter"})
MAP_KINDS = frozenset({"map", "geo-scatter", "geo-lines"})
ADVANCED_KINDS = frozenset(
    {
        "funnel",
        "treemap",
        "sunburst",
        "gauge",
        "radar",
        "sankey",
        "graph",
        "chord",
        "parallel",
        "themeRiver",
        "tree",
        "heatmap",
        "boxplot",
        "candlestick",
        "calendar-heatmap",
    }
)

_LAT = re.compile(r"\b(lat|latitude)\b", re.I)
_LON = re.compile(r"\b(lon|lng|longitude)\b", re.I)
_GEO_NAME = re.compile(r"\b(country|nation|region|state|territory|geo)\b", re.I)
_INDIA = re.compile(r"\b(india|indian|state)\b", re.I)
_SANKEY = re.compile(r"\b(source|from|origin)\b", re.I)
_SANKEY_TO = re.compile(r"\b(target|to|destination)\b", re.I)
_FUNNEL = re.compile(r"\bfunnel\b", re.I)
_GAUGE = re.compile(r"\bgauge\b", re.I)
_RADAR = re.compile(r"\bradar\b", re.I)
_SANKEY_WORD = re.compile(r"\bsankey\b", re.I)
_MAP_WORD = re.compile(r"\b(map|choropleth|geo)\b", re.I)
_SCATTER_WORD = re.compile(r"\bscatter\b", re.I)
_AREA_WORD = re.compile(r"\barea\s*(chart|graph)?\b", re.I)
_DONUT_WORD = re.compile(r"\b(donut|doughnut)\b", re.I)


def asks_chart_kind(question: str, kind: str) -> bool:
    q = question.lower()
    patterns: dict[str, re.Pattern[str]] = {
        "funnel": _FUNNEL,
        "gauge": _GAUGE,
        "radar": _RADAR,
        "sankey": _SANKEY_WORD,
        "map": _MAP_WORD,
        "scatter": _SCATTER_WORD,
        "area": _AREA_WORD,
        "donut": _DONUT_WORD,
    }
    pat = patterns.get(kind)
    return bool(pat.search(q)) if pat else False


def _lat_lon_columns(columns: list[str]) -> tuple[str, str] | None:
    lat = next((c for c in columns if _LAT.search(c)), None)
    lon = next((c for c in columns if _LON.search(c)), None)
    if lat and lon:
        return lat, lon
    return None


def _geo_category(columns: list[str]) -> str | None:
    return next((c for c in columns if _GEO_NAME.search(c)), None)


def buildable_chart(
    kind: str,
    *,
    cartesian_ok: bool,
    numeric_count: int,
    lat_lon: tuple[str, str] | None,
    geo_col: str | None,
    sankey_cols: tuple[str, str, str] | None,
    row_count: int,
) -> bool:
    if kind in CARTESIAN_KINDS:
        if kind == "combo":
            return cartesian_ok and numeric_count >= 2
        if kind == "scatter":
            return numeric_count >= 2 and row_count >= 2
        if kind in ("pie", "donut"):
            return cartesian_ok and numeric_count == 1
        return cartesian_ok
    if kind in SCATTER_KINDS:
        return numeric_count >= 2 and row_count >= 2
    if kind == "map":
        return bool(geo_col and numeric_count >= 1)
    if kind == "geo-scatter":
        return lat_lon is not None and row_count >= 1
    if kind == "geo-lines":
        return lat_lon is not None and row_count >= 2
    if kind == "sankey":
        return sankey_cols is not None
    if kind in ("funnel", "treemap", "sunburst"):
        return cartesian_ok and numeric_count == 1
    if kind == "gauge":
        return numeric_count >= 1 and row_count == 1
    if kind == "radar":
        return cartesian_ok and numeric_count >= 1
    if kind in ADVANCED_KINDS:
        return cartesian_ok or numeric_count >= 1
    return False


def _sankey_columns(columns: list[str], numeric: list[str]) -> tuple[str, str, str] | None:
    if not numeric:
        return None
    src = next((c for c in columns if _SANKEY.search(c) and c not in numeric), None)
    dst = next((c for c in columns if _SANKEY_TO.search(c) and c not in numeric), None)
    val = numeric[0]
    if src and dst:
        return src, dst, val
    cats = [c for c in columns if c not in numeric]
    if len(cats) >= 2:
        return cats[0], cats[1], val
    return None


def build_echarts_option(
    kind: str,
    rows: list[dict[str, Any]],
    x: str | None,
    ys: list[str],
    *,
    columns: list[str],
    map_region: str | None = None,
) -> dict[str, Any] | None:
    lat_lon = _lat_lon_columns(columns)
    if kind == "geo-scatter" and lat_lon and ys:
        lat_f, lon_f = lat_lon
        y = ys[0]
        return {
            "geo": {"map": map_region or "world", "roam": False},
            "series": [
                {
                    "type": "effectScatter",
                    "coordinateSystem": "geo",
                    "data": [
                        {
                            "name": str(r.get(x or lat_f)),
                            "value": [float(r.get(lon_f) or 0), float(r.get(lat_f) or 0), float(r.get(y) or 0)],
                        }
                        for r in rows
                        if _is_number(r.get(lat_f)) and _is_number(r.get(lon_f))
                    ],
                }
            ],
        }
    if kind == "sankey":
        sk = _sankey_columns(columns, ys)
        if not sk:
            return None
        src, dst, val = sk
        links = []
        for r in rows:
            if r.get(src) is None or r.get(dst) is None:
                continue
            links.append(
                {
                    "source": str(r.get(src)),
                    "target": str(r.get(dst)),
                    "value": float(r.get(val) or 0) if _is_number(r.get(val)) else 0.0,
                }
            )
        nodes = {n: True for link in links for n in (link["source"], link["target"])}
        return {
            "series": [
                {
                    "type": "sankey",
                    "data": [{"name": k} for k in nodes],
                    "links": links,
                    "label": {"show": True},
                }
            ]
        }
    if kind == "funnel" and x and ys:
        y = ys[0]
        return {
            "series": [
                {
                    "type": "funnel",
                    "data": [{"name": str(r.get(x)), "value": float(r.get(y) or 0)} for r in rows],
                    "label": {"show": True, "position": "inside"},
                }
            ]
        }
    if kind == "treemap" and x and ys:
        y = ys[0]
        return {
            "series": [
                {
                    "type": "treemap",
                    "data": [{"name": str(r.get(x)), "value": float(r.get(y) or 0)} for r in rows],
                    "label": {"show": True},
                }
            ]
        }
    if kind == "gauge" and ys:
        y = ys[0]
        row = rows[0]
        return {
            "series": [
                {
                    "type": "gauge",
                    "data": [{"value": float(row.get(y) or 0), "name": y}],
                    "detail": {"formatter": "{value}"},
                }
            ]
        }
    if kind == "radar" and x and ys:
        indicators = [{"name": str(r.get(x)), "max": max(float(r.get(ys[0]) or 0) for r in rows) * 1.2 or 1} for r in rows[:12]]
        return {
            "radar": {"indicator": indicators},
            "series": [{"type": "radar", "data": [{"value": [float(r.get(y) or 0) for y in ys], "name": "Series"}], "label": {"show": True}}],
        }
    return None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def map_region_for_question(question: str) -> Literal["world", "india"]:
    return "india" if _INDIA.search(question) else "world"