"""BM25 + vector index over catalog documents (reports and semantic models).

One document per catalog item. ``sync`` compares content digests, so BM25, the local vector
store and Pinecone receive exactly the same adds, changes and removals. Local structures are
updated before ``sync`` returns; Pinecone is updated in the background and is queried only
when every eligible document is confirmed there with the current digest. Otherwise the
local store answers, so a lagging or unreachable Pinecone can never return stale results.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from smart_common.logging import log

from .bm25 import BM25Index
from .embeddings import Embedder, EmbeddingUnavailable
from .vector_store import LocalVectorStore, VectorStore, VectorStoreError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IndexDoc:
    id: str
    text: str
    tokens: tuple[str, ...]
    metadata: dict[str, Any] = field(hash=False, compare=False)
    digest: str = ""


@dataclass
class SearchHits:
    vector: dict[str, float]
    bm25: dict[str, float]
    vector_store: str
    ms: float


class HybridIndex:
    def __init__(self, embedder: Embedder, remote: VectorStore | None = None, *, prune_after_s: float = 86400.0, remote_timeout_s: float = 5.0):
        self.embedder = embedder
        self.remote = remote
        self.prune_after_s = prune_after_s
        self.remote_timeout_s = remote_timeout_s
        self._docs: dict[str, IndexDoc] = {}
        self._seen: dict[str, float] = {}
        self._bm25 = BM25Index()
        self._local = LocalVectorStore()
        self._remote_digest: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._background: set[asyncio.Task] = set()

    def __len__(self) -> int:
        return len(self._docs)

    def digest_of(self, doc_id: str) -> str | None:
        doc = self._docs.get(doc_id)
        return doc.digest if doc else None

    async def sync(self, docs: list[IndexDoc]) -> list[str]:
        """Add or replace changed documents; returns ids that changed."""
        now = time.monotonic()
        async with self._lock:
            for doc in docs:
                self._seen[doc.id] = now
            changed = [doc for doc in docs if (self._docs.get(doc.id) is None or self._docs[doc.id].digest != doc.digest)]
            if changed:
                try:
                    vectors: list[list[float]] | None = await self.embedder.embed([doc.text for doc in changed])
                except EmbeddingUnavailable:
                    vectors = None
                for i, doc in enumerate(changed):
                    self._bm25.upsert(doc.id, doc.tokens)
                    if vectors is not None:
                        self._docs[doc.id] = doc
                        await self._local.upsert([(doc.id, vectors[i], doc.metadata)])
                    else:
                        # Stored without a digest so the next sync embeds it again.
                        self._docs[doc.id] = IndexDoc(doc.id, doc.text, doc.tokens, doc.metadata, "")
                        await self._local.delete([doc.id])
                if vectors is not None and self.remote is not None:
                    self._spawn(self._remote_upsert([(d, v) for d, v in zip(changed, vectors)]))
            stale = [doc_id for doc_id, seen in self._seen.items() if now - seen > self.prune_after_s]
            if stale:
                for doc_id in stale:
                    self._seen.pop(doc_id, None)
                    self._docs.pop(doc_id, None)
                    self._bm25.remove(doc_id)
                    self._remote_digest.pop(doc_id, None)
                await self._local.delete(stale)
                if self.remote is not None:
                    self._spawn(self._remote_delete(stale))
            return [doc.id for doc in changed]

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def _remote_upsert(self, pairs: list[tuple[IndexDoc, list[float]]]) -> None:
        assert self.remote is not None
        try:
            await self.remote.upsert([(doc.id, vector, doc.metadata) for doc, vector in pairs])
        except (VectorStoreError, Exception) as exc:  # noqa: BLE001 - background sync must never crash the loop
            log(logger, logging.WARNING, "vector_sync_failed", store=self.remote.name, docs=len(pairs), error=type(exc).__name__)
            for doc, _ in pairs:
                self._remote_digest.pop(doc.id, None)
            return
        for doc, _ in pairs:
            current = self._docs.get(doc.id)
            if current is not None and current.digest == doc.digest:
                self._remote_digest[doc.id] = doc.digest
        log(logger, logging.INFO, "vector_sync_done", store=self.remote.name, docs=len(pairs))

    async def _remote_delete(self, ids: list[str]) -> None:
        assert self.remote is not None
        try:
            await self.remote.delete(ids)
        except Exception as exc:  # noqa: BLE001
            log(logger, logging.WARNING, "vector_delete_failed", store=self.remote.name, docs=len(ids), error=type(exc).__name__)

    def _remote_ready(self, ids: set[str]) -> bool:
        if self.remote is None or not ids:
            return False
        return all(self._remote_digest.get(i) == self._docs[i].digest for i in ids if i in self._docs)

    async def search(self, query_text: str, query_tokens: list[str], *, ids: set[str], environments: list[str], top_k: int) -> SearchHits:
        """Scores only for ``ids`` (already filtered by environment and permission)."""
        started = time.perf_counter()
        bm25 = self._bm25.search(query_tokens, allowed=ids) if ids else {}
        vector: dict[str, float] = {}
        store = "none"
        if ids:
            try:
                query_vector = (await self.embedder.embed([query_text]))[0]
            except EmbeddingUnavailable:
                query_vector = None
            if query_vector is not None:
                if self._remote_ready(ids):
                    try:
                        async with asyncio.timeout(self.remote_timeout_s):
                            vector = await self.remote.query(query_vector, top_k=top_k, environments=environments, ids=ids)  # type: ignore[union-attr]
                        store = self.remote.name  # type: ignore[union-attr]
                    except (VectorStoreError, TimeoutError) as exc:
                        log(logger, logging.WARNING, "vector_query_fallback", store=self.remote.name, error=type(exc).__name__)  # type: ignore[union-attr]
                        vector = {}
                if store == "none":
                    vector = await self._local.query(query_vector, top_k=top_k, environments=environments, ids=ids)
                    store = self._local.name
        return SearchHits(vector=vector, bm25=bm25, vector_store=store, ms=round((time.perf_counter() - started) * 1000, 1))

    async def drain(self) -> None:
        """Wait for background vector-store sync (tests and shutdown)."""
        while self._background:
            await asyncio.gather(*list(self._background), return_exceptions=True)

    async def aclose(self) -> None:
        for task in list(self._background):
            task.cancel()
        await asyncio.gather(*list(self._background), return_exceptions=True)
        closer = getattr(self.remote, "aclose", None)
        if closer:
            await closer()
