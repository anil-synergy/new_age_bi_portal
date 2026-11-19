"""Retry policy for idempotent HTTP calls: 429 / 5xx / transport errors, exponential backoff with jitter."""

from __future__ import annotations

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
)

RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


class RetryableStatus(Exception):
    def __init__(self, response: httpx.Response):
        super().__init__(f"HTTP {response.status_code}")
        self.response = response


def _is_retryable(exc: BaseException) -> bool:
    return isinstance(exc, (RetryableStatus, httpx.TransportError))


def retrying(attempts: int = 4) -> AsyncRetrying:
    return AsyncRetrying(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(attempts),
        wait=wait_exponential_jitter(initial=0.5, max=8),
        reraise=True,
    )
