"""SMART orchestrator HTTP API.

POST /chat          Server-Sent Events: `step` events while agents work, then one `message` event.
POST /feedback      thumbs up/down (+ optional reason and comment) for an answer the same user received.
GET  /health        liveness
GET  /health/ready  readiness (LLM configured, agents reachable)

Only the portal's server route calls this service. It must present a short-lived HS256
token (PORTAL_JWT_SECRET) whose `email` claim was taken from a verified Entra session.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Literal

import jwt
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from smart_common.llm import LLMClient
from smart_common.logging import configure_logging, log, new_request_id

from . import TECHNICAL_NAME
from .graph import SmartGraph
from .learning_apply import apply_proposal, list_proposals, load_proposal, reject_proposal
from .learning_model import candidates_to_proposal, load_corrections, score_corrections
from .mcp_clients import AgentRegistry
from .settings import OrchestratorSettings, get_settings

logger = logging.getLogger(__name__)


class CatalogReport(BaseModel):
    portal_id: str = Field(..., max_length=64)
    title: str = Field(..., max_length=300)
    category_name: str | None = Field(None, max_length=200)
    menu_path: str | None = Field(None, max_length=500)
    workspace_id: str | None = Field(None, max_length=64)
    report_id: str | None = Field(None, max_length=64)
    dataset_id: str | None = Field(None, max_length=64)


class MemoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=800)


class ChatContext(BaseModel):
    workspace_id: str | None = Field(None, max_length=64)
    report_id: str | None = Field(None, max_length=64)
    dataset_id: str | None = Field(None, max_length=64)
    report_name: str | None = Field(None, max_length=300)
    catalog: list[CatalogReport] = Field(default_factory=list, max_length=250)
    catalog_unavailable: bool = False
    memory: list[MemoryTurn] = Field(default_factory=list, max_length=12)
    output_mode: Literal["stream", "batch"] = "batch"
    # Honoured only for users listed in NONPROD_OVERRIDE_USERS.
    include_nonprod: bool = False


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    conversation_id: str = Field(..., min_length=1, max_length=100)
    context: ChatContext = Field(default_factory=ChatContext)


class FeedbackRequest(BaseModel):
    request_id: str = Field(..., min_length=8, max_length=64)
    rating: Literal["up", "down"]
    reason: Literal["wrong_report", "wrong_number", "missing_data", "slow", "unclear", "other"] | None = None
    comment: str | None = Field(None, max_length=1000)


class LearningRejectBody(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


def _learning_admin(email: str, settings: OrchestratorSettings) -> None:
    admins = settings.learning_admins()
    if admins and email.lower() not in admins:
        raise HTTPException(403, "Learning admin access required")


class RateLimiter:
    """Sliding one-minute window per user (in-process; use Redis when running several replicas)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= self.per_minute:
            return False
        hits.append(now)
        return True


def verify_portal_token(token: str, settings: OrchestratorSettings) -> str:
    if not settings.portal_jwt_secret:
        raise HTTPException(503, "PORTAL_JWT_SECRET is not configured")
    try:
        claims = jwt.decode(
            token,
            settings.portal_jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            audience=settings.portal_jwt_audience,
            issuer=settings.portal_jwt_issuer,
            options={"require": ["exp", "iat", "email"]},
            leeway=10,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "Invalid portal token") from exc
    email = str(claims.get("email") or "").strip()
    if "@" not in email:
        raise HTTPException(401, "Token has no user email")
    return email


