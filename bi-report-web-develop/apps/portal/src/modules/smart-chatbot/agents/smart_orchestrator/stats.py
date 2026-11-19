"""Descriptive statistics computed in code from query rows (the only numbers the summary may use)."""

from __future__ import annotations

import re
from typing import Any

from pbi_nova_visual_generator.visual_spec import format_value, profile


def compute_stats(columns: list[str], rows: list[dict[str, Any]]) -> dict[str, Any]:
    profiles = profile(columns, rows)
    numeric = [p.name for p in profiles if p.role == "numeric"]
    dims = [p.name for p in profiles if p.role != "numeric"]
    stats: dict[str, Any] = {"row_count": len(rows), "measures": {}}
    for col in numeric:
        values = [float(r[col]) for r in rows if isinstance(r.get(col), (int, float)) and not isinstance(r.get(col), bool)]
        if not values:
            continue
        total = sum(values)
        entry: dict[str, Any] = {
            "count": len(values),
            "total": round(total, 4),
            "average": round(total / len(values), 4),
            "min": round(min(values), 4),
            "max": round(max(values), 4),
        }
        if dims:
            dim = dims[0]
            top = max(rows, key=lambda r: float(r.get(col) or 0))
            bottom = min(rows, key=lambda r: float(r.get(col) or 0))
            entry["top"] = {"label": str(top.get(dim)), "value": float(top.get(col) or 0)}
            entry["bottom"] = {"label": str(bottom.get(dim)), "value": float(bottom.get(col) or 0)}
            if total and all(v >= 0 for v in values) and len(values) > 1:
                entry["top_share_pct"] = round(entry["top"]["value"] / total * 100, 2)
        date_dims = [p.name for p in profiles if p.role == "date"]
        if date_dims and len(values) >= 2:
            ordered = sorted(rows, key=lambda r: str(r.get(date_dims[0])))
            first, last = float(ordered[0].get(col) or 0), float(ordered[-1].get(col) or 0)
            entry["first"] = {"label": str(ordered[0].get(date_dims[0])), "value": first}
            entry["last"] = {"label": str(ordered[-1].get(date_dims[0])), "value": last}
            if first:
                entry["change_pct"] = round((last - first) / abs(first) * 100, 2)
        stats["measures"][col] = entry
    return stats


def stat_cards(stats: dict[str, Any], limit: int = 4) -> list[dict[str, Any]]:
    """Compact cards for the chat panel."""
    cards: list[dict[str, Any]] = []
    for name, entry in stats.get("measures", {}).items():
        if stats["row_count"] == 1:
            cards.append({"label": name, "value": format_value(entry["total"])})
            continue
        cards.append({"label": f"Total {name}", "value": format_value(entry["total"])})
        if "top" in entry:
            cards.append({"label": f"Top: {entry['top']['label']}", "value": format_value(entry["top"]["value"])})
        if "change_pct" in entry:
            cards.append({"label": f"Change in {name}", "value": f"{entry['change_pct']:+.2f}%"})
        if len(cards) >= limit:
            break
    return cards[:limit]


def deterministic_summary(question: str, stats: dict[str, Any], result_description: str = "") -> str:
    """Template summary built only from computed values (used when the LLM text fails grounding)."""
    rows = stats.get("row_count", 0)
    if rows == 0:
        return "The query ran successfully but returned no rows for your access and the current filters."
    parts: list[str] = []
    if rows == 1:
        measures = stats.get("measures") or {}
        if len(measures) > 1:
            q = {w.lower() for w in re.findall(r"[a-z0-9]+", question or "") if len(w) > 2}
            best_name = None
            best_score = -1.0
            for name in measures:
                name_tokens = {w.lower() for w in re.findall(r"[a-z0-9]+", str(name)) if len(w) > 2}
                score = len(q & name_tokens)
                if score > best_score:
                    best_score = score
                    best_name = name
            if best_name:
                entry = measures[best_name]
                return f"{best_name} is {format_value(entry['total'])}."
        for name, entry in measures.items():
            return f"{name} is {format_value(entry['total'])}."
    for name, entry in stats.get("measures", {}).items():
        sentence = f"{name} totals {format_value(entry['total'])} across {rows} rows (average {format_value(entry['average'])})."
        if "top" in entry:
            sentence += f" Highest is {entry['top']['label']} at {format_value(entry['top']['value'])}"
            if "top_share_pct" in entry:
                sentence += f" ({entry['top_share_pct']:.2f}% of the total)"
            sentence += f"; lowest is {entry['bottom']['label']} at {format_value(entry['bottom']['value'])}."
        if "change_pct" in entry:
            sentence += f" From {entry['first']['label'][:10]} to {entry['last']['label'][:10]} it changed by {entry['change_pct']:+.2f}%."
        parts.append(sentence)
    if not parts:
        parts.append(f"The query returned {rows} rows.")
    return " ".join(parts[:3])
