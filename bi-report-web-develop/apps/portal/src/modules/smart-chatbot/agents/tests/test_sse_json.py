"""SSE payloads must be strict JSON: a NaN in catalogue data broke every SMART answer in the browser."""

import json

from smart_orchestrator.app import _sse


def _payload(raw: bytes) -> dict:
    text = raw.decode("utf-8")
    data_line = next(line for line in text.splitlines() if line.startswith("data: "))
    # strict parse, like the browser's JSON.parse (rejects NaN / Infinity)
    return json.loads(data_line[len("data: "):], parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))


def test_nan_and_infinity_are_sent_as_null():
    raw = _sse("message", {"content": "ok", "refresh": {"next_refresh": float("nan")}, "rows": [1.5, float("inf")]})
    data = _payload(raw)
    assert data["refresh"]["next_refresh"] is None
    assert data["rows"] == [1.5, None]
    assert b"NaN" not in raw and b"Infinity" not in raw


def test_normal_payload_unchanged():
    data = _payload(_sse("step", {"step": "retrieve", "status": "done", "ms": 12}))
    assert data == {"step": "retrieve", "status": "done", "ms": 12}