def create_app(settings: OrchestratorSettings | None = None, graph: SmartGraph | None = None) -> FastAPI:
    settings = settings or get_settings()
    registry = AgentRegistry(settings.agents(), secret=settings.mcp_secret(), timeout_s=settings.agent_timeout_s)
    smart = graph or SmartGraph(settings, registry, LLMClient(settings))
    limiter = RateLimiter(settings.user_requests_per_minute)
    capacity = asyncio.Semaphore(settings.max_concurrent_requests)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        log(
            logger,
            logging.INFO,
            "smart_started",
            agents=list(settings.agents()),
            llm=settings.llm_configured,
            embedder=smart.embedder.name,
            vector_store="pinecone" if smart.index.remote else "local",
            semantic_cache=settings.semantic_cache_enabled,
        )
        # Keyword index catch-up: one background run if the nightly run has not succeeded in the last 24 h.
        try:
            from pbi_semantiq_agent.keyword_schedule import start_catch_up_if_due
            from pbi_semantiq_agent.settings import get_settings as semantiq_settings

            start_catch_up_if_due(semantiq_settings())
        except Exception as exc:  # noqa: BLE001 - indexing must never stop the chat server
            log(logger, logging.WARNING, "keyword_catch_up_skipped", error=type(exc).__name__)
        saver_cm = _sqlite_checkpointer(settings.checkpoint_sqlite_path)
        if saver_cm is not None:
            smart.use_checkpointer(await saver_cm.__aenter__())
        try:
            yield
        finally:
            if saver_cm is not None:
                await saver_cm.__aexit__(None, None, None)
            await smart.aclose()
            await registry.aclose()

    app = FastAPI(title="SMART orchestrator", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_methods=["POST", "GET"], allow_headers=["authorization", "content-type"])

    def current_user(authorization: str = Header("")) -> str:
        if not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "Missing bearer token")
        return verify_portal_token(authorization[7:].strip(), settings)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "service": TECHNICAL_NAME}

    @app.get("/health/ready")
    async def ready() -> JSONResponse:
        agents = await registry.health()
        checks = {"llm_configured": settings.llm_configured, "portal_secret": bool(settings.portal_jwt_secret), **{f"agent:{k}": v for k, v in agents.items()}}
        ok = all(checks.values())
        return JSONResponse({"status": "ready" if ok else "not_ready", "checks": checks}, status_code=200 if ok else 503)

    @app.post("/chat")
    async def chat(body: ChatRequest, request: Request, email: str = Depends(current_user)) -> StreamingResponse:
        if not limiter.allow(email.lower()):
            raise HTTPException(429, "Too many questions; please wait a minute")
        request_id = new_request_id()

        async def events() -> AsyncIterator[bytes]:
            yield _sse("step", {"step": "accepted", "status": "done", "label": "SMART received your question", "requestId": request_id})
            if capacity.locked():
                yield _sse("step", {"step": "queued", "status": "running", "label": "Waiting for a free agent slot"})
            started = time.perf_counter()
            finished = False
            try:
                async with capacity:
                    async with asyncio.timeout(settings.request_timeout_s):
                        async for item in _with_keepalive(
                            smart.run(
                                question=body.message.strip(),
                                user_email=email,
                                conversation_id=body.conversation_id,
                                context=body.context.model_dump(),
                                request_id=request_id,
                            )
                        ):
                            if item is None:
                                # SSE comment: keeps proxies and the browser connection open during slow steps.
                                yield b": keepalive\n\n"
                                continue
                            if await request.is_disconnected():
                                log(logger, logging.INFO, "client_disconnected")
                                return
                            kind, payload = item
                            if kind == "delta":
                                yield _sse("delta", payload)
                                continue
                            if kind == "message":
                                payload = {**payload, "requestId": request_id, "elapsedMs": round((time.perf_counter() - started) * 1000)}
                            yield _sse(kind, payload)
                finished = True
            except TimeoutError:
                finished = True
                yield _sse("message", {"kind": "error", "content": "That took too long. Please try a narrower question.", "confidence": 0.0, "requestId": request_id})
            except Exception:
                finished = True
                logger.exception("chat_failed")
                yield _sse("message", {"kind": "error", "content": "Something went wrong while answering.", "confidence": 0.0, "requestId": request_id})
            finally:
                elapsed = round((time.perf_counter() - started) * 1000)
                if finished:
                    log(logger, logging.INFO, "chat_done", ms=elapsed)
                else:
                    # The client went away or the stream was closed before the answer was sent.
                    log(logger, logging.WARNING, "chat_cancelled", ms=elapsed, request_id=request_id)

        return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/feedback")
    async def feedback(body: FeedbackRequest, email: str = Depends(current_user)) -> dict[str, Any]:
        if not limiter.allow(f"feedback:{email.lower()}"):
            raise HTTPException(429, "Too many requests; please wait a minute")
        saved = await smart.analytics.feedback(
            interaction_id=body.request_id,
            user_email=email,
            rating=1 if body.rating == "up" else -1,
            reason=body.reason,
            comment=(body.comment or "").strip() or None,
        )
        if not saved:
            raise HTTPException(404, "Unknown answer")
        await smart.on_feedback(
            interaction_id=body.request_id,
            user_email=email,
            rating=1 if body.rating == "up" else -1,
            reason=body.reason,
            comment=(body.comment or "").strip() or None,
        )
        log(logger, logging.INFO, "feedback_saved", rating=body.rating, reason=body.reason, has_comment=bool(body.comment))
        return {"status": "ok"}

    @app.get("/learning/proposals")
    async def learning_list(email: str = Depends(current_user)) -> dict[str, Any]:
        _learning_admin(email, settings)
        rows = list_proposals()
        return {"proposals": [{k: v for k, v in p.items() if k != "_path"} for p in rows]}

    @app.post("/learning/generate")
    async def learning_generate(email: str = Depends(current_user)) -> dict[str, Any]:
        _learning_admin(email, settings)
        if not limiter.allow(f"learning:{email.lower()}"):
            raise HTTPException(429, "Too many requests; please wait a minute")
        db_path = Path(settings.analytics_db_path)
        since = time.time() - 14 * 86400
        rows = load_corrections(db_path, since=since)
        scored = score_corrections(rows, promote_score=settings.learning_promote_score)
        if not scored:
            return {"status": "empty", "message": "No promotion-ready candidates"}
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        proposal = candidates_to_proposal(scored, proposal_id=f"auto-{stamp}-{len(scored)}")
        out_dir = Path(__file__).resolve().parents[1] / "learning" / "proposals"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"{proposal['id']}.json"
        out_file.write_text(json.dumps(proposal, indent=2) + "\n", encoding="utf-8")
        return {"status": "ok", "proposal": proposal}

    @app.post("/learning/proposals/{proposal_id}/apply")
    async def learning_apply(proposal_id: str, email: str = Depends(current_user)) -> dict[str, Any]:
        _learning_admin(email, settings)
        proposal = load_proposal(proposal_id)
        if not proposal:
            raise HTTPException(404, "Unknown proposal")
        audit = apply_proposal(proposal, approved_by=email, apply_writes=True)
        if audit.get("errors"):
            return JSONResponse({"errors": audit["errors"], "audit": audit.get("audit_file")}, status_code=400)
        return {"status": "applied", "audit": audit}

    @app.post("/learning/proposals/{proposal_id}/reject")
    async def learning_reject(proposal_id: str, body: LearningRejectBody, email: str = Depends(current_user)) -> dict[str, Any]:
        _learning_admin(email, settings)
        return reject_proposal(proposal_id, rejected_by=email, reason=body.reason)

    return app


