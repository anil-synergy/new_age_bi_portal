from smart_orchestrator.environment import EnvironmentPolicy
from smart_orchestrator.retrieval import authorize_workspace_items, enrich_menu_items, pool_for_user
from smart_orchestrator.settings import OrchestratorSettings


def _policy() -> EnvironmentPolicy:
    return EnvironmentPolicy.from_settings(OrchestratorSettings(_env_file=None))


def test_catalog_hides_workspace_models_the_user_cannot_open():
    inventory = [
        {"title": "Injury", "workspace_id": "ws", "dataset_id": "ds-secret"},
        {"title": "Injury Dashboard", "workspace_id": "ws", "dataset_id": "ds-ok", "report_id": "rep-ok"},
    ]
    catalog = [{"title": "Injury Dashboard", "workspace_id": "ws", "report_id": "rep-ok"}]
    allowed = authorize_workspace_items(inventory, catalog, catalog_unavailable=False)
    assert {item["dataset_id"] for item in allowed} == {"ds-ok"}


def test_catalog_outage_keeps_workspace_models():
    inventory = [{"title": "Injury", "workspace_id": "ws", "dataset_id": "ds-secret"}]
    allowed = authorize_workspace_items(inventory, [], catalog_unavailable=True)
    assert allowed == inventory


def test_draft_workspace_models_need_the_menu_but_production_models_do_not():
    inventory = [
        {"title": "Injury", "workspace_id": "ws", "dataset_id": "live", "source": "workspace"},
        {"title": "INJURY_REPORT_DRAFT", "workspace_id": "ws", "dataset_id": "draft", "source": "workspace"},
    ]
    pool = pool_for_user(inventory, [], _policy(), catalog_unavailable=False)
    assert [item["dataset_id"] for item in pool] == ["live"]


def test_menu_items_learn_the_model_and_workspace_from_the_inventory():
    inventory = [
        {"title": "Incident", "workspace_id": "ws", "workspace_name": "Fabric F64 - Testing ", "dataset_id": "ds", "rls_required": False, "rls_roles_required": False},
        {"title": "Incident Dashboard", "workspace_id": "ws", "workspace_name": "Fabric F64 - Testing ", "dataset_id": "ds", "report_id": "rep"},
    ]
    menu = enrich_menu_items([{"portal_id": "1", "title": "Incident Dashboard", "workspace_id": "ws", "report_id": "rep"}], inventory)
    assert menu[0]["dataset_id"] == "ds" and menu[0]["rls_required"] is False
    assert _policy().classify_item(menu[0]).environment == "DEV"
