"""LLM reasoning between rerank and decision: only narrows eligible candidates, always falls back."""

from __future__ import annotations

import pytest

from smart_orchestrator.environment import PROD, EnvironmentRequest
from smart_orchestrator.llm_rerank import RerankChoice, apply_choice, llm_rerank, should_rerank
from smart_orchestrator.ranking import Candidate, Decision
from smart_orchestrator.settings import OrchestratorSettings

from .conftest import FakeLLM


def _settings(**kw) -> OrchestratorSettings:
    return OrchestratorSettings(_env_file=None, **kw)


def _cand(key: str, title: str, score: float) -> Candidate:
    item = {"title": title, "workspace_id": "ws", "dataset_id": key, "menu_path": f"Ops > {title}"}
    return Candidate(item, key, key, PROD, (), set(), score=score, relevant=True)


def _decision(action="ask", reason="ambiguous", selected=None, confidence=0.5) -> Decision:
    ranked = [_cand("a", "Injury Dashboard", 0.6), _cand("b", "Injury Data", 0.58), _cand("c", "Fleet Count", 0.3)]
    req = EnvironmentRequest(frozenset({PROD}))
    return Decision(action, reason, req, selected=selected, options=ranked[:2] if action == "ask" else [], confidence=confidence, ranked=ranked)


def test_skips_when_certain_or_disabled():
    llm = FakeLLM()
    assert not should_rerank(_decision("select", "plain_model"), _settings(), llm)
    assert not should_rerank(_decision("select", "open_report"), _settings(), llm)
    assert not should_rerank(_decision("select", "confident_match", confidence=0.95), _settings(), llm)
    assert not should_rerank(_decision(), _settings(llm_rerank_enabled=False), llm)
    assert not should_rerank(_decision(), _settings(), FakeLLM(configured=False))
    assert should_rerank(_decision(), _settings(), llm)


def test_confident_choice_turns_ambiguous_into_select_with_retries():
    d = _decision()
    new, outcome = apply_choice(d, RerankChoice(chosen_key="b", confidence=0.9, rationale="x", runner_up_keys=["a", "zzz"]), _settings())
    assert outcome == "changed"
    assert new.action == "select" and new.selected.key == "b"
    assert [c.key for c in new.retry] == ["a"]  # invented key ignored


def test_invented_key_or_low_confidence_keeps_deterministic_decision():
    d = _decision()
    assert apply_choice(d, RerankChoice(chosen_key="not-a-candidate", confidence=0.99), _settings())[0] is d
    assert apply_choice(d, RerankChoice(chosen_key="a", confidence=0.4), _settings())[0] is d
    assert apply_choice(d, RerankChoice(chosen_key=None, confidence=0.0), _settings())[0] is d


def test_needs_user_choice_asks_with_llm_picked_options():
    d = _decision(action="ask")
    new, outcome = apply_choice(d, RerankChoice(chosen_key="a", confidence=0.6, needs_user_choice=True, runner_up_keys=["c"]), _settings())
    assert outcome == "ask" and new.action == "ask" and [c.key for c in new.options] == ["a", "c"]


@pytest.mark.asyncio
async def test_llm_failure_falls_back_to_deterministic():
    d = _decision()
    out = await llm_rerank(FakeLLM(), _settings(), "sys", "injuries in oct", [], d, lambda key: "")
    assert out is d and d.llm["outcome"] == "unavailable"


@pytest.mark.asyncio
async def test_prompt_contains_candidates_schema_and_history_and_result_is_recorded():
    d = _decision()
    llm = FakeLLM({"RerankChoice": [RerankChoice(chosen_key="a", confidence=0.95, rationale="Dashboard has incident counts")]})
    out = await llm_rerank(
        llm,
        _settings(),
        "sys",
        "how many injuries in oct",
        [{"role": "user", "content": "earlier question"}],
        d,
        lambda key: f"tables: Incidents measures: Incident Count ({key})",
    )
    assert out.action == "select" and out.selected.key == "a" and out.reason == "llm_rerank"
    assert out.llm["outcome"] == "changed" and "incident" in out.llm["rationale"].lower()
    prompt = llm.calls[0][1]
    assert "Injury Dashboard" in prompt and "Incident Count" in prompt and "earlier question" in prompt
    assert out.trace()["llm_rerank"]["outcome"] == "changed"
