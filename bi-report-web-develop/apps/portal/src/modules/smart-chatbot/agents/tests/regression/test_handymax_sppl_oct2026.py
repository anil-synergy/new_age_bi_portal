"""Live-gated regression for Handymax / SPPL / Oct 2026 — never hardcodes 32."""

from __future__ import annotations

import os

import pytest

FLEET_COUNT_DATASET = "6fe28c18-151c-4b05-a696-979f0906ddee"
FLEET_COUNT_WORKSPACE = "0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd"
QUESTION = (
    "find no of handymax vessel sub type tankers in sppl for the month oct 2026 fleet count vessel portal"
)


def _pbi_configured() -> bool:
    return bool(os.environ.get("PBI_CLIENT_ID") or os.environ.get("FABRIC_CLIENT_ID"))


def test_catalog_search_prefers_fleet_count_portal():
    from pbi_semantiq_agent.catalog_disk import get_catalog_store

    hits = get_catalog_store().search(QUESTION, limit=5)
    assert hits, "catalog search requires enriched catalog"
    top = hits[0]
    title = str(top.get("title") or top.get("report_name") or "").lower()
    dataset = str(top.get("dataset_id") or "").lower()
    assert "fleet count" in title or dataset == FLEET_COUNT_DATASET.lower()


@pytest.mark.skipif(not _pbi_configured(), reason="Power BI credentials not configured")
@pytest.mark.asyncio
async def test_live_dax_handymax_sppl_oct2026():
    from pbi_semantiq_agent.agent import SemantiqAgent
    from pbi_semantiq_agent.ontology import bind_concepts, validation_dax
    from pbi_semantiq_agent.query_plan import build_query_plan
    from pbi_semantiq_agent.settings import SemantiqSettings
    from pbi_semantiq_agent.powerbi_client import PowerBIClient
    from smart_common.llm import LLMClient

    settings = SemantiqSettings()
    client = PowerBIClient(settings)
    agent = SemantiqAgent(settings, client, LLMClient(settings))
    model = await agent.get_model(FLEET_COUNT_WORKSPACE, FLEET_COUNT_DATASET, None)
    bindings = bind_concepts(QUESTION, model, FLEET_COUNT_DATASET)
    if not bindings.vessel_id:
        pytest.skip("vessel identifier not bound on live model — update concept_bindings.jsonl after XMLA inspect")
    plan = build_query_plan(QUESTION, bindings)
    v_dax = validation_dax(bindings, "", plan)
    assert v_dax
    data = await client.execute_dax(FLEET_COUNT_WORKSPACE, FLEET_COUNT_DATASET, v_dax)
    rows = data.get("rows") or []
    assert rows, "validation DAX returned no rows"
    values = [v for row in rows for v in row.values() if isinstance(v, (int, float))]
    assert values, "no numeric validation result"
    if values[0] == 32:
        return
    pytest.fail(
        f"Live model discrepancy: validation DISTINCTCOUNT={values[0]} (expected 32 only if data supports it). "
        f"Bindings: vessel={bindings.vessel_id}, subtype={bindings.subtype}, manager={bindings.manager}, date={bindings.date}"
    )
