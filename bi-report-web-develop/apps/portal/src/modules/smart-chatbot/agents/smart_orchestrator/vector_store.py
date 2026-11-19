"""Vector stores for catalog retrieval.

LocalVectorStore keeps vectors in process; it is always populated and is the fallback.
PineconeStore talks to a Pinecone serverless index over its REST data-plane API. The index
dimension must equal EMBEDDING_DIMENSIONS and its metric must be cosine.

Every query takes a metadata filter. Environment and allowed-model filters are applied by
the store before ranking, so excluded models never take a top-k slot.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol

import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from smart_common.logging import log

from .embeddings import cosine

logger = logging.getLogger(__name__)


class VectorStoreError(RuntimeError):
    pass


class VectorStore(Protocol):
    name: str

    async def upsert(self, items: list[tuple[str, list[float], dict[str, Any]]]) -> None: ...

    async def delete(self, ids: list[str]) -> None: ...

    async def query(self, vector: list[float], *, top_k: int, environments: list[str], ids: set[str]) -> dict[str, float]: ...


class LocalVectorStore:
    name = "local"

    def __init__(self) -> None:
        self._vectors: dict[str, tuple[list[float], dict[str, Any]]] = {}

    def __len__(self) -> int:
        return len(self._vectors)

    async def upsert(self, items: list[tuple[str, list[float], dict[str, Any]]]) -> None:
        for doc_id, vector, metadata in items:
            self._vectors[doc_id] = (vector, metadata)

    async def delete(self, ids: list[str]) -> None:
        for doc_id in ids:
            self._vectors.pop(doc_id, None)

    def _scan(self, vector: list[float], top_k: int, environments: set[str], ids: set[str]) -> dict[str, float]:
        scored = [
            (doc_id, cosine(vector, stored))
            for doc_id, (stored, metadata) in self._vectors.items()
            if doc_id in ids and metadata.get("environment") in environments
        ]
        scored.sort(key=lambda pair: -pair[1])
        return dict(scored[:top_k])

    async def query(self, vector: list[float], *, top_k: int, environments: list[str], ids: set[str]) -> dict[str, float]:
        if len(self._vectors) > 2000:
            return await asyncio.to_thread(self._scan, vector, top_k, set(environments), ids)
        return self._scan(vector, top_k, set(environments), ids)


class _Transient(Exception):
    pass


class PineconeStore:
    name = "pinecone"

    def __init__(self, *, api_key: str, index_host: str, namespace: str, api_version: str, timeout_s: float, transport: httpx.AsyncBaseTransport | None = None):
        host = index_host if index_host.startswith("http") else f"https://{index_host}"
        self._namespace = namespace
        self._http = httpx.AsyncClient(
            base_url=host.rstrip("/"),
            timeout=timeout_s,
            transport=transport,
            headers={"Api-Key": api_key, "X-Pinecone-API-Version": api_version, "Content-Type": "application/json"},
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response: httpx.Response | None = None
        async for attempt in AsyncRetrying(
            retry=retry_if_exception_type((_Transient, httpx.TransportError)),
            stop=stop_after_attempt(3),
            wait=wait_exponential_jitter(multiplier=0.3, max=3),
            reraise=True,
        ):
            with attempt:
                response = await self._http.post(path, json=body)
                if response.status_code in (429, 500, 502, 503, 504):
                    raise _Transient(str(response.status_code))
        assert response is not None
        if response.status_code >= 400:
            log(logger, logging.WARNING, "pinecone_request_failed", path=path, status=response.status_code)
            raise VectorStoreError(f"Pinecone returned {response.status_code}")
        return response.json() if response.content else {}

    async def upsert(self, items: list[tuple[str, list[float], dict[str, Any]]]) -> None:
        for start in range(0, len(items), 100):
            batch = items[start : start + 100]
            await self._post(
                "/vectors/upsert",
                {
                    "namespace": self._namespace,
                    "vectors": [{"id": doc_id, "values": vector, "metadata": _flat(metadata)} for doc_id, vector, metadata in batch],
                },
            )

    async def delete(self, ids: list[str]) -> None:
        for start in range(0, len(ids), 1000):
            await self._post("/vectors/delete", {"namespace": self._namespace, "ids": ids[start : start + 1000]})

    async def query(self, vector: list[float], *, top_k: int, environments: list[str], ids: set[str]) -> dict[str, float]:
        metadata_filter: dict[str, Any] = {"environment": {"$in": environments}}
        if len(ids) <= 1000:
            metadata_filter = {"$and": [metadata_filter, {"doc_id": {"$in": sorted(ids)}}]}
        try:
            data = await self._post(
                "/query",
                {
                    "namespace": self._namespace,
                    "vector": vector,
                    "topK": max(top_k * 3, top_k),
                    "includeMetadata": False,
                    "includeValues": False,
                    "filter": metadata_filter,
                },
            )
        except (httpx.HTTPError, _Transient) as exc:
            raise VectorStoreError(str(exc)) from exc
        out: dict[str, float] = {}
        for match in data.get("matches", []):
            doc_id = str(match.get("id"))
            if doc_id in ids:
                out[doc_id] = float(match.get("score") or 0.0)
        return dict(sorted(out.items(), key=lambda pair: -pair[1])[:top_k])


def _flat(metadata: dict[str, Any]) -> dict[str, Any]:
    """Pinecone metadata accepts strings, numbers, booleans and lists of strings."""
    out: dict[str, Any] = {}
    for key, value in metadata.items():
        if value is None:
            continue
        if isinstance(value, (str, int, float, bool)):
            out[key] = value
        elif isinstance(value, (list, tuple)):
            out[key] = [str(v) for v in value]
        else:
            out[key] = str(value)
    return out


def build_remote_store(settings) -> PineconeStore | None:
    key = settings.pinecone_api_key.get_secret_value() if settings.pinecone_api_key else ""
    if not key or not settings.pinecone_index_host:
        return None
    return PineconeStore(
        api_key=key,
        index_host=settings.pinecone_index_host,
        namespace=settings.pinecone_namespace,
        api_version=settings.pinecone_api_version,
        timeout_s=settings.pinecone_timeout_s,
    )
