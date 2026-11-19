"""Interaction, feedback and failure-pattern analytics (SQLite, written off the event loop).

Nothing here changes runtime behaviour. Reviewers read it through scripts/learning_review.py;
changes to synonyms, weights or routing go through scripts/apply_learning.py, which needs an
evaluation pass and a named approver.

Users are stored as a SHA-256 hash of the lower-cased email. Questions are stored so that
retrieval misses can be reviewed; rows are never shared across users through the API.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import sqlite3
import threading
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from smart_common.logging import log

from .query_norm import content_tokens

logger = logging.getLogger(__name__)

# Outcome -> likely cause when the same question keeps coming back.
CAUSES = {
    "retrieval_miss": "retrieval",
    "model_choice": "retrieval",
    "unanswerable": "routing",
    "clarification": "routing",
    "clarification_loop": "routing",
    "invalid_dax": "dax",
    "failed": "dax",
    "low_confidence": "response_quality",
    "answered": "response_quality",
    "answered_cached": "response_quality",
}
UNRESOLVED = frozenset({"retrieval_miss", "model_choice", "unanswerable", "clarification", "clarification_loop", "invalid_dax", "failed", "low_confidence"})
FEEDBACK_REASONS = ("wrong_report", "wrong_number", "missing_data", "slow", "unclear", "other")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY, ts REAL NOT NULL, user_hash TEXT NOT NULL, conversation TEXT NOT NULL,
  question TEXT NOT NULL, intent TEXT, outcome TEXT NOT NULL, dataset_key TEXT, model_title TEXT,
  environment TEXT, cache_hit INTEGER NOT NULL DEFAULT 0, confidence REAL, retrieval TEXT, timings TEXT,
  repeat_of TEXT
);
CREATE INDEX IF NOT EXISTS ix_interactions_outcome ON interactions(outcome, ts);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, interaction_id TEXT NOT NULL, ts REAL NOT NULL, user_hash TEXT NOT NULL,
  rating INTEGER NOT NULL, reason TEXT, comment TEXT,
  UNIQUE(interaction_id, user_hash)
);
CREATE TABLE IF NOT EXISTS failure_patterns (
  id TEXT PRIMARY KEY, ts REAL NOT NULL, user_hash TEXT NOT NULL, conversation TEXT NOT NULL,
  cause TEXT NOT NULL, occurrences INTEGER NOT NULL, outcomes TEXT NOT NULL, questions TEXT NOT NULL,
  first_interaction TEXT, last_interaction TEXT
);
CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY, ts REAL NOT NULL, user_hash TEXT NOT NULL, interaction_id TEXT,
  conversation TEXT, source TEXT NOT NULL, question TEXT, phrase TEXT, concept_id TEXT,
  chosen_title TEXT, chosen_dataset_id TEXT, reason TEXT, detail TEXT
);
CREATE INDEX IF NOT EXISTS ix_corrections_ts ON corrections(ts);
"""


