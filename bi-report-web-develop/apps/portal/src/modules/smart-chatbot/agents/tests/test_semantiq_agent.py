"""SemantIQ sub-graph with a fake Power BI client and a fake LLM."""

from __future__ import annotations

import asyncio
from typing import Any

from pbi_semantiq_agent.agent import SemantiqAgent
from pbi_semantiq_agent.metadata import search, select_slice
from pbi_semantiq_agent.powerbi_client import PowerBIError
from pbi_semantiq_agent.settings import SemantiqSettings
from tests.conftest import FakeLLM


class FakePowerBI:
    def __init__(self, rows: list[dict[str, Any]] | None = None, fail_first: bool = False):
        self.rows = rows if rows is not None else [{"Vendor Name": "Acme", "Spend": 412000}]
        self.fail_first = fail_first
        self.queries: list[tuple[str, str | None]] = []

    async def execute_dax(self, workspace_id, dataset_id, dax, *, impersonated_user=None):
        self.queries.append((dax, impersonated_user))
        if self.fail_first and len(self.queries) == 1:
            raise PowerBIError("DAX query failed", detail="Function SUMX expects a table")
        return {"columns": list(self.rows[0]) if self.rows else [], "rows": self.rows}


def _agent(model, llm, client=None) -> tuple[SemantiqAgent, FakePowerBI]:
    client = client or FakePowerBI()
    agent = SemantiqAgent(SemantiqSettings(_env_file=None, pbi_max_rows=100), client, llm)  # type: ignore[arg-type]

    async def get_model(*_: Any) -> Any:
        return model

    agent.get_model = get_model  # type: ignore[method-assign]
    return agent, client


GOOD = {"intent": "clear", "dax": "EVALUATE SUMMARIZECOLUMNS('Vendor'[Vendor Name], \"Spend\", [Spend])", "result_description": "vendor, spend"}


async def test_answer_runs_with_row_cap(model):
    agent, client = _agent(model, FakeLLM({"DaxPlan": [GOOD]}))
    result = await agent.answer("spend by vendor", "ws-1", "ds-1", "user@example.com")
    assert result["status"] == "ok"
    assert result["rows"] == [{"Vendor Name": "Acme", "Spend": 412000}]
    assert result["confidence_components"] == {"schema_match": 1.0, "query_success": 1.0, "intent_clarity": 1.0}
    executed, user = client.queries[0]
    assert user is None and "TOPN(101," in executed


