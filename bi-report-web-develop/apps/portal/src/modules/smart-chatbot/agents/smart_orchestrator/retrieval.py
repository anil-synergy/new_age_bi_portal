"""Merge the portal menu and a Power BI workspace inventory into one candidate pool.

The menu catalog is whatever the signed-in user is allowed to see. The workspace
inventory is what the service principal can list. When the catalog loaded, workspace
models outside the menu are kept only when they are production models (row-level security
still runs as the user); draft, test and archived workspace models must also be on the
user's menu. When the catalog API is down, the inventory is used as-is.

Ranking and the PROD/DEV/ARCHIVE hard filter live in ranking.py.
"""

from __future__ import annotations

import time
from typing import Any

from .environment import PROD, EnvironmentPolicy


class InventoryCache:
    """Short-lived cache of workspace report and model names. Not a permission cache."""

    def __init__(self, ttl_s: float = 300.0):
        self.ttl_s = ttl_s
        self._stored_at = 0.0
        self._items: list[dict[str, Any]] | None = None

    def get(self) -> list[dict[str, Any]] | None:
        if self._items is None or (time.monotonic() - self._stored_at) > self.ttl_s:
            return None
        return self._items

    def put(self, items: list[dict[str, Any]]) -> None:
        self._items = items
        self._stored_at = time.monotonic()


def authorize_workspace_items(
    items: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    *,
    catalog_unavailable: bool,
) -> list[dict[str, Any]]:
    """Drop workspace models the signed-in user is not allowed to reach via the menu.

    A failed catalog cannot be used as an allow-list, so the Power BI list is kept
    and query execution still impersonates the user.
    """
    if catalog_unavailable:
        return items
    allowed_reports = {str(item.get("report_id")).lower() for item in catalog if item.get("report_id")}
    allowed_datasets = {str(item.get("dataset_id")).lower() for item in catalog if item.get("dataset_id")}
    for item in items:
        report_id = str(item.get("report_id") or "").lower()
        dataset_id = str(item.get("dataset_id") or "").lower()
        if report_id and report_id in allowed_reports and dataset_id:
            allowed_datasets.add(dataset_id)
    kept: list[dict[str, Any]] = []
    for item in items:
        report_id = str(item.get("report_id") or "").lower()
        dataset_id = str(item.get("dataset_id") or "").lower()
        if dataset_id and dataset_id in allowed_datasets:
            kept.append(item)
        elif report_id and report_id in allowed_reports:
            kept.append(item)
    return kept


def pool_for_user(
    inventory: list[dict[str, Any]],
    allowed: list[dict[str, Any]],
    policy: EnvironmentPolicy,
    *,
    catalog_unavailable: bool,
) -> list[dict[str, Any]]:
    if catalog_unavailable:
        return list(inventory)
    allowed_ids = {id(item) for item in allowed}
    return [item for item in inventory if id(item) in allowed_ids or policy.classify_item(item).environment == PROD]


def enrich_menu_items(catalog: list[dict[str, Any]], inventory: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Menu entries with the model id, workspace name and RLS flags known from the inventory."""
    by_report: dict[str, dict[str, Any]] = {}
    workspace_names: dict[str, str] = {}
    flags: dict[str, dict[str, Any]] = {}
    for item in inventory:
        if item.get("report_id") and item.get("dataset_id"):
            by_report[str(item["report_id"]).lower()] = item
        if item.get("workspace_id") and item.get("workspace_name"):
            workspace_names[str(item["workspace_id"]).lower()] = str(item["workspace_name"])
        if item.get("dataset_id") and "rls_required" in item:
            flags[str(item["dataset_id"]).lower()] = {k: item.get(k) for k in ("rls_required", "rls_roles_required")}
    out: list[dict[str, Any]] = []
    for entry in catalog:
        if not entry.get("workspace_id") or not (entry.get("dataset_id") or entry.get("report_id")):
            continue
        item = {**entry, "source": "portal"}
        known = by_report.get(str(item.get("report_id") or "").lower())
        if known and not item.get("dataset_id"):
            item["dataset_id"] = known["dataset_id"]
            item["workspace_id"] = known.get("workspace_id") or item["workspace_id"]
        name = workspace_names.get(str(entry.get("workspace_id")).lower())
        if name:
            item.setdefault("workspace_name", name)
        item.update(flags.get(str(item.get("dataset_id") or "").lower(), {}))
        out.append(item)
    return out
