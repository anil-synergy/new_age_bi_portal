"""Matching question words to values stored in the model (DOC names, sub types, vessel types)."""

from __future__ import annotations

from pbi_semantiq_agent.metadata import Column, SemanticModel, Table
from pbi_semantiq_agent.value_resolver import acronym, acronyms, match_terms, question_terms
from tests.test_semantiq_agent import _agent
from tests.conftest import FakeLLM

VALUES = {
    ("IMO_MASTER_LIST", "MANAGER_GROUP"): ["Synergy Offshore Marine Inc", "SPPL", "Synergy Ship Management Pte", "Other Co"],
    ("IMO_MASTER_LIST", "SUB_TYPE"): ["Handymax", "Panamax", "Supramax"],
    ("IMO_MASTER_LIST", "VESSEL_TYPE"): ["Tanker", "Bulk Carrier"],
}


def _resolve(question: str):
    return match_terms(question_terms(question), VALUES)


def test_acronym_from_full_registered_name():
    assert "somi" in acronyms("Synergy Offshore Marine Inc")  # legal suffix kept
    assert "som" in acronyms("Synergy Offshore Marine Inc")  # legal suffix dropped
    assert acronym("Synergy Ship Management Pte Ltd") == "ssm"


def test_exact_value_and_acronym_resolve_to_stored_literal():
    res = _resolve("no of handymax tankers in sppl for oct 2026")
    got = {(m.term, m.value, m.column) for m in res.resolved}
    assert ("sppl", "SPPL", "MANAGER_GROUP") in got
    assert ("handymax", "Handymax", "SUB_TYPE") in got
    assert ("tankers", "Tanker", "VESSEL_TYPE") in got or ("tanker", "Tanker", "VESSEL_TYPE") in got


def test_acronym_matches_full_name_stored_in_model():
    res = _resolve("fleet of SOMI vessels")
    assert any(m.value == "Synergy Offshore Marine Inc" and m.kind == "acronym" for m in res.resolved)


def test_equal_candidates_ask_the_user():
    values = {("T", "A"): ["Synergy Ship Management"], ("T", "B"): ["Synergy Ship Mgmt"]}
    res = match_terms(["synergy ship"], values)
    assert not res.resolved and "synergy ship" in res.ambiguous
    assert {m.value for m in res.ambiguous["synergy ship"]} == {"Synergy Ship Management", "Synergy Ship Mgmt"}


def test_unknown_words_are_left_unmatched_not_guessed():
    res = _resolve("how many zebras in xyzzy")
    assert res.resolved == [] and res.ambiguous == {}
    assert "xyzzy" in res.unmatched_terms


def test_prompt_lists_exact_values_for_the_planner():
    text = _resolve("handymax tanker in sppl").prompt()
    assert "RESOLVED FILTER VALUES" in text and '"SPPL"' in text and '"Handymax"' in text


async def test_agent_asks_when_a_term_is_ambiguous(model, monkeypatch):
    model.tables[0].columns.append(Column("MANAGER_GROUP", "String"))
    agent, client = _agent(model, FakeLLM())

    async def values(*_a, **_k):
        return {("PO", "MANAGER_GROUP"): ["Synergy Ship Management", "Synergy Ship Mgmt"]}

    monkeypatch.setattr("pbi_semantiq_agent.value_resolver.distinct_values", values)
    result = await agent.answer("fleet count for synergy ship", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "needs_clarification"
    assert "synergy ship" in result["clarifying_question"].lower()
    assert len(result["candidates"]) == 2
    assert client.queries == []  # nothing executed until the user chooses


async def test_resolution_failure_never_blocks_the_answer(model, monkeypatch):
    from tests.test_semantiq_agent import GOOD

    agent, client = _agent(model, FakeLLM({"DaxPlan": [GOOD]}))

    async def boom(*_a, **_k):
        raise RuntimeError("xmla down")

    monkeypatch.setattr("pbi_semantiq_agent.value_resolver.distinct_values", boom)
    result = await agent.answer("spend by vendor", "ws-1", "ds-1", "u@x.com")
    assert result["status"] == "ok"
