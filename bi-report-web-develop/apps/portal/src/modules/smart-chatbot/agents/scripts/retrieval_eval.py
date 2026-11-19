"""Offline retrieval evaluation.

    python scripts/retrieval_eval.py                       # current settings and glossary
    python scripts/retrieval_eval.py --glossary new.json   # a proposed glossary
    python scripts/retrieval_eval.py --set RETRIEVAL_SELECT_MARGIN=0.1

Cases give "expect" (the model to select or offer first), "expect_options" (the user must be asked
to choose between exactly these), or neither (no model should match).
Metrics: accuracy, non-production
leaks (a DEV/ARCHIVE model chosen when the case does not allow it; must be 0), ask rate.
Exit code 1 when any leak occurs or accuracy is below --min-accuracy.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from smart_orchestrator.embeddings import HashingEmbedder  # noqa: E402
from smart_orchestrator.environment import PROD, EnvironmentPolicy  # noqa: E402
from smart_orchestrator.hybrid_index import HybridIndex  # noqa: E402
from smart_orchestrator.query_norm import Glossary, default_glossary_path  # noqa: E402
from smart_orchestrator.ranking import CatalogRetriever  # noqa: E402
from smart_orchestrator.settings import OrchestratorSettings  # noqa: E402

DEFAULT_CASES = ROOT / "learning" / "eval" / "retrieval_cases.json"


def _catalog(raw: list[dict]) -> list[dict]:
    items = []
    for i, entry in enumerate(raw):
        items.append(
            {
                "title": entry["title"],
                "workspace_id": f"ws-{entry.get('workspace_name', 'default')}".lower().replace(" ", "-"),
                "workspace_name": entry.get("workspace_name"),
                "menu_path": entry.get("menu_path") or entry.get("workspace_name"),
                "description": entry.get("description"),
                "dataset_id": f"ds-{i}",
                "source": "workspace",
            }
        )
    return items


async def evaluate(cases_path: Path, glossary_path: Path, overrides: dict[str, str]) -> dict:
    settings = OrchestratorSettings(_env_file=None, **{k.lower(): v for k, v in overrides.items()})
    data = json.loads(cases_path.read_text(encoding="utf-8"))
    catalog = _catalog(data["catalog"])
    retriever = CatalogRetriever(
        settings,
        index=HybridIndex(HashingEmbedder(settings.embedding_dimensions)),
        policy=EnvironmentPolicy.from_settings(settings),
        glossary=Glossary.load(glossary_path),
    )
    rows, correct, leaks, asks = [], 0, 0, 0
    for case in data["cases"]:
        decision = await retriever.retrieve(case["question"], catalog)
        chosen = decision.selected or (decision.options[0] if decision.options else None)
        got = chosen.title if chosen else None
        if case.get("expect_options"):
            got = ", ".join(c.title for c in decision.options) or got
            ok = decision.action == "ask" and {c.title for c in decision.options} == set(case["expect_options"])
        elif case.get("expect"):
            ok = got == case["expect"]
        else:
            ok = decision.action == "none"
        leak = bool(decision.selected and decision.selected.environment != PROD and not case.get("allow_nonprod"))
        correct += ok
        leaks += leak
        asks += decision.action == "ask"
        rows.append({"question": case["question"], "expect": case.get("expect"), "got": got, "action": decision.action, "reason": decision.reason, "ok": ok, "leak": leak})
    total = len(data["cases"]) or 1
    return {
        "cases": len(data["cases"]),
        "accuracy": round(correct / total, 3),
        "nonprod_leaks": leaks,
        "ask_rate": round(asks / total, 3),
        "glossary_version": Glossary.load(glossary_path).version,
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--glossary", type=Path, default=default_glossary_path())
    parser.add_argument("--set", action="append", default=[], metavar="NAME=VALUE", help="override a setting for this run")
    parser.add_argument("--min-accuracy", type=float, default=0.9)
    parser.add_argument("--json", action="store_true", help="print the full JSON report")
    args = parser.parse_args()
    overrides = dict(item.split("=", 1) for item in args.set)
    report = asyncio.run(evaluate(args.cases, args.glossary, overrides))
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for row in report["rows"]:
            mark = "ok  " if row["ok"] and not row["leak"] else "FAIL"
            print(f"{mark} {row['question'][:55]:55} -> {row['got']} ({row['action']}/{row['reason']})")
        print(f"\naccuracy {report['accuracy']:.1%}  non-production leaks {report['nonprod_leaks']}  ask rate {report['ask_rate']:.1%}")
    return 0 if report["nonprod_leaks"] == 0 and report["accuracy"] >= args.min_accuracy else 1


if __name__ == "__main__":
    raise SystemExit(main())