def _sqlite_checkpointer(path: str):
    """Durable LangGraph checkpoints when langgraph-checkpoint-sqlite is installed; memory otherwise."""
    if not path:
        return None
    try:
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver  # type: ignore[import-not-found]
    except ImportError:
        log(logger, logging.WARNING, "checkpoint_sqlite_unavailable", note="pip install langgraph-checkpoint-sqlite; using in-memory checkpoints")
        return None
    return AsyncSqliteSaver.from_conn_string(path)


async def _with_keepalive(events: AsyncIterator[Any], every: float = 10.0) -> AsyncIterator[Any]:
    """Yield the graph's events; yield None when nothing arrives for ``every`` seconds (keep-alive tick)."""
    iterator = events.__aiter__()
    pending = asyncio.ensure_future(iterator.__anext__())
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=every)
            if not done:
                yield None
                continue
            try:
                item = pending.result()
            except StopAsyncIteration:
                return
            pending = asyncio.ensure_future(iterator.__anext__())
            yield item
    finally:
        pending.cancel()


def _json_safe(value: Any) -> Any:
    """Replace NaN / Infinity with null. Python's json writes them as bare tokens, which the browser's
    JSON.parse rejects, so one NaN in a payload made every SMART answer show as a failure."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(_json_safe(data), default=str, allow_nan=False)}\n\n".encode("utf-8")


def main() -> None:
    settings = get_settings()
    configure_logging(TECHNICAL_NAME, settings.log_level)
    from .combined import create_combined_app

    uvicorn.run(create_combined_app(settings), host=settings.host, port=settings.port, log_level=settings.log_level.lower(), access_log=False)


if __name__ == "__main__":
    main()
