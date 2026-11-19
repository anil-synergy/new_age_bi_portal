from smart_orchestrator.catalog_match import pick_report, rank_reports


def test_picks_incident_report_from_menu():
    catalog = [
        {"portal_id": "1", "title": "Fleet Overview", "menu_path": "Fleet", "workspace_id": "w1", "report_id": "r1"},
        {
            "portal_id": "2",
            "title": "Incident Dashboard",
            "menu_path": "Safety Reporting > Incident",
            "workspace_id": "w2",
            "dataset_id": "d2",
        },
    ]
    picked = pick_report("give me incidents count", catalog)
    assert picked is not None
    assert picked["portal_id"] == "2"


def test_ambiguous_returns_none():
    catalog = [
        {"portal_id": "1", "title": "Spend A", "menu_path": "Procurement", "workspace_id": "w", "dataset_id": "d1"},
        {"portal_id": "2", "title": "Spend B", "menu_path": "Procurement", "workspace_id": "w", "dataset_id": "d2"},
    ]
    assert pick_report("total spend", catalog) is None


def test_date_words_do_not_pull_in_an_unrelated_model():
    catalog = [
        {"title": "October Sludge", "workspace_id": "w", "dataset_id": "sludge"},
        {"title": "Injury", "workspace_id": "w", "dataset_id": "live"},
        {"title": "INJURY_REPORT_DRAFT", "workspace_id": "w", "dataset_id": "draft"},
    ]
    ranked = rank_reports("how many injuries on oct 12th 2026", catalog)
    assert [item["dataset_id"] for item in ranked] == ["live"]


def test_injuries_matches_the_injury_model_not_the_draft():
    catalog = [
        {"title": "INJURY_REPORT_DRAFT", "workspace_id": "w", "dataset_id": "draft"},
        {"title": "Safety Statistics", "workspace_id": "w", "dataset_id": "safety"},
        {"title": "Injury", "workspace_id": "w", "dataset_id": "live"},
        {"title": "Incident", "workspace_id": "w", "dataset_id": "incident"},
    ]
    picked = pick_report("is there any injuries in last 1 day?", catalog, prefer_best=True)
    assert picked is not None
    assert picked["dataset_id"] == "live"


def test_rank_keeps_later_injury_models():
    catalog = [
        {"title": "Injury Archive", "workspace_id": "w", "dataset_id": "old"},
        {"title": "Injury", "workspace_id": "w", "dataset_id": "live"},
    ]
    ranked = rank_reports("18th Oct to 24th Oct 2026 - Injury Count can u give me", catalog)
    assert [item["dataset_id"] for item in ranked] == ["live"]


def test_five_injury_models_stay_on_the_plain_injury_model():
    catalog = [
        {"title": "INJURY_REPORT_DRAFT", "workspace_id": "w", "dataset_id": "draft"},
        {"title": "Injury Archive", "workspace_id": "w", "dataset_id": "archive"},
        {"title": "Injury Statistics", "workspace_id": "w", "dataset_id": "stats"},
        {"title": "Injury Summary", "workspace_id": "w", "dataset_id": "summary"},
        {"title": "Injury", "workspace_id": "w", "dataset_id": "live"},
    ]
    ranked = rank_reports("how many injuries on oct 12th 2026", catalog)
    assert [item["dataset_id"] for item in ranked] == ["live"]


def test_user_can_name_the_draft_model():
    catalog = [
        {"title": "Injury", "workspace_id": "w", "dataset_id": "live"},
        {"title": "INJURY_REPORT_DRAFT", "workspace_id": "w", "dataset_id": "draft"},
    ]
    ranked = rank_reports("how many injuries in the draft report on oct 12th 2026", catalog)
    assert [item["dataset_id"] for item in ranked] == ["draft"]
