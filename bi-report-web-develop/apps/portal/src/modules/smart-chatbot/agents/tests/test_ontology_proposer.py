from __future__ import annotations

import json
from pathlib import Path

from pbi_semantiq_agent import ontology_proposer
from smart_orchestrator.learning_apply import validate_proposal


def _write_model(root: Path, ds: str, measures: list[str]) -> None:
    base = root / "workspaces" / "ws" / "semantic_models" / ds
    base.mkdir(parents=True)
    (base / "model_metadata.json").write_text("{}", encoding="utf-8")
    (base / "measures.json").write_text(json.dumps({"measures": [{"name": m} for m in measures]}), encoding="utf-8")
    (base / "columns.json").write_text(json.dumps({"columns": []}), encoding="utf-8")
    (base / "tables.json").write_text(json.dumps({"tables": []}), encoding="utf-8")


def test_proposes_aliases_seen_in_several_models_and_never_touches_live_ontology(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("PBI_METADATA_ROOT", str(tmp_path))
    live = ontology_proposer.ontology_dir()
    before = (live / "business_ontology.json").read_text(encoding="utf-8")

    _write_model(tmp_path, "ds1", ["Incident Rate", "Total Incidents", "Row ID", "Vessel Count Final"])
    _write_model(tmp_path, "ds2", ["Incident Rate", "Fleet Size"])
    _write_model(tmp_path, "ds3", ["Unrelated Thing"])

    out = ontology_proposer.propose(write=False)
    entries = {e["concept"]: e for e in out["proposal"]["ontology_add"]["aliases"]}
    assert "incident rate" in entries["incident"]["phrases"]  # in 2 datasets, matches the 'incident' concept
    assert "fleet size" not in str(entries)  # already an alias -> not re-proposed
    assert "row id" not in str(entries)  # noise word
    assert "vessel count final" not in str(entries)  # only one dataset
    assert (live / "business_ontology.json").read_text(encoding="utf-8") == before


def test_draft_cannot_be_applied_until_a_reviewer_adds_eval_cases(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("PBI_METADATA_ROOT", str(tmp_path))
    _write_model(tmp_path, "ds1", ["Incident Rate"])
    _write_model(tmp_path, "ds2", ["Incident Rate"])
    proposal = ontology_proposer.propose(write=False)["proposal"]
    errors = validate_proposal(proposal)
    assert any("eval" in e.lower() for e in errors)
