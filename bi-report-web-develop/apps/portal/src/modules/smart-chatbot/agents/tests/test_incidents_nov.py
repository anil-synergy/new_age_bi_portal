from __future__ import annotations

from pbi_semantiq_agent.metadata import Column, Measure, Table
from tests.test_semantiq_agent import GOOD, _agent


async def test_incidents_november_2026(model):
    model.tables.append(
        Table(
            "Incidents",
            columns=[Column("DATE_OF_INCIDENT", data_type="DateTime"), Column("IncidentId")],
            measures=[Measure("Incident Count", "Incidents", expression="COUNT(Incidents[IncidentId])")],
        )
    )
    dax = (
        "EVALUATE ROW(\"Incidents\", "
        "CALCULATE([Incident Count], MONTH('Incidents'[DATE_OF_INCIDENT])=11, YEAR('Incidents'[DATE_OF_INCIDENT])=2026))"
    )
    plan = {**GOOD, "dax": dax, "result_description": "incident count"}
    agent, client = _agent(model, __import__("tests.conftest", fromlist=["FakeLLM"]).FakeLLM({"DaxPlan": [plan]}))
    client.rows = [{"Incidents": 42}]
    result = await agent.answer("incidents for november 2026", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "ok", result
    assert "2026" in (result.get("dax") or "")


async def test_incidents_unfiltered_dax_blocked_then_fixed(model):
    from tests.conftest import FakeLLM

    model.tables.append(
        Table(
            "Incidents",
            columns=[Column("DATE_OF_INCIDENT", data_type="DateTime"), Column("IncidentId")],
            measures=[Measure("Incident Count", "Incidents", expression="COUNT(Incidents[IncidentId])")],
        )
    )
    bad = {**GOOD, "dax": 'EVALUATE ROW("Incidents", [Incident Count])', "result_description": "all incidents"}
    good_dax = (
        "EVALUATE ROW(\"Incidents\", "
        "CALCULATE([Incident Count], MONTH('Incidents'[DATE_OF_INCIDENT])=11, YEAR('Incidents'[DATE_OF_INCIDENT])=2026))"
    )
    good = {**GOOD, "dax": good_dax, "result_description": "incident count"}
    agent, client = _agent(model, FakeLLM({"DaxPlan": [bad, good]}))
    client.rows = [{"Incidents": 4}]
    result = await agent.answer("incidents for november 2026", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "ok", result
    assert result["rows"][0]["Incidents"] == 4
