"""Agent registry: calls tools on MCP agents over streamable HTTP.

Agents are stateless, so each call opens a short-lived MCP session over one pooled
HTTP client (building a client per call costs ~1 s of TLS setup on Windows and blocks
the event loop). Concurrency is bounded per agent so one slow agent cannot exhaust
the orchestrator.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Protocol

import httpx
from mcp import ClientSession

try:
    from mcp.client.streamable_http import streamable_http_client
except ImportError:  # mcp < 1.24
    streamable_http_client = None  # type: ignore[assignment]
    from mcp.client.streamable_http import streamablehttp_client

from smart_common.logging import log

logger = logging.getLogger(__name__)


class AgentCallError(RuntimeError):
    pass


class ToolCaller(Protocol):
    async def call(self, agent_id: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]: ...


class AgentRegistry:
    def __init__(self, agents: dict[str, str], *, secret: str | None, timeout_s: float, per_agent_concurrency: int = 16):
        self.agents = agents
        self._headers = {"Authorization": f"Bearer {secret}"} if secret else {}
        self._timeout = timeout_s
        self._limits = {agent_id: asyncio.Semaphore(per_agent_concurrency) for agent_id in agents}
        self._per_agent_concurrency = per_agent_concurrency
        self._http: httpx.AsyncClient | None = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                headers=self._headers,
                timeout=httpx.Timeout(self._timeout, connect=10.0),
                limits=httpx.Limits(max_connections=self._per_agent_concurrency * max(1, len(self.agents)) * 2),
            )
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def call(self, agent_id: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        url = self.agents.get(agent_id)
        if not url:
            raise AgentCallError(f"Agent '{agent_id}' is not registered")
        started = time.perf_counter()
        try:
            async with self._limits[agent_id]:
                result = await asyncio.wait_for(self._call(url, tool, arguments), timeout=self._timeout)
        except asyncio.TimeoutError as exc:
            raise AgentCallError(f"{agent_id}.{tool} timed out after {self._timeout:.0f}s") from exc
        except AgentCallError:
            raise
        except Exception as exc:  # transport / protocol errors surface as one type
            cause = _root_cause(exc)
            raise AgentCallError(f"{agent_id}.{tool} failed: {type(cause).__name__}: {cause}") from exc
        finally:
            log(logger, logging.INFO, "agent_call", agent=agent_id, tool=tool, ms=round((time.perf_counter() - started) * 1000, 1))
        return result

    async def _call(self, url: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if streamable_http_client is not None:
            transport = streamable_http_client(url, http_client=self._client(), terminate_on_close=False)
        else:
            transport = streamablehttp_client(url, headers=self._headers, timeout=self._timeout)
        async with transport as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, arguments)
        if result.isError:
            text = " ".join(getattr(c, "text", "") for c in result.content)
            raise AgentCallError(f"{tool} returned an error: {text[:500]}")
        if result.structuredContent:
            payload = result.structuredContent
            # FastMCP wraps non-object return types as {"result": ...}.
            return payload.get("result", payload) if set(payload) == {"result"} else payload
        for block in result.content:
            text = getattr(block, "text", None)
            if text:
                return json.loads(text)
        return {}

    async def health(self) -> dict[str, bool]:
        async def check(agent_id: str, url: str) -> tuple[str, bool]:
            base = url.rsplit("/mcp", 1)[0]
            try:
                response = await self._client().get(f"{base}/health", timeout=5)
                return agent_id, response.status_code == 200
            except httpx.HTTPError:
                return agent_id, False

        results = await asyncio.gather(*(check(a, u) for a, u in self.agents.items()))
        return dict(results)


def _root_cause(exc: BaseException) -> BaseException:
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return exc
