"""Fetch the portal menu catalogue from the Next route ``GET /api/smart/catalog``.

Service-to-service only: a short-lived HS256 JWT (issuer ``smart-sync``, audience
``bi-portal-catalog``) signed with the shared secret. The secret is read from settings or
environment and is never logged.
"""

from __future__ import annotations

import logging
import os
import re
import time
from typing import Any

import httpx
import jwt

from smart_common.logging import log

from .settings import get_settings

logger = logging.getLogger(__name__)

CATALOG_ISSUER = "smart-sync"
CATALOG_AUDIENCE = "bi-portal-catalog"
_TOKEN_TTL_S = 120
_GUID = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")


def _secret() -> str | None:
    s = get_settings()
    if s.portal_catalog_secret:
        return s.portal_catalog_secret.get_secret_value()
    return (os.environ.get("SMART_ORCHESTRATOR_SECRET") or os.environ.get("PORTAL_JWT_SECRET") or "").strip() or None


def catalog_url() -> str | None:
    base = (get_settings().portal_catalog_url or os.environ.get("PORTAL_CATALOG_URL") or "").strip().rstrip("/")
    if not base:
        return None
    return base if base.endswith("/api/smart/catalog") else f"{base}/api/smart/catalog"


def _token(secret: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": CATALOG_ISSUER, "aud": CATALOG_AUDIENCE, "sub": "smart-sync", "iat": now, "exp": now + _TOKEN_TTL_S},
        secret,
        algorithm="HS256",
    )


def _norm_row(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Map the API item to the rows ``sync_portal_catalog`` expects; drop unusable ones."""
    if raw.get("smart_in_scope") is False:
        return None
    if str(raw.get("application_type") or "").strip().lower() == "fabric-rayfin":
        return None
    report_id = str(raw.get("report_id") or "").strip()
    workspace_id = str(raw.get("workspace_id") or "").strip()
    portal_id = str(raw.get("portal_id") or "").strip()
    if not portal_id or not _GUID.match(report_id) or not _GUID.match(workspace_id):
        return None
    row: dict[str, Any] = {
        "portal_id": portal_id,
        "title": str(raw.get("title") or "").strip(),
        "description": raw.get("description") or "",
        "menu_path": str(raw.get("menu_path") or raw.get("category_name") or "").strip(),
        "report_id": report_id,
        "workspace_id": workspace_id,
    }
    dataset_id = str(raw.get("dataset_id") or "").strip()
    if _GUID.match(dataset_id):
        row["portal_dataset_hint"] = dataset_id
    return row


async def fetch_portal_catalog_via_api() -> list[dict[str, Any]]:
    """Return normalised portal rows, or raise ``RuntimeError`` (caller falls back to Postgres)."""
    url, secret = catalog_url(), _secret()
    if not url or not secret:
        raise RuntimeError("portal catalogue API not configured (PORTAL_CATALOG_URL / shared secret)")
    timeout = get_settings().portal_catalog_timeout_s
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {_token(secret)}"})
    except httpx.HTTPError as exc:
        raise RuntimeError(f"portal catalogue API unreachable: {type(exc).__name__}") from exc
    if resp.status_code != 200:
        raise RuntimeError(f"portal catalogue API returned HTTP {resp.status_code}")
    try:
        payload = resp.json()
    except ValueError as exc:
        raise RuntimeError("portal catalogue API returned invalid JSON") from exc
    items = payload.get("reports") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise RuntimeError("portal catalogue API response missing 'reports'")
    rows = [r for r in (_norm_row(i) for i in items if isinstance(i, dict)) if r]
    log(logger, logging.INFO, "portal_catalog_fetched", received=len(items), usable=len(rows))
    return rows
