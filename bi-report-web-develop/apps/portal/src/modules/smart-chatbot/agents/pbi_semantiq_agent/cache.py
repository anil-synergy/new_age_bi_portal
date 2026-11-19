"""In-process TTL cache with single-flight loading (one upstream call per key under concurrency)."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable, Generic, TypeVar

T = TypeVar("T")


class AsyncTTLCache(Generic[T]):
    def __init__(self, ttl_s: float, max_entries: int = 256):
        self.ttl_s = ttl_s
        self.max_entries = max_entries
        self._values: dict[Any, tuple[float, T]] = {}
        self._inflight: dict[Any, asyncio.Future[T]] = {}

    def _fresh(self, key: Any) -> T | None:
        hit = self._values.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        return None

    async def get_or_load(self, key: Any, loader: Callable[[], Awaitable[T]]) -> T:
        value = self._fresh(key)
        if value is not None:
            return value
        pending = self._inflight.get(key)
        if pending is not None:
            return await asyncio.shield(pending)
        future: asyncio.Future[T] = asyncio.get_running_loop().create_future()
        self._inflight[key] = future
        try:
            value = await loader()
            if len(self._values) >= self.max_entries:
                oldest = min(self._values, key=lambda k: self._values[k][0])
                self._values.pop(oldest, None)
            self._values[key] = (time.monotonic() + self.ttl_s, value)
            future.set_result(value)
            return value
        except BaseException as exc:
            future.set_exception(exc)
            # Waiters re-raise it; mark retrieved so an unobserved failure does not warn.
            future.exception()
            raise
        finally:
            self._inflight.pop(key, None)

    def invalidate(self, key: Any) -> None:
        self._values.pop(key, None)
