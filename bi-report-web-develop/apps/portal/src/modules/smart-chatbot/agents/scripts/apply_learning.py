"""Apply a reviewed learning proposal. Nothing reaches production without this script.

    python scripts/apply_learning.py learning/proposals/pr-synonyms.json --approved-by reviewer@company.com
    python scripts/apply_learning.py learning/proposals/pr-synonyms.json --approved-by reviewer@company.com --apply

Proposal file may include optional ontology_add (aliases, business_aliases, rules_patch).

Gates: the approver must differ from the author; the proposal must add at least one evaluation
case; on the extended evaluation set there must be no non-production leaks, accuracy must reach
--min-accuracy and must not drop below the current configuration. Without --apply this is a
dry run. With --apply the glossary, evaluation set, and ontology (when present) are updated.
Setting changes are printed, not written. Every run is written to learning/audit/.
Prompts are never changed by this script.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from retrieval_eval import DEFAULT_CASES  # noqa: E402

from smart_orchestrator.learning_apply import apply_proposal  # noqa: E402
from smart_orchestrator.query_norm import default_glossary_path  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("proposal", type=Path)
    parser.add_argument("--approved-by", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--min-accuracy", type=float, default=0.9)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--glossary", type=Path, default=default_glossary_path())
    parser.add_argument("--no-sync-packaged", action="store_true")
    args = parser.parse_args()

    proposal = json.loads(args.proposal.read_text(encoding="utf-8"))
    audit = apply_proposal(
        proposal,
        approved_by=args.approved_by,
        apply_writes=args.apply,
        min_accuracy=args.min_accuracy,
        glossary_path=args.glossary,
        cases_path=args.cases,
        sync_packaged=not args.no_sync_packaged,
    )
    errors = audit.get("errors") or []

    if errors:
        print("Rejected:\n  " + "\n  ".join(errors))
    elif args.apply:
        print(f"Applied. Glossary version {audit.get('glossary_version')}. Restart the orchestrator to load it.")
        if audit.get("ontology_version"):
            print(f"Ontology version {audit['ontology_version']}.")
    else:
        print("Checks passed (dry run). Re-run with --apply to write glossary, eval, and ontology.")
    if "candidate" in audit:
        print(f"Baseline {audit.get('baseline')}\nCandidate {audit.get('candidate')}")
    if proposal.get("settings") and not errors:
        print("Deploy these settings through the environment configuration:")
        for name, value in proposal["settings"].items():
            print(f"  {name.upper()}={value}")
    print(f"Audit: {audit.get('audit_file')}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())