def user_hash(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


@dataclass
class Turn:
    interaction_id: str
    tokens: frozenset[str]
    outcome: str
    question: str


class RepeatDetector:
    """Per-conversation memory of recent questions, used to spot rephrased repeats."""

    def __init__(self, *, similarity: float, window: int, max_conversations: int = 5000):
        self.similarity = similarity
        self.window = window
        self.max_conversations = max_conversations
        self._turns: dict[str, deque[Turn]] = defaultdict(lambda: deque(maxlen=self.window))
        self._lock = threading.Lock()

    @staticmethod
    def _similar(a: frozenset[str], b: frozenset[str]) -> float:
        if not a or not b:
            return 0.0
        return len(a & b) / len(a | b)

    def observe(self, conversation: str, interaction_id: str, question: str, outcome: str) -> list[Turn]:
        """Record a turn; return the earlier turns it repeats (most recent first)."""
        tokens = frozenset(content_tokens(question, drop_time=False))
        with self._lock:
            history = self._turns[conversation]
            repeats = [t for t in reversed(history) if self._similar(tokens, t.tokens) >= self.similarity]
            history.append(Turn(interaction_id, tokens, outcome, question))
            if len(self._turns) > self.max_conversations:
                self._turns.pop(next(iter(self._turns)))
        return repeats


class Analytics:
    def __init__(self, path: str, *, repeat_similarity: float, repeat_window: int):
        self.path = path
        self.repeats = RepeatDetector(similarity=repeat_similarity, window=repeat_window)
        self._lock = threading.Lock()
        self._ready = False
        self.enabled = bool(path)

    def _connect(self) -> sqlite3.Connection:
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        if not self._ready:
            conn.executescript(_SCHEMA)
            self._ready = True
        return conn

    def _write(self, sql: str, params: tuple) -> int:
        with self._lock:
            conn = self._connect()
            try:
                cur = conn.execute(sql, params)
                conn.commit()
                return cur.rowcount
            finally:
                conn.close()

    def _read(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        with self._lock:
            conn = self._connect()
            try:
                return [dict(row) for row in conn.execute(sql, params).fetchall()]
            finally:
                conn.close()

    async def record(
        self,
        *,
        interaction_id: str,
        user_email: str,
        conversation: str,
        question: str,
        intent: str,
        outcome: str,
        dataset_key: str | None,
        model_title: str | None,
        environment: str | None,
        cache_hit: bool,
        confidence: float | None,
        retrieval: dict[str, Any] | None,
        timings: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Store the turn; returns a failure pattern when the user keeps asking the same thing unresolved."""
        thread = f"{user_hash(user_email)}:{conversation}"
        repeats = self.repeats.observe(thread, interaction_id, question, outcome) if intent in ("data_question", "schema_question") else []
        pattern: dict[str, Any] | None = None
        if repeats and (repeats[0].outcome in UNRESOLVED or outcome in UNRESOLVED):
            outcomes = [t.outcome for t in repeats[::-1]] + [outcome]
            unresolved = [o for o in outcomes if o in UNRESOLVED] or outcomes
            cause = CAUSES.get(unresolved[-1], "response_quality")
            pattern = {
                "id": uuid.uuid4().hex,
                "cause": cause,
                "occurrences": len(outcomes),
                "outcomes": outcomes,
                "questions": [t.question for t in repeats[::-1]] + [question],
                "first_interaction": repeats[-1].interaction_id,
            }
        if not self.enabled:
            return pattern
        try:
            await asyncio.to_thread(
                self._write,
                "INSERT OR REPLACE INTO interactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    interaction_id, time.time(), user_hash(user_email), conversation, question[:2000], intent, outcome,
                    dataset_key, (model_title or "")[:300], environment, int(cache_hit), confidence,
                    json.dumps(retrieval or {}, default=str)[:8000], json.dumps(timings or {}, default=str)[:2000],
                    repeats[0].interaction_id if repeats else None,
                ),
            )
            if pattern:
                await asyncio.to_thread(
                    self._write,
                    "INSERT INTO failure_patterns VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (
                        pattern["id"], time.time(), user_hash(user_email), conversation, pattern["cause"], pattern["occurrences"],
                        json.dumps(pattern["outcomes"]), json.dumps([q[:500] for q in pattern["questions"]]),
                        pattern["first_interaction"], interaction_id,
                    ),
                )
        except sqlite3.Error as exc:
            log(logger, logging.WARNING, "analytics_write_failed", error=str(exc)[:200])
        if pattern:
            log(logger, logging.WARNING, "repeated_unresolved_question", cause=pattern["cause"], occurrences=pattern["occurrences"], outcomes=pattern["outcomes"])
        return pattern

    async def feedback(self, *, interaction_id: str, user_email: str, rating: int, reason: str | None, comment: str | None) -> bool:
        """Store thumbs up/down. Only the user who asked the question can rate it."""
        if not self.enabled:
            return False
        owner = await asyncio.to_thread(self._read, "SELECT user_hash FROM interactions WHERE id = ?", (interaction_id,))
        if not owner or owner[0]["user_hash"] != user_hash(user_email):
            return False
        await asyncio.to_thread(
            self._write,
            "INSERT INTO feedback VALUES (?,?,?,?,?,?,?) ON CONFLICT(interaction_id, user_hash) DO UPDATE SET "
            "ts = excluded.ts, rating = excluded.rating, reason = excluded.reason, comment = excluded.comment",
            (uuid.uuid4().hex, interaction_id, time.time(), user_hash(user_email), 1 if rating > 0 else -1, reason, (comment or "")[:1000] or None),
        )
        return True

    async def get_interaction(self, interaction_id: str) -> dict[str, Any] | None:
        rows = await self.query("SELECT * FROM interactions WHERE id = ?", (interaction_id,))
        return rows[0] if rows else None

    async def record_correction(
        self,
        *,
        user_email: str,
        source: str,
        question: str,
        interaction_id: str | None = None,
        conversation: str | None = None,
        phrase: str | None = None,
        concept_id: str | None = None,
        chosen_title: str | None = None,
        chosen_dataset_id: str | None = None,
        reason: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        if not self.enabled:
            return
        try:
            await asyncio.to_thread(
                self._write,
                "INSERT INTO corrections VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    uuid.uuid4().hex,
                    time.time(),
                    user_hash(user_email),
                    interaction_id,
                    conversation,
                    source[:64],
                    (question or "")[:2000],
                    (phrase or "")[:200] or None,
                    (concept_id or "")[:80] or None,
                    (chosen_title or "")[:300] or None,
                    (chosen_dataset_id or "")[:64] or None,
                    (reason or "")[:64] or None,
                    json.dumps(detail or {}, default=str)[:4000] or None,
                ),
            )
        except sqlite3.Error as exc:
            log(logger, logging.WARNING, "correction_write_failed", error=str(exc)[:200])

    async def query(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._read, sql, params)
