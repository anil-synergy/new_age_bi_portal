"""Catch-up for the keyword index: when the server starts and the nightly run has not succeeded recently,
start one incremental run in the background.

The nightly run itself is a Windows scheduled task at 01:00 (set up with scripts/register_keyword_task.ps1,
which also sets "run as soon as possible if a start was missed", so a night when the machine was off still runs).
This module is the fallback for when the server is online and that task did not run.

The run is a separate process, so it never blocks the chat server. The lock in keyword_index prevents overlap.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from smart_common.logging import log

from .keyword_index import LOCK_STALE_S, load_state
from .settings import SemantiqSettings

logger = logging.getLogger(__name__)
AGENTS_ROOT = Path(__file__).resolve().parents[1]


def _last_success(state_dir: Path) -> datetime | None:
    raw = load_state(state_dir / "state.json").get("last_success_at")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw))
    except ValueError:
        return None


def _run_in_progress(state_dir: Path) -> bool:
    lock = state_dir / "run.lock"
    return lock.exists() and (datetime.now(timezone.utc).timestamp() - lock.stat().st_mtime) < LOCK_STALE_S


def catch_up_due(settings: SemantiqSettings, now: datetime | None = None) -> bool:
    if not settings.keyword_catch_up_enabled:
        return False  # paused (local testing)
    if not settings.pbi_configured:
        return False
    from .keyword_store import build_keyword_store

    if build_keyword_store(settings) is None:
        return False
    state_dir = Path(settings.keyword_state_dir)
    if _run_in_progress(state_dir):
        return False
    last = _last_success(state_dir)
    if last is None:
        return True  # never indexed: the first run is needed
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    return now - last >= timedelta(hours=settings.keyword_catch_up_after_h)


def start_catch_up_if_due(settings: SemantiqSettings) -> bool:
    """Start one background incremental run when due. Returns True when a run was started."""
    if not catch_up_due(settings):
        return False
    log_dir = Path(settings.keyword_state_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    kwargs: dict = {}
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
    with open(log_dir / "catch_up.log", "ab") as out:
        subprocess.Popen(
            [sys.executable, "-m", "pbi_semantiq_agent.keyword_index"],
            cwd=str(AGENTS_ROOT),
            stdout=out,
            stderr=subprocess.STDOUT,
            **kwargs,
        )
    log(logger, logging.INFO, "keyword_catch_up_started", after_h=settings.keyword_catch_up_after_h)
    return True
