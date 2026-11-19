"""Bearer-secret guard for the MCP agents. Health routes stay open for probes."""

from __future__ import annotations

import hmac

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

OPEN_PATHS = ("/health", "/health/ready")


def _is_open_probe(path: str) -> bool:
    p = path.rstrip("/") or "/"
    if p in OPEN_PATHS:
        return True
    if p.endswith("/health/ready"):
        return True
    return p.endswith("/health")


class SharedSecretMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, secret: str | None):
        super().__init__(app)
        self._secret = secret

    async def dispatch(self, request: Request, call_next):
        if self._secret and not _is_open_probe(request.url.path):
            header = request.headers.get("authorization", "")
            token = header[7:] if header.lower().startswith("bearer ") else ""
            if not hmac.compare_digest(token.encode(), self._secret.encode()):
                return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)
