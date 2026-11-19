"""Incremental keyword indexing: only changed objects go to the LLM; unchanged datasets are not rewritten."""

from __future__ import annotations

import pytest

from pbi_semantiq_agent import keyword_index as ki
from pbi_semantiq_agent.keyword_store import MemoryKeywordStore
from pbi_semantiq_agent.metadata import Column, Measure, SemanticModel, Table
from pbi_semantiq_agent.settings import SemantiqSettings

WS = "0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd"
DS = "6fe28c18-151c-4b05-a696-979f0906ddee"


def _model(desc: str = "", extra_measure: bool = False, values_ok: bool = True) -> SemanticModel:
    measures = [Measure("Vessel Count", "Fleet", "DISTINCTCOUNT(Fleet[IMO])", None, desc)]
    if extra_measure:
        measures.append(Measure("Fuel Total", "Fleet", "SUM(Fleet[Fuel])"))
    return SemanticModel(WS, DS, "fleet", [Table("Fleet", columns=[Column("IMO_NUMBER")], measures=measures)], [])


class FakeLLM:
    configured = True

    def __init__(self) -> None:
        self.calls = 0
        self.objects_sent = 0

    async def complete_json(self, system, user, schema, **_):
        import json

        self.calls += 1
        payload = json.loads(user)
        self.objects_sent += len(payload)
        return schema.model_validate({"items": [{"id": p["id"], "keywords": [p["name"].lower() + " synonym"]} for p in payload]})


class FakeEmbedder:
    async def embed(self, texts):
        return [[float(len(t)), 1.0, 0.0] for t in texts]


def _settings(tmp_path) -> SemantiqSettings:
    return SemantiqSettings(_env_file=None, qdrant_url="http://q", keyword_state_dir=str(tmp_path))


async def _index(monkeypatch, model, state, llm, store, *, full=False, values=None):
    async def load(*_a, **_k):
        return model, [], None

    async def dist(*_a, **_k):
        return values if values is not None else {("Fleet", "IMO_NUMBER"): ["9000001"]}

    monkeypatch.setattr(ki, "load_model_extended", load)
    monkeypatch.setattr(ki, "distinct_values", dist)
    return await ki.index_model(
        settings=_settings(state["_dir"]),
        client=None,
        llm=llm,
        embedder=FakeEmbedder(),
        store=store,
        state=state,
        workspace_id=WS,
        dataset_id=DS,
        report_ids=["r1"],
        name="fleet",
        full=full,
        dry_run=False,
    )


async def test_first_run_enriches_everything_then_second_run_makes_no_llm_calls(tmp_path, monkeypatch):
    state = {"version": 1, "datasets": {}, "_dir": tmp_path}
    llm, store = FakeLLM(), MemoryKeywordStore()
    first = await _index(monkeypatch, _model(extra_measure=True), state, llm, store)
    assert first["status"] == "indexed" and first["changed"] == 3 and llm.objects_sent == 3
    llm.objects_sent = 0
    second = await _index(monkeypatch, _model(extra_measure=True), state, llm, store)
    assert second["status"] == "unchanged"
    assert llm.objects_sent == 0  # nothing new: no synonyms requested, no rewrite


async def test_only_the_changed_measure_is_re_enriched(tmp_path, monkeypatch):
    state = {"version": 1, "datasets": {}, "_dir": tmp_path}
    llm, store = FakeLLM(), MemoryKeywordStore()
    await _index(monkeypatch, _model(desc="old"), state, llm, store)
    llm.objects_sent = 0
    res = await _index(monkeypatch, _model(desc="new description"), state, llm, store)
    assert res["changed"] == 1 and llm.objects_sent == 1
    assert res["status"] == "indexed"


async def test_a_new_vessel_value_rebuilds_the_dataset_without_llm(tmp_path, monkeypatch):
    state = {"version": 1, "datasets": {}, "_dir": tmp_path}
    llm, store = FakeLLM(), MemoryKeywordStore()
    await _index(monkeypatch, _model(), state, llm, store)
    llm.objects_sent = 0
    res = await _index(monkeypatch, _model(), state, llm, store, values={("Fleet", "IMO_NUMBER"): ["9000001", "9000002"]})
    assert res["status"] == "values_updated" and llm.objects_sent == 0


async def test_removed_measure_is_dropped_from_state(tmp_path, monkeypatch):
    state = {"version": 1, "datasets": {}, "_dir": tmp_path}
    llm, store = FakeLLM(), MemoryKeywordStore()
    await _index(monkeypatch, _model(extra_measure=True), state, llm, store)
    res = await _index(monkeypatch, _model(), state, llm, store)
    assert res["status"] == "indexed"
    assert "measure|fleet|fuel total" not in state["datasets"][DS]["objects"]


async def test_full_flag_re_enriches_everything(tmp_path, monkeypatch):
    state = {"version": 1, "datasets": {}, "_dir": tmp_path}
    llm, store = FakeLLM(), MemoryKeywordStore()
    await _index(monkeypatch, _model(), state, llm, store)
    llm.objects_sent = 0
    await _index(monkeypatch, _model(), state, llm, store, full=True)
    assert llm.objects_sent == 2


def test_run_lock_blocks_overlap(tmp_path):
    lock = ki.RunLock(tmp_path / "run.lock")
    with lock:
        with pytest.raises(ki.KeywordIndexError):
            with ki.RunLock(tmp_path / "run.lock"):
                pass
    with ki.RunLock(tmp_path / "run.lock"):  # released after the first block
        pass


def test_object_signature_changes_only_when_the_object_changes():
    base = {"kind": "measure", "table": "T", "name": "M", "description": "", "format": None, "expression": "SUM(T[x])"}
    assert ki.object_sig(base) == ki.object_sig(dict(base))
    assert ki.object_sig(base) != ki.object_sig({**base, "expression": "SUM(T[y])"})
