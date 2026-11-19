"""Fetch consolidated portal/report metadata from SemantIQ before catalog ranking."""

from __future__ import annotations

import logging
from typing import Any

from smart_common.logging import log

from .debug_trace import debug_log

logger = logging.getLogger(__name__)
SEMANTIQ = "pbi_semantiq_agent"


async def fetch_catalog_metadata_hints(agents: Any, question: str, *, limit: int = 15) -> list[dict[str, Any]]:
    if not agents or not (question or "").strip():
        return []
    try:
        out = await agents.call(SEMANTIQ, "search_catalog_metadata", {"query": question, "limit": max(1, min(limit, 30))})
    except Exception as exc:  # noqa: BLE001
        log(logger, logging.INFO, "metadata_hints_failed", error=type(exc).__name__)
        debug_log(hypothesis_id="D", location="metadata_retrieval.py:fetch", message="search_catalog_metadata failed", data={"error": type(exc).__name__})
        return []
    matches: list[dict[str, Any]] = []
    if isinstance(out, dict) and out.get("status") == "ok":
        matches = list(out.get("matches") or [])
    else:
        debug_log(hypothesis_id="D", location="metadata_retrieval.py:fetch", message="non-ok status", data={"status": out.get("status") if isinstance(out, dict) else None})

    if not matches:
        try:
            from pbi_semantiq_agent.catalog_disk import get_catalog_store

            matches = get_catalog_store().search(question, limit=limit)
            debug_log(
                hypothesis_id="A",
                location="metadata_retrieval.py:fetch",
                message="local catalog_disk fallback",
                data={"count": len(matches)},
                run_id="post-fix",
            )
        except Exception as exc:  # noqa: BLE001
            debug_log(hypothesis_id="D", location="metadata_retrieval.py:fetch", message="local fallback failed", data={"error": type(exc).__name__})
            return []
    debug_log(
        hypothesis_id="A",
        location="metadata_retrieval.py:fetch",
        message="metadata hints",
        data={"count": len(matches), "top": [str(m.get("title") or m.get("report_name") or "")[:60] for m in matches[:5]]},
    )
    return matches


def metadata_match_keys(hits: list[dict[str, Any]]) -> dict[str, float]:
    """Keys for boosting pool items: report_id, dataset_id, normalized title overlap."""
    scores: dict[str, float] = {}
    for i, row in enumerate(hits):
        weight = max(0.25, 1.0 - i * 0.05)
        for key_name in ("report_id", "dataset_id", "portal_id"):
            value = str(row.get(key_name) or "").strip().lower()
            if value:
                scores[f"{key_name}:{value}"] = max(scores.get(f"{key_name}:{value}", 0.0), weight * float(row.get("score") or 1.0))
        title = str(row.get("title") or row.get("report_name") or "").strip().lower()
        if title:
            scores[f"title:{title}"] = max(scores.get(f"title:{title}", 0.0), weight)
    return scores
