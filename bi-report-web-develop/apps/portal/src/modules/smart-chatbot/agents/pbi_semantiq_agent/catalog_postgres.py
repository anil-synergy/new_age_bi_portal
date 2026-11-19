"""Read portal menu reports from PostgreSQL (same tables as the Next.js catalog)."""

from __future__ import annotations

import os
import re
from typing import Any


def _parse_npgsql(connection_string: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in connection_string.split(";"):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip().lower()] = v.strip()
    return out


def postgres_dsn() -> str | None:
    direct = os.environ.get("BI_REPORT_DB_CONNECTION", "").strip()
    if direct:
        m = _parse_npgsql(direct)
        host = m.get("host") or os.environ.get("BI_REPORT_DB_HOST", "")
        port = m.get("port") or os.environ.get("BI_REPORT_DB_PORT", "5432")
        db = m.get("database") or os.environ.get("BI_REPORT_DB_NAME", "")
        user = m.get("username") or m.get("user") or os.environ.get("BI_REPORT_DB_USER", "")
        password = m.get("password") or os.environ.get("BI_REPORT_DB_PASSWORD", "")
        if host and db and user:
            return f"host={host} port={port} dbname={db} user={user} password={password} sslmode=require"
    host = os.environ.get("BI_REPORT_DB_HOST", "").strip()
    if not host:
        return None
    port = os.environ.get("BI_REPORT_DB_PORT", "5432").strip()
    db = os.environ.get("BI_REPORT_DB_NAME", "synergy_bi_reports").strip()
    user = os.environ.get("BI_REPORT_DB_USER", "").strip()
    password = os.environ.get("BI_REPORT_DB_PASSWORD", "").strip()
    if not user:
        return None
    return f"host={host} port={port} dbname={db} user={user} password={password} sslmode=require"


def _has_hierarchy(cur) -> bool:
    cur.execute(
        """
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'bi_report_categories'
          AND column_name IN ('parent_id', 'display_order')
        """
    )
    row = cur.fetchone()
    return row and int(row[0]) == 2


def _category_paths(cur, hierarchy: bool) -> dict[str, str]:
    cur.execute("SELECT id::text, name, parent_id::text FROM bi_report_categories WHERE is_active = true")
    rows = cur.fetchall()
    by_id = {r[0]: {"name": r[1] or "", "parent": r[2]} for r in rows}
    cache: dict[str, str] = {}

    def path_for(cid: str) -> str:
        if cid in cache:
            return cache[cid]
        parts: list[str] = []
        seen: set[str] = set()
        current: str | None = cid
        while current and current in by_id and current not in seen:
            seen.add(current)
            parts.append(by_id[current]["name"])
            current = by_id[current]["parent"] if hierarchy else None
        cache[cid] = " > ".join(reversed(parts)) if parts else ""
        return cache[cid]

    return {cid: path_for(cid) for cid in by_id}


def fetch_portal_reports() -> list[dict[str, Any]]:
    dsn = postgres_dsn()
    if not dsn:
        raise RuntimeError("Set BI_REPORT_DB_HOST (and user/password) or BI_REPORT_DB_CONNECTION for catalog export.")

    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError("pip install 'psycopg[binary]' to build pbi_semantic_metadata from PostgreSQL.") from exc

    with psycopg.connect(dsn, connect_timeout=20) as conn:
        with conn.cursor() as cur:
            hierarchy = _has_hierarchy(cur)
            paths = _category_paths(cur, hierarchy)
            cur.execute(
                """
                SELECT br.id::text,
                       br.name,
                       br.description,
                       br.powerbi_report_id::text,
                       br.powerbi_workspace_id::text,
                       br.report_category::text
                FROM bi_report br
                WHERE br.is_active = true
                  AND br.powerbi_report_id IS NOT NULL
                  AND br.powerbi_workspace_id IS NOT NULL
                """
            )
            out: list[dict[str, Any]] = []
            for row in cur.fetchall():
                portal_id, title, description, report_id, workspace_id, cat_id = row
                menu_path = paths.get(cat_id, "") if cat_id else ""
                if not re.match(r"^[0-9a-f-]{36}$", (report_id or "").lower()):
                    continue
                if not re.match(r"^[0-9a-f-]{36}$", (workspace_id or "").lower()):
                    continue
                out.append(
                    {
                        "portal_id": portal_id,
                        "title": title or "",
                        "description": description or "",
                        "menu_path": menu_path,
                        "report_id": report_id,
                        "workspace_id": workspace_id,
                    }
                )
            return out
