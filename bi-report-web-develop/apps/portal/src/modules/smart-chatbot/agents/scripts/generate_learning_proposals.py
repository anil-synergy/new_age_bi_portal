"""Build draft learning proposals from analytics corrections.

    python scripts/generate_learning_proposals.py --days 14
    python scripts/generate_learning_proposals.py --days 14 --out learning/proposals/
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from smart_orchestrator.learning_model import (  # noqa: E402
    candidates_to_proposal,
    load_corrections,
    score_corrections,
)
from smart_orchestrator.settings import OrchestratorSettings  # noqa: E402

PROPOSALS = ROOT / "learning" / "proposals"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=None)
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--promote-score", type=float, default=None)
    parser.add_argument("--min-users", type=int, default=2)
    parser.add_argument("--out", type=Path, default=PROPOSALS)
    args = parser.parse_args()

    settings = OrchestratorSettings()
    db_path = args.db or Path(settings.analytics_db_path)
    since = time.time() - args.days * 86400
    rows = load_corrections(db_path, since=since)
    if not rows:
        print("No corrections in window — nothing to propose.")
        return 0

    promote = args.promote_score if args.promote_score is not None else settings.learning_promote_score
    scored = score_corrections(rows, promote_score=promote, min_users=args.min_users)
    if not scored:
        print("Corrections found but no candidates met promotion thresholds.")
        return 0

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    proposal_id = f"auto-{stamp}-{len(scored)}"
    proposal = candidates_to_proposal(scored, proposal_id=proposal_id)

    args.out.mkdir(parents=True, exist_ok=True)
    out_file = args.out / f"{proposal_id}.json"
    out_file.write_text(json.dumps(proposal, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote draft proposal {out_file} ({len(scored)} candidates)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())