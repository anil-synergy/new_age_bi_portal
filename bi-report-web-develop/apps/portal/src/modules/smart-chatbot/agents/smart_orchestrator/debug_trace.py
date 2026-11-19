"""Session debug NDJSON logger (debug mode)."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

_SESSION = "5489de"


def _log_path() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "apps" / "portal").is_dir():
            return parent / "debug-5489de.log"
    return Path("debug-5489de.log")


def debug_log(*, hypothesis_id: str, location: str, message: str, data: dict[str, Any] | None = None, run_id: str = "pre-fix") -> None:
    # region agent log
    try:
        payload = {
            "sessionId": _SESSION,
            "hypothesisId": hypothesis_id,
            "location": location,
            "message": message,
            "data": data or {},
            "timestamp": int(time.time() * 1000),
            "runId": run_id,
        }
        path = _log_path()
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        pass
    # endregion
