from smart_orchestrator.ontology_ranking import catalog_hard_veto, catalog_ontology_adjustment, question_signals


def test_fleet_count_boosts_vessel_portal_title():
    question = "Handymax SPPL Oct 2026 fleet count vessel portal"
    signals = question_signals(question)
    assert signals["fleet_count_intent"]
    item = {"title": "Fleet Count Vessel Portal", "dataset_id": "6fe28c18-151c-4b05-a696-979f0906ddee", "workspace_id": "0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd"}
    assert catalog_ontology_adjustment(question, item) > 0.4


def test_tanker_title_penalty_with_fleet_intent():
    question = "How many tankers Handymax SPPL fleet size Oct 2026"
    item = {"title": "Maersk Tankers MBR", "dataset_id": "x", "workspace_id": "y"}
    assert catalog_ontology_adjustment(question, item) < 0


def test_handymax_tankers_oct2026_fleet_intent():
    question = "find no of handymax tankers in sppl for the month oct2026"
    signals = question_signals(question)
    assert signals["fleet_count_intent"]
    assert not signals["tanker_token_only"]
    portal = {
        "title": "Fleet-Count-Vessel Portal",
        "dataset_id": "6fe28c18-151c-4b05-a696-979f0906ddee",
        "workspace_id": "0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd",
    }
    maersk = {"title": "MBR - Maersk Tankers", "dataset_id": "other", "workspace_id": "ws"}
    assert catalog_ontology_adjustment(question, portal) > 0.5
    assert catalog_ontology_adjustment(question, maersk) < 0
    assert catalog_hard_veto(question, maersk)


def test_no_of_incidents_not_fleet_intent():
    signals = question_signals("no of incidents for november 2026")
    assert signals["incident_intent"]
    assert not signals["fleet_count_intent"]
