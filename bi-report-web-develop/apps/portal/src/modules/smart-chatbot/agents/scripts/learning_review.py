"""Summarise SMART feedback and failures for human review. Read-only.

    python scripts/learning_review.py --days 14
    python scripts/learning_review.py --db .data/smart_analytics.db --out learning/reviews/2026-11.json

The report lists outcome counts, down-voted answers with reasons, repeated unresolved questions
by cause (retrieval, routing, dax, response_quality), and frequent words in unmatched questions
that the glossary does not know (candidate synonyms). Nothing is changed: proposals go through
scripts/apply_learning.py, which needs an approver and a passing evaluation.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from smart_orchestrator.analytics import UNRESOLVED  # noqa: E402
from smart_orchestrator.learning_model import load_corrections, score_corrections  # noqa: E402
from smart_orchestrator.query_norm import AGGREGATE_WORDS, content_tokens, default_glossary_path, load_glossary  # noqa: E402
from smart_orchestrator.settings import OrchestratorSettings  # noqa: E402


def _rows(db: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    db.row_factory = sqlite3.Row
    return [dict(r) for r in db.execute(sql, params).fetchall()]


def review(db_path: Path, days: int, glossary_path: Path, top: int) -> dict:
    since = time.time() - days * 86400
    glossary = load_glossary(str(glossary_path))
    with sqlite3.connect(db_path) as db:
        outcomes = _rows(db, "SELECT outcome, COUNT(*) n FROM interactions WHERE ts >= ? GROUP BY outcome ORDER BY n DESC", (since,))
        environments = _rows(db, "SELECT COALESCE(environment,'-') environment, COUNT(*) n FROM interactions WHERE ts >= ? GROUP BY 1", (since,))
        cache = _rows(db, "SELECT SUM(cache_hit) hits, COUNT(*) total FROM interactions WHERE ts >= ? AND outcome LIKE 'answered%'", (since,))
        downvotes = _rows(
            db,
            "SELECT f.reason, f.comment, i.question, i.model_title, i.environment, i.outcome FROM feedback f "
            "JOIN interactions i ON i.id = f.interaction_id WHERE f.rating < 0 AND f.ts >= ? ORDER BY f.ts DESC LIMIT ?",
            (since, top),
        )
        ratings = _rows(db, "SELECT rating, COUNT(*) n FROM feedback WHERE ts >= ? GROUP BY rating", (since,))
        patterns = _rows(
            db,
            "SELECT cause, occurrences, outcomes, questions FROM failure_patterns WHERE ts >= ? ORDER BY occurrences DESC, ts DESC LIMIT ?",
            (since, top),
        )
        unresolved = _rows(
            db,
            f"SELECT question FROM interactions WHERE ts >= ? AND outcome IN ({','.join('?' * len(UNRESOLVED))})",
            (since, *sorted(UNRESOLVED)),
        )
    known = {t for term in glossary.terms for phrase in (term.term, *term.synonyms) for t in content_tokens(phrase, drop_time=False)}
    words = Counter(
        t
        for row in unresolved
        for t in set(content_tokens(row["question"], drop_generic=True))
        if t not in known and t not in AGGREGATE_WORDS and not t.isdigit()
    )
    by_cause = Counter(p["cause"] for p in patterns)
    for p in patterns:
        p["outcomes"] = json.loads(p["outcomes"])
        p["questions"] = json.loads(p["questions"])
    settings = OrchestratorSettings()
    corrections = load_corrections(db_path, since=since)
    candidates = [
        {"kind": c.kind, "score": c.score, "users": c.users, "payload": c.payload}
        for c in score_corrections(corrections, promote_score=settings.learning_promote_score)
    ]
    return {
        "window_days": days,
        "glossary_version": glossary.version,
        "outcomes": outcomes,
        "environments": environments,
        "cache": cache[0] if cache else {},
        "ratings": {("up" if r["rating"] > 0 else "down"): r["n"] for r in ratings},
        "downvoted": downvotes,
        "repeated_failures_by_cause": dict(by_cause),
        "repeated_failures": patterns,
        "candidate_synonym_words": words.most_common(top),
        "correction_candidates": candidates,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=None, help="defaults to ANALYTICS_DB_PATH")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--top", type=int, default=25)
    parser.add_argument("--glossary", type=Path, default=default_glossary_path())
    parser.add_argument("--out", type=Path, default=None, help="write the JSON report here instead of stdout")
    args = parser.parse_args()
    db_path = args.db or Path(OrchestratorSettings().analytics_db_path)
    if not db_path.is_file():
        print(f"No analytics database at {db_path}", file=sys.stderr)
        return 1
    report = json.dumps(review(db_path, args.days, args.glossary, args.top), indent=2, default=str)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(report, encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
