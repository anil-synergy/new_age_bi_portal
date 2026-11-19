"""Qdrant vector store for the keyword index (measure and column synonyms -> model objects).

Uses Qdrant's REST API through httpx (no extra client package). One point per keyword:

    vector   embedding of the keyword text
    payload  keyword, measure_name, table_name, object_kind, dataset_id, workspace_id, report_ids, description

The store is written only by the offline indexer and read only by the router.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any, Protocol

import httpx


class KeywordStoreError(RuntimeError):
    """Store failure with a message that is safe to log (no keys, no payloads)."""


class KeywordStore(Protocol):
    async def ensure(self, dimensions: int) -> None: ...
    async def upsert(self, points: list[tuple[str, list[float], dict[str, Any]]]) -> None: ...
    async def delete_dataset(self, dataset_id: str) -> None: ...
    async def search(self, vector: list[float], *, top_k: int, dataset_id: str | None, threshold: float) -> list[dict[str, Any]]: ...
    async def value_points(self, dataset_id: str) -> list[dict[str, Any]]: ...


def point_id(key: str) -> str:
    """Stable UUID for a point, so re-indexing the same keyword overwrites it."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, key))


class QdrantKeywordStore:
    def __init__(self, *, url: str, api_key: str | None, collection: str, timeout_s: float = 10.0, transport: httpx.AsyncBaseTransport | None = None):
        headers = {"api-key": api_key} if api_key else {}
        self._base = url.rstrip("/")
        self._collection = collection
        self._client = httpx.AsyncClient(base_url=self._base, headers=headers, timeout=timeout_s, transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    def _check(self, resp: httpx.Response, action: str) -> dict[str, Any]:
        if resp.status_code >= 400:
            raise KeywordStoreError(f"Qdrant {action} failed with HTTP {resp.status_code}")
        return resp.json() if resp.content else {}

    async def ensure(self, dimensions: int) -> None:
        resp = await self._client.put(
            f"/collections/{self._collection}",
            json={"vectors": {"size": dimensions, "distance": "Cosine"}},
        )
        if resp.status_code != 409:  # 409 = already exists
            self._check(resp, "create collection")
        # Payload index on the filter field: Qdrant refuses filtered deletes and searches without it.
        idx = await self._client.put(
            f"/collections/{self._collection}/index",
            params={"wait": "true"},
            json={"field_name": "dataset_id", "field_schema": "keyword"},
        )
        self._check(idx, "create dataset_id index")

    async def upsert(self, points: list[tuple[str, list[float], dict[str, Any]]]) -> None:
        if not points:
            return
        body = {"points": [{"id": point_id(key), "vector": vec, "payload": payload} for key, vec, payload in points]}
        resp = await self._client.put(f"/collections/{self._collection}/points", params={"wait": "true"}, json=body)
        self._check(resp, "upsert")

    async def delete_dataset(self, dataset_id: str) -> None:
        body = {"filter": {"must": [{"key": "dataset_id", "match": {"value": dataset_id.lower()}}]}}
        resp = await self._client.post(f"/collections/{self._collection}/points/delete", params={"wait": "true"}, json=body)
        self._check(resp, "delete")

    async def search(self, vector: list[float], *, top_k: int, dataset_id: str | None, threshold: float) -> list[dict[str, Any]]:
        body: dict[str, Any] = {"vector": vector, "limit": top_k, "with_payload": True, "score_threshold": threshold}
        if dataset_id:
            body["filter"] = {"must": [{"key": "dataset_id", "match": {"value": dataset_id.lower()}}]}
        resp = await self._client.post(f"/collections/{self._collection}/points/search", json=body)
        data = self._check(resp, "search")
        return [{"score": float(p.get("score", 0.0)), **(p.get("payload") or {})} for p in data.get("result") or []]

    async def value_points(self, dataset_id: str) -> list[dict[str, Any]]:
        """Stored values of one dataset (for exact word matching, not similarity). Read-only scroll."""
        out: list[dict[str, Any]] = []
        offset = None
        while True:
            body: dict[str, Any] = {
                "filter": {"must": [{"key": "dataset_id", "match": {"value": dataset_id.lower()}}]},
                "limit": 500,
                "with_payload": True,
            }
            if offset is not None:
                body["offset"] = offset
            data = self._check(await self._client.post(f"/collections/{self._collection}/points/scroll", json=body), "scroll")
            result = data.get("result") or {}
            out.extend(p.get("payload") or {} for p in result.get("points") or [] if (p.get("payload") or {}).get("object_kind") == "value")
            offset = result.get("next_page_offset")
            if not offset:
                return out


class PgVectorKeywordStore:
    """Keyword vectors in PostgreSQL (pgvector, database bi_semantiq). Same interface as QdrantKeywordStore.

    Table: public.semantic_keyword_embeddings (created by scripts/migrate-semantic-keywords-pgvector.sql).
    Vectors are 384-dim cosine, matching the local fastembed model. One persistent connection guarded by a
    lock; psycopg calls run in a worker thread so the asyncio loop is never blocked.
    """

    def __init__(self, *, dsn: str, table: str = "semantic_keyword_embeddings", dimensions: int = 384):
        import threading

        self._dsn = dsn
        self._table = table
        self._dims = dimensions
        self._conn = None
        self._lock = threading.Lock()

    def _connect(self):
        import psycopg

        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._dsn, connect_timeout=15, autocommit=True)
        return self._conn

    def _run(self, fn):
        with self._lock:
            try:
                return fn(self._connect())
            except Exception as exc:  # noqa: BLE001 - reset the connection, surface a safe message
                self._conn = None
                raise KeywordStoreError(f"pgvector {type(exc).__name__}") from exc

    async def _call(self, fn):
        import asyncio

        return await asyncio.to_thread(self._run, fn)

    async def aclose(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    async def ensure(self, dimensions: int) -> None:
        if dimensions != self._dims:
            raise KeywordStoreError(f"pgvector table expects {self._dims} dims, got {dimensions}")

        def check(conn):
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM information_schema.tables WHERE table_name = %s",
                    (self._table,),
                )
                if cur.fetchone() is None:
                    raise KeywordStoreError("pgvector table missing: run scripts/migrate-semantic-keywords-pgvector.sql")

        await self._call(check)

    async def upsert(self, points: list[tuple[str, list[float], dict[str, Any]]]) -> None:
        if not points:
            return
        import json

        rows = []
        for key, vec, payload in points:
            rows.append(
                (
                    point_id(key),
                    str(payload.get("object_kind") or "unknown"),
                    str(payload.get("keyword") or ""),
                    payload.get("measure_name"),
                    payload.get("table_name"),
                    str(payload.get("dataset_id") or "").lower(),
                    payload.get("workspace_id"),
                    json.dumps(payload.get("report_ids") or []),
                    payload.get("description"),
                    json.dumps(payload, default=str),
                    "[" + ",".join(f"{x:.7g}" for x in vec) + "]",
                )
            )

        def write(conn):
            with conn.cursor() as cur:
                cur.executemany(
                    f"""INSERT INTO {self._table}
                        (id, object_kind, keyword, measure_name, table_name, dataset_id, workspace_id,
                         report_ids, description, payload, embedding)
                        VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s::vector)
                        ON CONFLICT (id) DO UPDATE SET object_kind = EXCLUDED.object_kind, keyword = EXCLUDED.keyword,
                          measure_name = EXCLUDED.measure_name, table_name = EXCLUDED.table_name,
                          dataset_id = EXCLUDED.dataset_id, workspace_id = EXCLUDED.workspace_id,
                          report_ids = EXCLUDED.report_ids, description = EXCLUDED.description,
                          payload = EXCLUDED.payload, embedding = EXCLUDED.embedding, updated_at = now()""",
                    rows,
                )

        await self._call(write)

    async def delete_dataset(self, dataset_id: str) -> None:
        def delete(conn):
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {self._table} WHERE dataset_id = %s", (dataset_id.lower(),))

        await self._call(delete)

    async def search(self, vector: list[float], *, top_k: int, dataset_id: str | None, threshold: float) -> list[dict[str, Any]]:
        import json

        literal = "[" + ",".join(f"{x:.7g}" for x in vector) + "]"
        sql = f"""SELECT payload, 1 - (embedding <=> %s::vector) AS score FROM {self._table}
                  WHERE (%s::text IS NULL OR dataset_id = %s)
                  ORDER BY embedding <=> %s::vector LIMIT %s"""
        ds = dataset_id.lower() if dataset_id else None
        params = (literal, ds, ds, literal, top_k)

        def query(conn):
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.fetchall()

        rows = await self._call(query)
        out: list[dict[str, Any]] = []
        for payload, score in rows:
            s = float(score)
            if s < threshold:
                continue
            body = payload if isinstance(payload, dict) else json.loads(payload or "{}")
            out.append({"score": s, **body})
        return out

    async def value_points(self, dataset_id: str) -> list[dict[str, Any]]:
        def values(conn):
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT payload FROM {self._table} WHERE dataset_id = %s AND object_kind = 'value'",
                    (dataset_id.lower(),),
                )
                return cur.fetchall()

        rows = await self._call(values)
        return [dict(p) if isinstance(p, dict) else {} for (p,) in rows]


