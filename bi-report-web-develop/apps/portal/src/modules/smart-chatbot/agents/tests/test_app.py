"""SMART HTTP API: portal JWT, SSE framing, rate limit and a 20-user concurrency smoke test."""

from __future__ import annotations

import asyncio
import json
import time

import httpx
import jwt

from smart_orchestrator.app import create_app
from smart_orchestrator.graph import SmartGraph
from smart_orchestrator.settings import OrchestratorSettings
from tests.conftest import FakeLLM
from tests.test_graph import FakeAgents

SECRET = "test-portal-secret-with-enough-length-0123456789"


def _token(email: str = "user@x.com", **overrides) -> str:
    now = int(time.time())
    claims = {"email": email, "iat": now, "exp": now + 120, "iss": "bi-portal", "aud": "smart-orchestrator", **overrides}
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _client(**settings_overrides) -> tuple[httpx.AsyncClient, FakeAgents]:
    settings = OrchestratorSettings(_env_file=None, portal_jwt_secret=SECRET, **settings_overrides)
    agents = FakeAgents()
    graph = SmartGraph(settings, agents, FakeLLM(configured=False))  # type: ignore[arg-type]
    app = create_app(settings, graph)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://smart"), agents


def _events(body: str) -> list[tuple[str, dict]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


BODY = {"message": "Compare spend by vendor", "conversation_id": "c1", "context": {"workspace_id": "ws-1", "dataset_id": "ds-1"}}


async def test_chat_streams_steps_then_one_message():
    client, _ = _client()
    async with client:
        response = await client.post("/chat", json=BODY, headers={"Authorization": f"Bearer {_token()}"})
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/event-stream")
    events = _events(response.text)
    assert events[0][0] == "step" and events[0][1]["step"] == "accepted"
    assert [e for e, _ in events].count("message") == 1 and events[-1][0] == "message"
    final = events[-1][1]
    assert final["kind"] == "answer" and final["requestId"] and isinstance(final["elapsedMs"], int)


async def test_rejects_missing_forged_or_wrong_audience_tokens():
    client, _ = _client()
    async with client:
        assert (await client.post("/chat", json=BODY)).status_code == 401
        forged = jwt.encode({"email": "a@x.com", "iat": int(time.time()), "exp": int(time.time()) + 60, "iss": "bi-portal", "aud": "smart-orchestrator"}, "wrong", algorithm="HS256")
        assert (await client.post("/chat", json=BODY, headers={"Authorization": f"Bearer {forged}"})).status_code == 401
        assert (await client.post("/chat", json=BODY, headers={"Authorization": f"Bearer {_token(aud='other')}"})).status_code == 401
        expired = _token(iat=int(time.time()) - 600, exp=int(time.time()) - 300)
        assert (await client.post("/chat", json=BODY, headers={"Authorization": f"Bearer {expired}"})).status_code == 401
        assert (await client.post("/chat", json=BODY, headers={"Authorization": f"Bearer {_token(email='')}"})).status_code == 401


async def test_validates_body():
    client, _ = _client()
    async with client:
        response = await client.post("/chat", json={**BODY, "message": ""}, headers={"Authorization": f"Bearer {_token()}"})
    assert response.status_code == 422


async def test_rate_limit_per_user():
    client, _ = _client(user_requests_per_minute=2)
    headers = {"Authorization": f"Bearer {_token()}"}
    async with client:
        codes = [(await client.post("/chat", json=BODY, headers=headers)).status_code for _ in range(3)]
        other = await client.post("/chat", json=BODY, headers={"Authorization": f"Bearer {_token('other@x.com')}"})
    assert codes == [200, 200, 429] and other.status_code == 200


async def test_twenty_concurrent_users():
    client, agents = _client(max_concurrent_requests=8)
    users = [f"user{i}@x.com" for i in range(20)]

    async def ask(email: str) -> dict:
        response = await client.post("/chat", json={**BODY, "conversation_id": email}, headers={"Authorization": f"Bearer {_token(email)}"})
        assert response.status_code == 200
        return _events(response.text)[-1][1]

    started = time.perf_counter()
    async with client:
        finals = await asyncio.gather(*(ask(u) for u in users))
    assert all(f["kind"] == "answer" for f in finals)
    assert sorted(a["user_email"] for _, tool, a in agents.calls if tool == "answer_question") == sorted(users)
    assert len({f["requestId"] for f in finals}) == 20
    assert time.perf_counter() - started < 30


async def test_feedback_for_own_answers_only():
    client, _ = _client()
    async with client:
        chat = await client.post("/chat", json=BODY, headers={"Authorization": f"Bearer {_token()}"})
        request_id = _events(chat.text)[-1][1]["requestId"]
        mine = await client.post("/feedback", json={"request_id": request_id, "rating": "down", "reason": "wrong_report", "comment": "used the wrong model"}, headers={"Authorization": f"Bearer {_token()}"})
        theirs = await client.post("/feedback", json={"request_id": request_id, "rating": "up"}, headers={"Authorization": f"Bearer {_token('other@x.com')}"})
        invalid = await client.post("/feedback", json={"request_id": request_id, "rating": "meh"}, headers={"Authorization": f"Bearer {_token()}"})
        anonymous = await client.post("/feedback", json={"request_id": request_id, "rating": "up"})
    assert mine.status_code == 200 and theirs.status_code == 404 and invalid.status_code == 422 and anonymous.status_code == 401


async def test_health_is_open():
    client, _ = _client()
    async with client:
        assert (await client.get("/health")).json()["status"] == "ok"
