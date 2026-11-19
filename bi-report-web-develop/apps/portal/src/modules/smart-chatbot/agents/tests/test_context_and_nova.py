"""Semantic-model reading, column metadata, filter-leakage repair loop and the N.O.V.A. hand-off."""

from __future__ import annotations

import pytest

from pbi_nova_visual_generator.agent import NovaAgent
from pbi_nova_visual_generator.settings import NovaSettings
from pbi_nova_visual_generator.visual_spec import format_value, profile, recommend
from pbi_semantiq_agent import agent as agent_module
from pbi_semantiq_agent.dax_recovery import MAX_TOTAL_REPAIRS
from pbi_semantiq_agent.metadata import Column, Measure, Relationship, SemanticModel, Table, select_slice
from pbi_semantiq_agent.result_meta import build_column_meta
from tests.conftest import FakeLLM
from tests.test_semantiq_agent import GOOD, _agent


# --------------------------------------------------------------------------- model reading
def test_schema_prompt_shows_measure_definitions_and_cross_filter(model):
    model.relationships.append(Relationship("PO", "Order Date", "Date", "Date", "ManyToOne", True, "BothDirections"))
    text = select_slice(model, "spend by vendor").to_prompt()
    assert ":= SUM('PO'[Amount])" in text  # the planner can now see what [Spend] does
    assert "filters both directions" in text


def test_expression_budget_limits_prompt_size(model):
    text = select_slice(model, "spend by vendor").to_prompt(max_expressions=1)
    assert text.count(":=") == 1


# --------------------------------------------------------------------------- column metadata
def test_column_meta_roles_formats_and_aliases(model):
    rows = [{"Vendor Name": "Acme", "Spend": 10.5, "Order Date": "2026-01-01", "PO Number": 7, "Share": 0.4}]
    meta = {m["name"]: m for m in build_column_meta(list(rows[0]), rows, model)}
    assert meta["Vendor Name"]["role"] == "dimension"
    assert meta["Spend"]["role"] == "measure" and meta["Spend"]["format"] == "#,0"
    assert meta["Order Date"]["role"] == "date"
    assert meta["Share"]["role"] == "measure" and meta["Share"]["source"] == "alias"
    assert meta["PO Number"]["role"] == "dimension"  # a string-typed key stays a dimension


def test_column_meta_handles_bracketed_names(model):
    meta = build_column_meta(["'PO'[Amount]", "[Spend]"], [{"'PO'[Amount]": 3, "[Spend]": 4}], model)
    assert meta[1]["role"] == "measure" and meta[1]["label"] == "Spend"


def test_column_meta_percent_unit():
    model = SemanticModel("w", "d", "m", [Table("T", measures=[Measure("Margin", "T", "1", "0.0%")])], [])
    assert build_column_meta(["Margin"], [{"Margin": 0.5}], model)[0]["unit"] == "percent"


# --------------------------------------------------------------------------- N.O.V.A.
def test_nova_uses_model_roles_to_keep_numeric_ids_out_of_the_measures():
    rows = [{"IMO": 9000001 + i, "Fleet Count": 3 + i} for i in range(4)]
    plain = {p.name: p.role for p in profile(["IMO", "Fleet Count"], rows)}
    assert plain["IMO"] == "numeric"  # without the model, an IMO number looks like a measure
    meta = [{"name": "IMO", "role": "dimension"}, {"name": "Fleet Count", "role": "measure"}]
    known = {p.name: p.role for p in profile(["IMO", "Fleet Count"], rows, meta)}
    assert known["IMO"] == "category"
    _, x, ys = recommend("fleet count by imo", ["IMO", "Fleet Count"], rows, meta)
    assert x == "IMO" and ys == ["Fleet Count"]


def test_kpi_format_uses_unit_from_the_model():
    assert format_value(0.123, "percent") == "12.3%"
    assert format_value(1234.5, "currency", "$#,0.00") == "$1,234.50"
    assert format_value(1500) == "1,500"  # unchanged default


