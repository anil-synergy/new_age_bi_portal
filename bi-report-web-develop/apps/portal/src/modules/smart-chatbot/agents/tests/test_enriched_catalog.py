from pbi_semantiq_agent.inventory_loader import enriched_search_text, load_enriched_inventory


def test_enriched_inventory_loads():
    index = load_enriched_inventory()
    assert index, "semantic_model_catalog_enriched.jsonl should be present under pbi_semantiq_agent"
    fleet = index.get(("0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd", "6fe28c18-151c-4b05-a696-979f0906ddee"))
    assert fleet
    blob = enriched_search_text(fleet).lower()
    assert "fleet operations" in blob
    assert "vessel" in blob


def test_catalog_disk_enriched_search_blob():
    from pbi_semantiq_agent.catalog_disk import get_catalog_store

    store = get_catalog_store()
    text = store.enriched_text("0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd", "6fe28c18-151c-4b05-a696-979f0906ddee")
    assert "fleet operations" in text.lower()
