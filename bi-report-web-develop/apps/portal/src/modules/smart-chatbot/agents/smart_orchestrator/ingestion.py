"""Turn catalog items and semantic-model metadata into index documents.

Each document carries its environment (PROD / DEV / ARCHIVE) as metadata, assigned at
ingestion from the report, model and workspace names, so retrieval filters on a stored
field rather than re-deriving it from scores.

Model metadata (table, column and measure names and descriptions, plus glossary synonyms)
is fetched in the background through SemantIQ's get_model_schema, a bounded number of models
at a time, and refreshed after ``index_metadata_ttl_s``.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Any, Callable

from smart_common.logging import log

from .environment import Classification, EnvironmentPolicy, PROD
from .hybrid_index import IndexDoc
from .query_norm import Glossary, content_tokens

logger = logging.getLogger(__name__)

SEMANTIQ = "pbi_semantiq_agent"
_SCHEMA_TOKENS = 600


def item_key(item: dict[str, Any]) -> str:
    """One key per semantic model; a report without a resolved model is keyed by report."""
    workspace_id = str(item.get("workspace_id") or "").lower()
    if item.get("dataset_id"):
        return f"{workspace_id}|{str(item['dataset_id']).lower()}"
    if item.get("report_id"):
        return f"{workspace_id}|report:{str(item['report_id']).lower()}"
    return ""


def doc_id(item: dict[str, Any]) -> str:
    source = str(item.get("source") or "workspace")
    ident = item.get("portal_id") or item.get("report_id") or item.get("dataset_id") or ""
    return f"{source}:{item_key(item)}:{str(ident).lower()}"


def _portal_catalog_text(item: dict[str, Any]) -> str:
    try:
        from pbi_semantiq_agent.catalog_disk import get_catalog_store

        return get_catalog_store().enrichment_for_item(item)
    except Exception:  # noqa: BLE001
        return ""


def build_doc(item: dict[str, Any], env: Classification, glossary: Glossary, schema_text: str = "") -> IndexDoc:
    title = str(item.get("title") or "")
    menu = str(item.get("menu_path") or item.get("category_name") or "")
    workspace = str(item.get("workspace_name") or "")
    description = str(item.get("description") or "")
    catalog_text = _portal_catalog_text(item)
    expansion = glossary.expansion_text(" ".join([title, menu, description, schema_text[:2000], catalog_text[:2000]]))
    text = ". ".join(part for part in [title, menu, workspace, description, expansion, catalog_text, schema_text] if part)
    tokens = (
        content_tokens(title, drop_time=False) * 3
        + content_tokens(menu, drop_time=False) * 2
        + content_tokens(description, drop_time=False)
        + content_tokens(expansion, drop_time=False)
        + content_tokens(schema_text, drop_time=False)[:_SCHEMA_TOKENS]
        + content_tokens(catalog_text, drop_time=False)[:_SCHEMA_TOKENS]
    )
    metadata = {
        "doc_id": doc_id(item),
        "environment": env.environment,
        "env_markers": list(env.markers),
        "item_key": item_key(item),
        "workspace_id": item.get("workspace_id"),
        "dataset_id": item.get("dataset_id"),
        "report_id": item.get("report_id"),
        "title": title,
        "source": item.get("source") or "workspace",
        "glossary_version": glossary.version,
    }
    digest = hashlib.blake2b(f"{text}|{env.environment}|{glossary.version}".encode("utf-8"), digest_size=12).hexdigest()
    return IndexDoc(doc_id(item), text, tuple(tokens), metadata, digest)


def schema_text(schema: dict[str, Any]) -> str:
    parts: list[str] = []
    for table in schema.get("tables") or []:
        if not isinstance(table, dict):
            continue
        parts.append(str(table.get("name") or ""))
        if table.get("description"):
            parts.append(str(table["description"]))
        for measure in table.get("measures") or []:
            parts.append(str(measure.get("name") or ""))
            if measure.get("description"):
                parts.append(str(measure["description"]))
        for column in table.get("columns") or []:
            parts.append(str(column.get("name") or ""))
    return " ".join(p for p in parts if p)


class ModelMetadataIndexer:
    """Background cache of schema text per semantic model. Metadata only, never row data."""

    def __init__(self, agents, *, enabled: bool, concurrency: int, max_models: int, ttl_s: float, timeout_s: float = 30.0):
        self.agents = agents
        self.enabled = enabled
        self.max_models = max_models
        self.ttl_s = ttl_s
        self.timeout_s = timeout_s
        self._semaphore = asyncio.Semaphore(max(1, concurrency))
        self._texts: dict[str, tuple[str, str, float]] = {}
        self._task: asyncio.Task | None = None

    def text_for(self, key: str) -> str:
        found = self._texts.get(key)
        return found[0] if found else ""

    def schedule(self, items: list[dict[str, Any]], policy: EnvironmentPolicy, on_change: Callable[[str], None]) -> None:
        if not self.enabled or (self._task is not None and not self._task.done()):
            return
        now = time.monotonic()
        todo: list[dict[str, Any]] = []
        seen: set[str] = set()
        ordered = sorted(items, key=lambda i: 0 if policy.classify_item(i).environment == PROD else 1)
        for item in ordered:
            key = item_key(item)
            if not key or "|report:" in key or key in seen:
                continue
            seen.add(key)
            cached = self._texts.get(key)
            if cached and now - cached[2] < self.ttl_s:
                continue
            todo.append(item)
            if self.max_models > 0 and len(todo) >= self.max_models:
                break
        if todo:
            self._task = asyncio.create_task(self._run(todo, on_change))

    async def _one(self, item: dict[str, Any], on_change: Callable[[str], None]) -> bool:
        key = item_key(item)
        async with self._semaphore:
            try:
                async with asyncio.timeout(self.timeout_s):
                    out = await self.agents.call(SEMANTIQ, "get_model_schema", {"workspace_id": item["workspace_id"], "dataset_id": item["dataset_id"]})
            except Exception as exc:  # noqa: BLE001 - one unreadable model must not stop the job
                log(logger, logging.INFO, "model_metadata_skipped", key=key, error=type(exc).__name__)
                return False
        if not isinstance(out, dict) or out.get("status") != "ok":
            return False
        text = schema_text(out.get("schema") or {})
        digest = hashlib.blake2b(text.encode("utf-8"), digest_size=12).hexdigest()
        previous = self._texts.get(key)
        self._texts[key] = (text, digest, time.monotonic())
        if previous and previous[1] != digest:
            on_change(key)
        return True

    async def _run(self, items: list[dict[str, Any]], on_change: Callable[[str], None]) -> None:
        started = time.perf_counter()
        results = await asyncio.gather(*(self._one(item, on_change) for item in items), return_exceptions=True)
        log(
            logger,
            logging.INFO,
            "model_metadata_indexed",
            models=len(items),
            ok=sum(1 for r in results if r is True),
            ms=round((time.perf_counter() - started) * 1000),
        )

    async def aclose(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
