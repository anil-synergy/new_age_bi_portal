"""Async client for the OpenAI-compatible AI gateway.

Every call is bounded by a semaphore (back-pressure under concurrent users), a timeout,
and retries for transient gateway errors only. Outputs are JSON validated against a
pydantic model; one corrective retry is made when the model returns invalid JSON.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TypeVar

import openai
from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from .config import LLMSettings
from .logging import log

T = TypeVar("T", bound=BaseModel)
logger = logging.getLogger(__name__)

_TRANSIENT = (
    openai.APITimeoutError,
    openai.APIConnectionError,
    openai.RateLimitError,
    openai.InternalServerError,
)


class LLMUnavailable(RuntimeError):
    """Raised when the gateway is not configured or keeps failing."""


class LLMClient:
    def __init__(self, settings: LLMSettings):
        self.settings = settings
        self._semaphore = asyncio.Semaphore(max(1, settings.llm_max_concurrency))
        self._client: AsyncOpenAI | None = None
        if settings.llm_configured:
            self._client = AsyncOpenAI(
                api_key=settings.llm_api_key.get_secret_value(),  # type: ignore[union-attr]
                base_url=settings.llm_base_url,
                timeout=settings.llm_timeout_s,
                max_retries=0,
            )

    @property
    def configured(self) -> bool:
        return self._client is not None

    async def _create(self, messages: list[dict], max_tokens: int, *, stream: bool = False) -> str:
        assert self._client is not None
        kwargs: dict = {
            "model": self.settings.llm_deployment,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "max_completion_tokens": max_tokens,
        }
        if self.settings.llm_temperature is not None:
            kwargs["temperature"] = self.settings.llm_temperature
        if stream:
            kwargs["stream"] = True
        async for attempt in AsyncRetrying(
            retry=retry_if_exception_type(_TRANSIENT),
            stop=stop_after_attempt(3),
            wait=wait_exponential_jitter(initial=1, max=8),
            reraise=True,
        ):
            with attempt:
                async with self._semaphore:
                    response = await self._client.chat.completions.create(**kwargs)
                    if not stream:
                        return response.choices[0].message.content or ""
                    parts: list[str] = []
                    async for chunk in response:
                        choice = chunk.choices[0] if chunk.choices else None
                        delta = choice.delta.content if choice and choice.delta else None
                        if delta:
                            parts.append(delta)
                    return "".join(parts)
        return ""

    async def complete_json(
        self,
        system: str,
        user: str,
        schema: type[T],
        *,
        max_tokens: int | None = None,
        stream: bool = False,
    ) -> T:
        if not self.configured:
            raise LLMUnavailable("LLM gateway is not configured (LLM_API_KEY missing)")
        schema_hint = json.dumps(schema.model_json_schema(), separators=(",", ":"))
        messages = [
            {"role": "system", "content": f"{system}\n\nRespond with a single JSON object matching this JSON schema:\n{schema_hint}"},
            {"role": "user", "content": user},
        ]
        limit = max_tokens or self.settings.llm_max_output_tokens
        try:
            raw = await self._create(messages, limit, stream=stream)
            try:
                return schema.model_validate_json(_strip_fences(raw))
            except ValidationError as exc:
                log(logger, logging.WARNING, "llm_invalid_json_retry", schema=schema.__name__)
                messages += [
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content": f"That JSON was invalid: {exc.errors()[:3]}. Return only corrected JSON."},
                ]
                return schema.model_validate_json(_strip_fences(await self._create(messages, limit, stream=stream)))
        except (openai.APIError, ValidationError) as exc:
            log(logger, logging.ERROR, "llm_call_failed", schema=schema.__name__, error=type(exc).__name__)
            raise LLMUnavailable(str(exc)) from exc


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        if text.endswith("```"):
            text = text[: -3]
    return text.strip()