@pytest.mark.asyncio
async def test_nova_generate_accepts_optional_context_and_labels_kpi():
    nova = NovaAgent(NovaSettings(_env_file=None), FakeLLM(configured=False))  # type: ignore[arg-type]
    meta = [{"name": "Margin", "label": "Gross margin", "role": "measure", "unit": "percent", "format": "0.0%"}]
    spec = await nova.generate(
        "what is the margin", ["Margin"], [{"Margin": 0.25}], column_meta=meta, result_description="margin ratio", intent="data_question"
    )
    assert spec.kind == "kpi" and spec.kpi.label == "Gross margin" and spec.kpi.value == "25.0%"
    # old call shape still works
    assert (await nova.generate("how many", ["N"], [{"N": 3}])).kind == "kpi"


# --------------------------------------------------------------------------- follow-up context to the DAX planner
async def test_prior_turn_reaches_the_dax_planner(model):
    llm = FakeLLM({"DaxPlan": [GOOD]})
    agent, _ = _agent(model, llm)
    await agent.answer(
        "and for last month?", "ws-1", "ds-1", "u@x.com", prior_turn={"question": "spend by vendor", "dax": "EVALUATE SUMMARIZECOLUMNS('Vendor'[Vendor Name], \"Spend\", [Spend])"}
    )
    prompt = llm.calls[0][1]
    assert "PREVIOUS TURN" in prompt and "spend by vendor" in prompt and "SUMMARIZECOLUMNS" in prompt


async def test_answer_returns_column_meta(model):
    agent, _ = _agent(model, FakeLLM({"DaxPlan": [GOOD]}))
    result = await agent.answer("spend by vendor", "ws-1", "ds-1", "u@x.com")
    roles = {m["name"]: m["role"] for m in result["column_meta"]}
    assert roles == {"Vendor Name": "dimension", "Spend": "measure"}


# --------------------------------------------------------------------------- filter-leakage repair loop
async def _validate(agent, repair_counts, attempts):
    outcome = agent_module.ValidationOutcome("filter_leakage", "planned and validation counts differ")
    state = {
        "result": {"status": "ok", "rows": [{"N": 5}], "columns": ["N"]},
        "bindings": object(),
        "plan": agent_module.DaxPlan(intent="clear", dax="EVALUATE ROW(\"N\", 1)"),
        "workspace_id": "ws",
        "dataset_id": "ds",
        "timings": {},
        "repair_counts": repair_counts,
        "attempts": attempts,
    }
    return state, await agent._validate_result(state)


async def test_filter_leakage_routes_back_to_plan_instead_of_ending(model, monkeypatch):
    agent, _ = _agent(model, FakeLLM())
    monkeypatch.setattr(agent_module, "validation_dax", lambda *a, **k: "EVALUATE ROW(\"N\", 2)")
    monkeypatch.setattr(agent_module, "reconcile_values", lambda outcome, *a, **k: agent_module.ValidationOutcome("filter_leakage", "differ"))

    async def execute(*a, **k):
        return {"columns": ["N"], "rows": [{"N": 2}]}

    agent.client.execute_dax = execute  # type: ignore[method-assign]
    state, patch = await _validate(agent, {}, 1)
    assert patch["result"] is None  # no stale terminal result: the router can reach ``plan``
    assert patch["error_class"] == "filter_leakage"
    assert agent._after_validate({**state, **patch}) == "plan"


async def test_filter_leakage_after_budget_returns_the_failure(model, monkeypatch):
    agent, _ = _agent(model, FakeLLM())
    monkeypatch.setattr(agent_module, "validation_dax", lambda *a, **k: "EVALUATE ROW(\"N\", 2)")
    monkeypatch.setattr(agent_module, "reconcile_values", lambda outcome, *a, **k: agent_module.ValidationOutcome("filter_leakage", "differ"))

    async def execute(*a, **k):
        return {"columns": ["N"], "rows": [{"N": 2}]}

    agent.client.execute_dax = execute  # type: ignore[method-assign]
    state, patch = await _validate(agent, {"filter_leakage": 5}, MAX_TOTAL_REPAIRS)
    assert patch["result"]["status"] == "query_failed"
    assert agent._after_validate({**state, **patch}) == agent_module.END
