"""Prefer IMO_MASTER_LIST (vessel dimension) for vessel attribute bindings when present."""

from __future__ import annotations

import re
from typing import Any

from .metadata import SemanticModel, Table

_NORM = re.compile(r"[^a-z0-9]+")

VESSEL_ATTR_CONCEPTS = frozenset(
    {
        "vessel_identifier",
        "vessel_type",
        "vessel_subtype",
        "owner_company",
        "manager_company",
        "vessel_name",
        "vessel_handover_date",
        "vessel_takeover_date",
        "vessel_deadweight",
    }
)

DEFAULT_MASTER_TABLES = ("IMO_MASTER_LIST", "IMO Master List", "VESSEL_MASTER", "Dim_Vessel")


def _norm_key(text: str) -> str:
    return _NORM.sub("", (text or "").lower())


def vessel_dimension_config(rules: dict[str, Any]) -> dict[str, Any]:
    return dict(rules.get("vessel_dimension_table") or {})


def vessel_master_table(model: SemanticModel, rules: dict[str, Any] | None = None) -> str | None:
    cfg = vessel_dimension_config(rules or {})
    names = tuple(cfg.get("table_names") or DEFAULT_MASTER_TABLES)
    allowed = {_norm_key(n) for n in names}
    for table in model.tables:
        if table.hidden:
            continue
        if _norm_key(table.name) in allowed:
            return table.name
    return None


def question_touches_vessel_attrs(question: str, concepts: set[str]) -> bool:
    if concepts & VESSEL_ATTR_CONCEPTS:
        return True
    q = (question or "").lower()
    return any(
        token in q
        for token in (
            "vessel",
            "ship",
            "imo",
            " doc",
            "doc ",
            "manager group",
            "handover",
            "takeover",
            "take over",
            "hand over",
        )
    )


def priority_master_columns(cfg: dict[str, Any]) -> list[str]:
    return list(cfg.get("priority_columns") or [])


def master_columns_for_slice(table: Table, cfg: dict[str, Any]) -> list[str]:
    wanted = priority_master_columns(cfg)
    if wanted:
        names = {c.name for c in table.columns if not c.hidden}
        return [c for c in wanted if c in names]
    return [c.name for c in table.columns if not c.hidden]