async def test_hallucinated_measure_is_repaired(model):
    bad = {"intent": "clear", "dax": "EVALUATE ROW(\"x\", [Total Cost])"}
    llm = FakeLLM({"DaxPlan": [bad, GOOD]})
    agent, client = _agent(model, llm)
    result = await agent.answer("total cost", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "ok" and result["attempts"] == 2
    assert "PREVIOUS_ERROR" in llm.calls[1][1] and "Total Cost" in llm.calls[1][1]
    assert len(client.queries) == 1  # the invalid query never reached Power BI


async def test_gives_up_after_one_repair(model):
    bad = {"intent": "clear", "dax": "EVALUATE ROW(\"x\", [Total Cost])"}
    agent, client = _agent(model, FakeLLM({"DaxPlan": [bad, bad]}))
    result = await agent.answer("total cost", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "query_failed" and result["candidates"]
    assert client.queries == []


async def test_power_bi_error_triggers_repair(model):
    agent, client = _agent(model, FakeLLM({"DaxPlan": [GOOD, GOOD]}), FakePowerBI(fail_first=True))
    result = await agent.answer("spend by vendor", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "ok" and len(client.queries) == 2


async def test_missing_date_refusal_retries_with_the_calendar_filter(model):
    refused = {
        "intent": "unanswerable",
        "missing": "The schema has no date or time column to filter injuries to the last 1 day.",
        "dax": "",
    }
    agent, client = _agent(model, FakeLLM({"DaxPlan": [refused, GOOD]}))
    result = await agent.answer("spend in the last 1 day", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "ok"
    assert len(agent.llm.calls) == 2
    assert "DATE FILTERS" in agent.llm.calls[1][1]
    assert client.queries


async def test_calendar_day_uses_the_incident_date_without_asking(model):
    ambiguous = {
        "intent": "ambiguous",
        "clarifying_question": "Which date should define recorded on October 12, 2026?",
        "candidates": ["INJURY_TABLE[DATE_OF_INCIDENT]", "INJURY_TABLE[REPORTED_DATE]"],
    }
    assumed = {
        **GOOD,
        "intent": "assumed",
        "assumptions": ["Filtered INJURY_TABLE[DATE_OF_INCIDENT]"],
        "dax": (
            'EVALUATE ROW("Injuries", CALCULATE([PO Count], '
            "YEAR('PO'[Order Date])=2026, MONTH('PO'[Order Date])=10))"
        ),
    }
    agent, client = _agent(model, FakeLLM({"DaxPlan": [ambiguous, assumed]}))
    result = await agent.answer("how many injuries on oct 12th 2026", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "ok"
    assert "DATE_OF_INCIDENT" in agent.llm.calls[1][1]
    assert client.queries


async def test_reported_date_still_asks_which_column(model):
    plan = {
        "intent": "ambiguous",
        "clarifying_question": "Which date?",
        "candidates": ["INJURY_TABLE[DATE_OF_INCIDENT]", "INJURY_TABLE[REPORTED_DATE]"],
    }
    agent, client = _agent(model, FakeLLM({"DaxPlan": [plan]}))
    result = await agent.answer("injuries reported on oct 12th 2026", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "needs_clarification"
    assert client.queries == []


async def test_ambiguous_question_asks_back(model):
    plan = {"intent": "ambiguous", "clarifying_question": "Committed or invoiced?", "candidates": ["PO[Spend]"]}
    agent, client = _agent(model, FakeLLM({"DaxPlan": [plan]}))
    result = await agent.answer("how much", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "needs_clarification" and result["candidates"] == ["PO[Spend]"]
    assert client.queries == []


async def test_llm_unavailable_is_reported(model):
    agent, _ = _agent(model, FakeLLM(configured=False))
    result = await agent.answer("spend", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "llm_unavailable"


async def test_concurrent_answers_are_isolated(model):
    agent, client = _agent(model, FakeLLM({"DaxPlan": [GOOD]}))
    users = [f"user{i}@x.com" for i in range(20)]
    results = await asyncio.gather(*(agent.answer("spend by vendor", "ws-1", "ds-1", u) for u in users))
    assert all(r["status"] == "ok" for r in results)
    assert sorted(r["rls_user"] for r in results) == sorted(users)
    assert all(u is None for _, u in client.queries)


def test_injuries_and_last_day_use_the_related_calendar_date():
    from pbi_semantiq_agent.metadata import Column, Measure, Relationship, SemanticModel, Table

    fact = Table(
        name="Injury",
        columns=[Column("Injury Key", "Int64"), Column("Injury Date", "DateTime")],
        measures=[Measure("TOTAL_INJURY", "Injury", "COUNTROWS('Injury')", "#,0")],
    )
    calendar = Table(name="Calendar", columns=[Column("Date", "DateTime"), Column("Year", "Int64")])
    model = SemanticModel(
        "ws",
        "ds",
        "Injury",
        [fact, calendar],
        [Relationship("Injury", "Injury Date", "Calendar", "Date", "Many:One")],
    )
    slice_ = select_slice(model, "is there any injuries in last 1 day?")
    assert any(m.name == "TOTAL_INJURY" for m in slice_.measures)
    assert ("Calendar", next(c for c in calendar.columns if c.name == "Date")) in [(t, c) for t, c in slice_.columns]
    prompt = slice_.to_prompt()
    assert "DATE FILTERS" in prompt and "'Calendar'[Date]" in prompt


def test_slice_and_search_hide_hidden_columns(model):
    slice_ = select_slice(model, "spend by vendor name")
    assert any(m.name == "Spend" for m in slice_.measures)
    names = [c.name for _, c in slice_.columns]
    assert "Vendor Name" in names and "Vendor Key" not in names
    assert "Vendor" in slice_.tables
    hits = search(model, "spend")
    assert hits[0]["kind"] == "measure" and hits[0]["name"].startswith("Spend")
    assert all(h["name"] != "Vendor Key" for h in search(model, "vendor key"))
