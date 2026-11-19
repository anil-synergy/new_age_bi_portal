"""Text embeddings for hybrid retrieval and the semantic cache.

GatewayEmbedder calls the OpenAI-compatible gateway when EMBEDDING_MODEL is set.
HashingEmbedder is the local default: signed feature hashing of stems, word pairs and
character trigrams. It captures spelling variants and shared phrasing, not meaning; meaning
comes from the glossary expansion and, when configured, the gateway model.
Both return unit-length vectors of a fixed dimension, so cosine similarity is a dot product.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
from collections import OrderedDict
from typing import Protocol

import openai
from openai import AsyncOpenAI
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from smart_common.keywords import stem
from smart_common.logging import log

from .query_norm import STOP, words

logger = logging.getLogger(__name__)


class EmbeddingUnavailable(RuntimeError):
    pass


class Embedder(Protocol):
    name: str
    dimensions: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    return [v / norm for v in vector] if norm else vector


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


class HashingEmbedder:
    def __init__(self, dimensions: int = 512):
        self.dimensions = max(64, dimensions)
        self.name = f"hashing-{self.dimensions}"

    def _slot(self, feature: str) -> tuple[int, float]:
        digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
        value = int.from_bytes(digest, "big")
        return value % self.dimensions, (1.0 if (value >> 63) & 1 else -1.0)

    def embed_one(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        tokens = [stem(w) for w in words(text) if w not in STOP]
        for token in tokens:
            index, sign = self._slot(f"w:{token}")
            vector[index] += sign * 1.0
            padded = f"#{token}#"
            for i in range(len(padded) - 2):
                index, sign = self._slot(f"c:{padded[i:i + 3]}")
                vector[index] += sign * 0.35
        for left, right in zip(tokens, tokens[1:]):
            index, sign = self._slot(f"b:{left}_{right}")
            vector[index] += sign * 0.6
        return _normalize(vector)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_one(t) for t in texts]


_TRANSIENT = (openai.APITimeoutError, openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)


class GatewayEmbedder:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        dimensions: int,
        timeout_s: float = 15.0,
        max_concurrency: int = 4,
        batch_size: int = 64,
        cache_size: int = 4096,
    ):
        self.name = model
        self.dimensions = dimensions
        self._model = model
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout_s, max_retries=0)
        self._semaphore = asyncio.Semaphore(max(1, max_concurrency))
        self._batch_size = batch_size
        self._cache: OrderedDict[str, list[float]] = OrderedDict()
        self._cache_size = cache_size

    async def _batch(self, texts: list[str]) -> list[list[float]]:
        async for attempt in AsyncRetrying(
            retry=retry_if_exception_type(_TRANSIENT), stop=stop_after_attempt(3), wait=wait_exponential_jitter(multiplier=0.5, max=4), reraise=True
        ):
            with attempt:
                async with self._semaphore:
                    kwargs = {"model": self._model, "input": texts}
                    if self.dimensions:
                        kwargs["dimensions"] = self.dimensions
                    response = await self._client.embeddings.create(**kwargs)
        return [_normalize(list(item.embedding)) for item in response.data]

    async def embed(self, texts: list[str]) -> list[list[float]]:
        missing = [t for t in dict.fromkeys(texts) if t not in self._cache]
        try:
            for start in range(0, len(missing), self._batch_size):
                chunk = missing[start : start + self._batch_size]
                for text, vector in zip(chunk, await self._batch(chunk)):
                    self._cache[text] = vector
                    if len(self._cache) > self._cache_size:
                        self._cache.popitem(last=False)
        except openai.APIError as exc:
            log(logger, logging.WARNING, "embedding_failed", model=self._model, error=type(exc).__name__)
            raise EmbeddingUnavailable(str(exc)) from exc
        return [self._cache[t] for t in texts]


def build_embedder(settings) -> Embedder:
    model = (getattr(settings, "embedding_model", "") or "").strip()
    if model and settings.llm_configured:
        return GatewayEmbedder(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key.get_secret_value(),
            model=model,
            dimensions=settings.embedding_dimensions,
            timeout_s=settings.embedding_timeout_s,
        )
    return HashingEmbedder(settings.embedding_dimensions)