class MemoryKeywordStore:
    """In-process store with the same interface (tests, and a dry run without Qdrant)."""

    def __init__(self) -> None:
        self.points: dict[str, tuple[list[float], dict[str, Any]]] = {}

    async def ensure(self, dimensions: int) -> None:
        return None

    async def upsert(self, points: list[tuple[str, list[float], dict[str, Any]]]) -> None:
        for key, vec, payload in points:
            self.points[point_id(key)] = (vec, {**payload, "dataset_id": str(payload.get("dataset_id", "")).lower()})

    async def delete_dataset(self, dataset_id: str) -> None:
        for pid in [k for k, (_, p) in self.points.items() if p.get("dataset_id") == dataset_id.lower()]:
            del self.points[pid]

    async def search(self, vector: list[float], *, top_k: int, dataset_id: str | None, threshold: float) -> list[dict[str, Any]]:
        from math import sqrt

        def cos(a: list[float], b: list[float]) -> float:
            na = sqrt(sum(x * x for x in a)) or 1.0
            nb = sqrt(sum(x * x for x in b)) or 1.0
            return sum(x * y for x, y in zip(a, b)) / (na * nb)

        hits = []
        for vec, payload in self.points.values():
            if dataset_id and payload.get("dataset_id") != dataset_id.lower():
                continue
            score = cos(vector, vec)
            if score >= threshold:
                hits.append({"score": score, **payload})
        return sorted(hits, key=lambda h: -h["score"])[:top_k]

    async def value_points(self, dataset_id: str) -> list[dict[str, Any]]:
        return [dict(p) for _, p in self.points.values() if p.get("dataset_id") == dataset_id.lower() and p.get("object_kind") == "value"]


