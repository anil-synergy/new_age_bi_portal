from smart_orchestrator.learned_hints import LearnedHints, merge_hints
from smart_orchestrator.ontology_ranking import catalog_ontology_adjustment
from pbi_semantiq_agent.ontology import concepts_in_question


def test_thread_hints_boost_preferred_dataset():
    item = {"title": "Fleet Count Vessel Portal", "dataset_id": "6fe28c18-151c-4b05-a696-979f0906ddee"}
    hints = {"preferred_dataset_id": "6fe28c18-151c-4b05-a696-979f0906ddee"}
    q = "handymax tankers sppl oct 2026"
    base = catalog_ontology_adjustment(q, item)
    with_hints = catalog_ontology_adjustment(q, item, learned_hints=hints)
    assert with_hints > base


def test_overlay_alias_expands_concepts():
    hints = {"alias_to_concept": {"synergy fleet code": "fleet_count"}}
    found = concepts_in_question("show synergy fleet code", hints=hints)
    assert "fleet_count" in found


def test_merge_hints_from_pick():
    out = merge_hints(None, [{"kind": "preferred_report", "chosen_title": "Fleet Count Vessel Portal", "chosen_dataset_id": "abc"}])
    assert out["preferred_report_title"] == "Fleet Count Vessel Portal"
    assert LearnedHints.from_dict(out).preferred_dataset_id == "abc"