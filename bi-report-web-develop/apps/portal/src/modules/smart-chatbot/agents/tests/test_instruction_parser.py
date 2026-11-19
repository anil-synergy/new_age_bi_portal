from smart_orchestrator.instruction_parser import parse_user_message


def test_sppl_means_manager():
    events = parse_user_message("sppl means technical manager")
    assert any(e.get("concept_id") == "manager_company" for e in events)


def test_use_fleet_count_report():
    catalog = [{"title": "Fleet Count Vessel Portal", "dataset_id": "6fe28c18-151c-4b05-a696-979f0906ddee"}]
    events = parse_user_message("please use Fleet Count Vessel Portal", catalog=catalog)
    assert any(e.get("chosen_title") == "Fleet Count Vessel Portal" for e in events)


def test_unrelated_chat_empty():
    assert parse_user_message("what is the weather today") == []