def stable_key(*parts: str) -> str:
    return hashlib.blake2b("|".join(p.lower() for p in parts).encode("utf-8"), digest_size=16).hexdigest()


def build_keyword_store(settings: Any) -> KeywordStore | None:
    """The configured keyword vector store, or None when none is configured.

    KEYWORD_STORE=pgvector (default): bi_semantiq database on the portal RDS, table semantic_keyword_embeddings.
    Its DSN is SEMANTIC_PG_DSN if set, otherwise the portal's BI_REPORT_DB_* settings with the database
    switched to BI_SEMANTIQ_DATABASE (default bi_semantiq).
    KEYWORD_STORE=qdrant: the hosted or local Qdrant at QDRANT_URL (kept as a fallback).
    """
    import os
    import re

    if getattr(settings, "keyword_store", "pgvector") == "pgvector":
        secret = getattr(settings, "semantic_pg_dsn", None)
        dsn = secret.get_secret_value() if secret else None
        if not dsn:
            from .catalog_postgres import postgres_dsn

            base = postgres_dsn()
            if base:
                db = os.environ.get("BI_SEMANTIQ_DATABASE", "bi_semantiq").strip() or "bi_semantiq"
                dsn = re.sub(r"dbname=\S+", f"dbname={db}", base)
        if dsn:
            return PgVectorKeywordStore(dsn=dsn, table=getattr(settings, "semantic_pg_table", "semantic_keyword_embeddings"))
    if getattr(settings, "qdrant_url", None):
        return QdrantKeywordStore(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key.get_secret_value() if getattr(settings, "qdrant_api_key", None) else None,
            collection=settings.qdrant_collection,
        )
    return None
