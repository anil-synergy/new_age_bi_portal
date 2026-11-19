import json
import tempfile
from pathlib import Path

from smart_orchestrator.ontology_merge import merge_ontology_files, validate_ontology_add


def test_validate_rejects_unknown_concept():
    ontology = {"concepts": [{"id": "fleet_count"}]}
    errors = validate_ontology_add(ontology, {"aliases": [{"concept": "not_a_concept", "phrases": ["foo"]}]})
    assert errors


def test_merge_adds_alias_only():
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        onto = {
            "version": "0",
            "concepts": [{"id": "manager_company", "aliases": ["sppl"], "definition": "mgr"}],
        }
        (base / "business_ontology.json").write_text(json.dumps(onto), encoding="utf-8")
        (base / "business_aliases.json").write_text('{"version":"0","aliases":{}}', encoding="utf-8")
        (base / "business_rules.json").write_text('{"version":"0","rules":[]}', encoding="utf-8")
        merge_ontology_files(
            base,
            {"aliases": [{"concept": "manager_company", "phrases": ["synergy sppl"]}]},
            sync_packaged=False,
        )
        merged = json.loads((base / "business_ontology.json").read_text(encoding="utf-8"))
        assert "synergy sppl" in merged["concepts"][0]["aliases"]