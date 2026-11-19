"""Chat must stay quick: ontology cached, one signal pass per question, plain vessel questions skip the pool scan."""

from __future__ import annotations

import asyncio
import time

import pytest

from pbi_semantiq_agent import ontology
from pbi_semantiq_agent.settings import SemantiqSettings
from smart_orchestrator import ontology_ranking
from smart_orchestrator.app import _with_keepalive
from smart_orchestrator.settings import OrchestratorSettings
from tests.test_retrieval_pipeline import _retriever

REGISTER_ID = "6fe28c18-151c-4b05-a696-979f0906ddee"


def test_ontology_json_is_parsed_once_until_it_changes(tmp_path, monkeypatch):
    f = tmp_path / "rules.json"
    f.write_text('{"a": 1}', encoding="utf-8")
    calls = {"n": 0}
    real = ontology.json.loads

    def counting(text, *a, **k):
        calls["n"] += 1
        return real(text, *a, **k)

    monkeypatch.setattr(ontology.json, "loads", counting)
    for _ in range(50):
        assert ontology._read_json(f) == {"a": 1}
    assert calls["n"] == 1
    f.write_text('{"a": 2, "b": "longer"}', encoding="utf-8")  # size changes -> reparsed
    assert ontology._read_json(f)["a"] == 2
    assert calls["n"] == 2


def test_question_signals_are_computed_once_per_question(monkeypatch):
    ontology_ranking._question_signals_cached.cache_clear()
    calls = {"n": 0}
    real = ontology_ranking.concepts_in_question

    def spy(question, **kw):
        calls["n"] += 1
        return real(question, **kw)

    monkeypatch.setattr(ontology_ranking, "concepts_in_question", spy)
    q = "no of handymax tankers in sppl for the month oct2026"
    for _ in range(500):
        ontology_ranking.question_signals(q)
    assert calls["n"] == 1


async def test_plain_vessel_question_skips_the_pool_scan(monkeypatch):
    pool = [
        {"title": f"Report {i}", "workspace_id": "ws", "workspace_name": "Embedded PBI", "menu_path": "x", "dataset_id": f"ds-{i}", "source": "workspace"}
        for i in range(480)
    ]
    pool.append({"title": "Fleet Count Vessel Portal", "workspace_id": "ws", "workspace_name": "Embedded PBI", "dataset_id": REGISTER_ID, "report_id": "r", "source": "portal"})
    retriever = _retriever()
    synced = {"n": 0}

    async def no_sync(docs):
        synced["n"] += 1

    monkeypatch.setattr(retriever.index, "sync", no_sync)
    started = time.perf_counter()
    decision = await retriever.retrieve("no of handymax tankers in sppl for the month oct2026", pool)
    elapsed = time.perf_counter() - started
    assert decision.reason == "vessel_register"
    assert decision.selected.item["dataset_id"] == REGISTER_ID
    assert synced["n"] == 0  # no document sync, no hybrid search, no scoring of the pool
    assert elapsed < 1.5


async def test_module_question_still_uses_normal_retrieval():
    pool = [
        {"title": "Injury Dashboard", "workspace_id": "ws", "workspace_name": "Embedded PBI", "dataset_id": "ds-injury", "report_id": "r-inj", "source": "portal"},
        {"title": "Fleet Count Vessel Portal", "workspace_id": "ws", "workspace_name": "Embedded PBI", "dataset_id": REGISTER_ID, "report_id": "r-vp", "source": "portal"},
    ]
    decision = await _retriever().retrieve("number of injuries for handymax vessels in oct 2026", pool)
    assert decision.reason != "vessel_register"


async def test_keepalive_ticks_during_a_slow_step():
    async def slow():
        await asyncio.sleep(0.25)
        yield ("step", {"step": "done"})

    items = [item async for item in _with_keepalive(slow(), every=0.05)]
    assert None in items  # keep-alive ticks while nothing arrives
    assert ("step", {"step": "done"}) in items


async def test_keepalive_passes_events_straight_through_when_fast():
    async def fast():
        yield ("delta", {"text": "a"})
        yield ("message", {"kind": "answer"})

    items = [item async for item in _with_keepalive(fast(), every=5.0)]
    assert items == [("delta", {"text": "a"}), ("message", {"kind": "answer"})]


def test_defaults_keep_background_work_out_of_chat():
    assert OrchestratorSettings(_env_file=None).index_model_metadata is False
    assert SemantiqSettings(_env_file=None).metadata_sync_interval_s == 0
    assert SemantiqSettings(_env_file=None).value_resolution_timeout_s == 8.0
    assert OrchestratorSettings(_env_file=None).request_timeout_s > OrchestratorSettings(_env_file=None).agent_timeout_s
