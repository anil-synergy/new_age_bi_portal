"""Semantic answer cache with security scoping.

An entry is reused only when ALL of these hold:
- same semantic model (workspace|dataset) and the model is in this request's authorized set;
- same security scope: "user:<email>" unless the model is explicitly known to have no
  row-level security (Power BI reports isEffectiveIdentityRequired and
  isEffectiveIdentityRolesRequired both False) and the portal catalog loaded;
- same query signature (resolved dates, numbers, grouping, filter words, visual type);
- the normalized question embedding is within ``semantic_cache_similarity``;
- the data has not been refreshed since (refresh marker from SemantIQ), and the TTL has not
  expired. Unknown freshness gets a short TTL. Model metadata changes drop the model's entries.
Anything uncertain is a miss. Only answers that passed the confidence gate are stored.
"""

from __future__ import annotations

import asyncio
import copy
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from smart_common.logging import log

from .embeddings import Embedder, EmbeddingUnavailable, cosine

logger = logging.getLogger(__name__)


@dataclass
class CacheEntry:
    scope: str
    dataset_key: str
    signature: str
    vector: list[float]
    question: str
    response: dict[str, Any]
    semantiq: dict[str, Any]
    freshness: str | None
    created: float
    expires: float
    metadata_digest: str = ""
    hits: int = 0


@dataclass
class CacheLookup:
    entry: CacheEntry | None
    reason: str
    similarity: float = 0.0
    ms: float = 0.0


def security_scope(user_email: str, item: dict[str, Any] | None, *, catalog_unavailable: bool) -> str:
    item = item or {}
    no_rls = item.get("rls_required") is False and item.get("rls_roles_required") is False
    if no_rls and not catalog_unavailable:
        return "shared"
    return f"user:{user_email.strip().lower()}"


class SemanticCache:
    def __init__(self, embedder: Embedder, *, enabled: bool, ttl_s: float, unknown_ttl_s: float, similarity: float, max_entries: int):
        self.embedder = embedder
        self.enabled = enabled
        self.ttl_s = ttl_s
        self.unknown_ttl_s = unknown_ttl_s
        self.similarity = similarity
        self.max_entries = max_entries
        self._entries: OrderedDict[int, CacheEntry] = OrderedDict()
        self._next = 0
        self._freshness: dict[str, str | None] = {}
        self._inflight: dict[str, asyncio.Future] = {}

    def __len__(self) -> int:
        return len(self._entries)

    async def _vector(self, text: str) -> list[float] | None:
        try:
            return (await self.embedder.embed([text]))[0]
        except EmbeddingUnavailable:
            return None

    def note_freshness(self, dataset_key: str, marker: str | None) -> None:
        """Drop the model's entries when its refresh marker changes."""
        if marker is None:
            return
        previous = self._freshness.get(dataset_key)
        self._freshness[dataset_key] = marker
        if previous is not None and previous != marker:
            self.invalidate(dataset_key, reason="data_refreshed")

    def invalidate(self, dataset_key: str, *, reason: str) -> int:
        doomed = [k for k, e in self._entries.items() if e.dataset_key == dataset_key]
        for k in doomed:
            self._entries.pop(k, None)
        if doomed:
            log(logger, logging.INFO, "semantic_cache_invalidated", dataset=dataset_key, entries=len(doomed), reason=reason)
        return len(doomed)

    async def lookup(
        self,
        *,
        scope: str,
        dataset_key: str,
        authorized_keys: set[str],
        signature: str,
        text: str,
        freshness: str | None,
        metadata_digest: str = "",
    ) -> CacheLookup:
        started = time.perf_counter()
        if not self.enabled:
            return CacheLookup(None, "disabled")
        if dataset_key not in authorized_keys:
            return CacheLookup(None, "not_authorized")
        self.note_freshness(dataset_key, freshness)
        now = time.monotonic()
        for k in [k for k, e in self._entries.items() if e.expires <= now]:
            self._entries.pop(k, None)
        pool = [e for e in self._entries.values() if e.scope == scope and e.dataset_key == dataset_key and e.signature == signature]
        if not pool:
            return CacheLookup(None, "miss", ms=_ms(started))
        vector = await self._vector(text)
        if vector is None:
            return CacheLookup(None, "no_embedding", ms=_ms(started))
        best: tuple[float, CacheEntry] | None = None
        for entry in pool:
            if entry.freshness != freshness:
                continue
            if metadata_digest and entry.metadata_digest and entry.metadata_digest != metadata_digest:
                continue
            sim = cosine(vector, entry.vector)
            if best is None or sim > best[0]:
                best = (sim, entry)
        if best is None or best[0] < self.similarity:
            return CacheLookup(None, "miss", best[0] if best else 0.0, _ms(started))
        best[1].hits += 1
        return CacheLookup(best[1], "hit", best[0], _ms(started))

    async def store(
        self,
        *,
        scope: str,
        dataset_key: str,
        signature: str,
        text: str,
        question: str,
        response: dict[str, Any],
        semantiq: dict[str, Any],
        freshness: str | None,
        metadata_digest: str = "",
    ) -> bool:
        if not self.enabled:
            return False
        vector = await self._vector(text)
        if vector is None:
            return False
        now = time.monotonic()
        ttl = self.ttl_s if freshness is not None else self.unknown_ttl_s
        entry = CacheEntry(
            scope, dataset_key, signature, vector, question, copy.deepcopy(response), copy.deepcopy(semantiq), freshness, now, now + ttl, metadata_digest
        )
        self._next += 1
        self._entries[self._next] = entry
        while len(self._entries) > self.max_entries:
            self._entries.popitem(last=False)
        return True

    async def single_flight(self, key: str, factory: Callable[[], Awaitable[Any]]) -> Any:
        """Concurrent identical requests in the same security scope share one execution."""
        existing = self._inflight.get(key)
        if existing is not None:
            return copy.deepcopy(await asyncio.shield(existing))
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._inflight[key] = future
        try:
            result = await factory()
        except BaseException as exc:
            if not future.done():
                future.set_exception(exc)
                future.exception()
            raise
        finally:
            self._inflight.pop(key, None)
        if not future.done():
            future.set_result(result)
        return result


def _ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 1)
