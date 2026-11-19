"""Semantic cache safety, RLS isolation, multi-turn resume, repeat analytics and concurrency (graph level)."""

from __future__ import annotations

import asyncio
from typing import Any

from smart_orchestrator.conversation import looks_like_answer, match_option
from smart_orchestrator.embeddings import HashingEmbedder
from smart_orchestrator.graph import SEMANTIQ, SmartGraph
from smart_orchestrator.semantic_cache import SemanticCache
from smart_orchestrator.settings import OrchestratorSettings
from tests.conftest import FakeLLM
from tests.test_graph import OK_RESULT, FakeAgents, _run

INJURY_RESULT = {**OK_RESULT, "columns": ["Injuries"], "rows": [{"Injuries": 3.0}], "row_count": 1}


def _graph(agents: FakeAgents, **overrides: Any) -> SmartGraph:
    return SmartGraph(OrchestratorSettings(_env_file=None, **overrides), agents, FakeLLM(configured=False))  # type: ignore[arg-type]


def _injury_agents(result: dict[str, Any] | None = None, *, rls: bool | None = None) -> FakeAgents:
    agents = FakeAgents(result or INJURY_RESULT)
    agents.workspaces = [{"id": "ws", "name": "Embedded PBI Portal"}]
    model: dict[str, Any] = {"id": "inj", "name": "Injury", "workspaceId": "ws"}
    if rls is not None:
        model.update({"isEffectiveIdentityRequired": rls, "isEffectiveIdentityRolesRequired": rls})
    agents.models_by_workspace = {"ws": [model, {"id": "inj-draft", "name": "Injury_Data_Draft", "workspaceId": "ws"}]}
    agents.reports_by_workspace = {"ws": []}
    return agents


def _answers(agents: FakeAgents) -> list[dict[str, Any]]:
    return [call[2] for call in agents.calls if call[1] == "answer_question"]


# ---------------------------------------------------------------- test case 5: safe cache hits
async def test_rephrased_question_with_the_same_date_hits_the_cache():
    agents = _injury_agents()
    graph = _graph(agents)
    _, first = await _run(graph, "injury count on 12 Oct 2026", context={"catalog": []}, conv="a")
    _, second = await _run(graph, "number of injuries on 12 October 2026", context={"catalog": []}, conv="b")
    _, other_day = await _run(graph, "injury count on 13 Oct 2026", context={"catalog": []}, conv="c")
    assert len(_answers(agents)) == 2
    assert first["kind"] == second["kind"] == "answer" and "cache" not in first
    assert second["cache"]["hit"] is True and second["content"] == first["content"]
    assert second["rlsUser"] == "user@x.com"
    assert "cache" not in other_day


async def test_data_refresh_and_low_confidence_answers_are_not_reused():
    agents = _injury_agents()
    graph = _graph(agents, freshness_ttl_s=0)
    await _run(graph, "injury count on 12 Oct 2026", context={"catalog": []}, conv="a")
    agents.refreshed_at["inj"] = "2026-11-01T06:00:00Z"
    _, after_refresh = await _run(graph, "injury count on 12 Oct 2026", context={"catalog": []}, conv="b")
    assert len(_answers(agents)) == 2 and "cache" not in after_refresh

    unsure = _injury_agents({**INJURY_RESULT, "confidence_components": {**INJURY_RESULT["confidence_components"], "intent_clarity": 0.9}})
    graph = _graph(unsure)
    await _run(graph, "injury count on 12 Oct 2026", context={"catalog": []}, conv="a")
    await _run(graph, "injury count on 12 Oct 2026", context={"catalog": []}, conv="b")
    assert len(_answers(unsure)) == 2


async def test_different_grouping_or_ranking_direction_is_a_miss():
    agents = _injury_agents()
    graph = _graph(agents)
    for q in ("highest injuries by vessel this year", "lowest injuries by vessel this year", "injuries by month this year"):
        await _run(graph, q, context={"catalog": []}, conv=q)
    assert len(_answers(agents)) == 3


# ---------------------------------------------------------------- test case 6: RLS isolation
async def test_cached_answers_never_cross_users_when_rls_may_apply():
    for rls in (None, True):
        agents = _injury_agents(rls=rls)
        graph = _graph(agents)
        await _run(graph, "injury count on 12 Oct 2026", context={"catalog": []}, user="alice@x.com")
        _, bob = await _run(graph, "injury count on 12 Oct 2026", context={"catalog": []}, user="bob@x.com")
        assert [a["user_email"] for a in _answers(agents)] == ["alice@x.com", "bob@x.com"]
        assert "cache" not in bob


async def test_models_without_rls_share_answers_but_not_the_identity():
    agents = _injury_agents(rls=False)
    graph = _graph(agents)
    await _run(graph, "injury count on 12 Oct 2026", context={"catalog": []}, user="alice@x.com")
    _, bob = await _run(graph, "injury count on 12 Oct 2026", context={"catalog": []}, user="bob@x.com")
    assert [a["user_email"] for a in _answers(agents)] == ["alice@x.com"]
    assert bob["cache"]["hit"] is True and "rlsUser" not in bob
    # A catalog outage removes the allow-list, so answers are per user again.
    _, carol = await _run(graph, "injury count on 12 Oct 2026", context={"catalog": [], "catalog_unavailable": True}, user="carol@x.com")
    assert "cache" not in carol


async def test_cache_requires_the_model_in_the_callers_authorized_set():
    cache = SemanticCache(HashingEmbedder(64), enabled=True, ttl_s=60, unknown_ttl_s=10, similarity=0.9, max_entries=10)
    await cache.store(scope="shared", dataset_key="ws|ds", signature="s", text="injury", question="q", response={"content": "3"}, semantiq={}, freshness="f1")
    allowed = await cache.lookup(scope="shared", dataset_key="ws|ds", authorized_keys={"ws|ds"}, signature="s", text="injury", freshness="f1")
    denied = await cache.lookup(scope="shared", dataset_key="ws|ds", authorized_keys={"ws|other"}, signature="s", text="injury", freshness="f1")
    other_scope = await cache.lookup(scope="user:bob@x.com", dataset_key="ws|ds", authorized_keys={"ws|ds"}, signature="s", text="injury", freshness="f1")
    assert allowed.reason == "hit" and denied.reason == "not_authorized" and other_scope.reason == "miss"
    cache.note_freshness("ws|ds", "f2")
    assert len(cache) == 0


async def test_identical_concurrent_questions_run_once_per_scope():
    cache = SemanticCache(HashingEmbedder(64), enabled=True, ttl_s=60, unknown_ttl_s=10, similarity=0.9, max_entries=10)
    calls = 0

    async def work():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return {"rows": [1]}

    results = await asyncio.gather(*(cache.single_flight("user:a|ws|ds|sig|injury", work) for _ in range(5)), cache.single_flight("user:b|ws|ds|sig|injury", work))
    assert calls == 2 and all(r == {"rows": [1]} for r in results)


# ---------------------------------------------------------------- test case 7: multi-turn resume
class SequencedAgents(FakeAgents):
    def __init__(self, results: list[dict[str, Any]]):
        super().__init__(results[-1])
        self.results = list(results)

    async def call(self, agent_id, tool, arguments):
        if agent_id == SEMANTIQ and tool == "answer_question":
            self.calls.append((agent_id, tool, arguments))
            return self.results.pop(0) if len(self.results) > 1 else self.results[0]
        return await super().call(agent_id, tool, arguments)


def _trend_agents(results):
    agents = SequencedAgents(results)
    agents.workspaces = [{"id": "ws", "name": "Embedded PBI Portal"}]
    agents.models_by_workspace = {"ws": [{"id": "inj", "name": "Injury", "workspaceId": "ws"}]}
    agents.reports_by_workspace = {"ws": []}
    return agents


TREND = {**OK_RESULT, "columns": ["Month", "Injuries"], "rows": [{"Month": "Sep", "Injuries": 2.0}, {"Month": "Oct", "Injuries": 4.0}], "row_count": 2}
ASK = {"status": "needs_clarification", "clarifying_question": "Monthly or vessel-wise?", "candidates": ["Monthly", "Vessel-wise"]}


async def test_clarification_reply_resumes_the_original_question_and_model():
    agents = _trend_agents([ASK, TREND])
    graph = _graph(agents)
    _, asked = await _run(graph, "Show injury trends", context={"catalog": []})
    steps, answered = await _run(graph, "Monthly", context={"catalog": []})
    calls = _answers(agents)
    assert asked["kind"] == "clarification" and asked["candidates"] == ["Monthly", "Vessel-wise"]
    assert [c["dataset_id"] for c in calls] == ["inj", "inj"]
    assert calls[1]["question"] == "Show injury trends (Monthly)"
    assert "retrieve" not in {s["step"] for s in steps}
    assert answered["kind"] == "answer"
    state = await graph.graph.aget_state({"configurable": {"thread_id": "user@x.com:c1"}})
    assert state.values.get("pending") is None


async def test_model_choice_by_number_and_unrelated_reply_drops_the_pending_question():
    agents = _injury_agents()
    agents.models_by_workspace = {"ws": [{"id": "a", "name": "Injury Analysis", "workspaceId": "ws"}, {"id": "s", "name": "Injury Statistics", "workspaceId": "ws"}]}
    graph = _graph(agents)
    _, asked = await _run(graph, "injury rate this year", context={"catalog": []})
    assert asked["kind"] == "clarification" and asked["awaiting"] == "choose_model"
    _, answered = await _run(graph, "2", context={"catalog": []})
    picked = asked["candidates"][1]
    assert _answers(agents)[0]["dataset_id"] == {"Injury Analysis": "a", "Injury Statistics": "s"}[picked]
    assert _answers(agents)[0]["question"] == "injury rate this year"
    assert answered["kind"] == "answer"

    _, again = await _run(graph, "injury rate this year", context={"catalog": []}, conv="c2")
    _, new_question = await _run(graph, "hello", context={"catalog": []}, conv="c2")
    assert again["kind"] == "clarification" and new_question["kind"] == "info"
    state = await graph.graph.aget_state({"configurable": {"thread_id": "user@x.com:c2"}})
    assert state.values.get("pending") is None


async def test_clarification_loops_stop_after_the_configured_limit():
    agents = _trend_agents([ASK])
    graph = _graph(agents, max_clarifications=2)
    _, first = await _run(graph, "Show injury trends", context={"catalog": []})
    _, second = await _run(graph, "monthly", context={"catalog": []})
    _, third = await _run(graph, "monthly please", context={"catalog": []})
    assert first["kind"] == second["kind"] == "clarification"
    assert third["kind"] == "info" and "ask the full question again" in third["content"]


def test_reply_matching_helpers():
    options = [{"title": "Injury Analysis", "label": "Injury Analysis"}, {"title": "INJURY_REPORT_DRAFT", "label": "INJURY_REPORT_DRAFT (draft/test)"}]
    assert match_option("2", options) == 1
    assert match_option("the second one", options) == 1
    assert match_option("use INJURY_REPORT_DRAFT", options) == 1
    assert match_option("INJURY_REPORT_DRAFT (draft/test)", options) == 1
    assert match_option("injury analysis", options) == 0
    assert match_option("what is the spend this year", options) is None
    assert looks_like_answer("Monthly") and looks_like_answer("vessel wise, last year")
    assert not looks_like_answer("what is the total spend by vendor this year?")


# ---------------------------------------------------------------- test case 8: repeated unanswered questions
async def test_repeated_unanswered_questions_are_logged_with_a_cause():
    agents = FakeAgents()
    graph = _graph(agents)
    await _run(graph, "show vessel emissions for this year", context={"catalog": []})
    await _run(graph, "vessel emissions this year please", context={"catalog": []})
    rows = await graph.analytics.query("SELECT outcome FROM interactions ORDER BY ts")
    patterns = await graph.analytics.query("SELECT cause, occurrences, outcomes FROM failure_patterns")
    assert [r["outcome"] for r in rows] == ["retrieval_miss", "retrieval_miss"]
    assert len(patterns) == 1 and patterns[0]["cause"] == "retrieval" and patterns[0]["occurrences"] == 2


async def test_feedback_is_owned_by_the_asker():
    agents = _injury_agents()
    graph = _graph(agents)
    async for kind, _ in graph.run(question="injury count on 12 Oct 2026", user_email="alice@x.com", conversation_id="c", context={"catalog": []}, request_id="req-12345678"):
        pass
    assert await graph.analytics.feedback(interaction_id="req-12345678", user_email="alice@x.com", rating=-1, reason="wrong_number", comment="expected 4")
    assert not await graph.analytics.feedback(interaction_id="req-12345678", user_email="bob@x.com", rating=1, reason=None, comment=None)
    rows = await graph.analytics.query("SELECT rating, reason, comment FROM feedback")
    assert rows == [{"rating": -1, "reason": "wrong_number", "comment": "expected 4"}]


# ---------------------------------------------------------------- test case 9: concurrency
async def test_concurrent_users_get_their_own_model_and_answer():
    class PerModel(FakeAgents):
        async def call(self, agent_id, tool, arguments):
            if agent_id == SEMANTIQ and tool == "answer_question":
                self.calls.append((agent_id, tool, arguments))
                await asyncio.sleep(0.01)
                value = {"inj": 3.0, "po": 750.0}[arguments["dataset_id"]]
                return {**OK_RESULT, "columns": ["Value"], "rows": [{"Value": value}], "row_count": 1, "rls_user": arguments["user_email"]}
            return await super().call(agent_id, tool, arguments)

    agents = PerModel()
    agents.workspaces = [{"id": "ws", "name": "Embedded PBI Portal"}]
    agents.models_by_workspace = {"ws": [{"id": "inj", "name": "Injury", "workspaceId": "ws"}, {"id": "po", "name": "Purchase Orders", "workspaceId": "ws"}]}
    agents.reports_by_workspace = {"ws": []}
    graph = _graph(agents)
    jobs = [(f"u{i}@x.com", "injury count today" if i % 2 else "purchase orders value today") for i in range(30)]
    results = await asyncio.gather(*(_run(graph, q, context={"catalog": []}, user=u, conv=u) for u, q in jobs))
    for (user, question), (_, msg) in zip(jobs, results):
        assert msg["kind"] == "answer" and msg["rlsUser"] == user
        assert ("3" in msg["content"]) if "injury" in question else ("750" in msg["content"])
    by_user = {a["user_email"]: a["dataset_id"] for a in _answers(agents)}
    assert all(by_user[u] == ("inj" if "injury" in q else "po") for u, q in jobs)


async def test_turns_in_one_conversation_run_one_at_a_time():
    agents = _injury_agents()
    graph = _graph(agents, semantic_cache_enabled=False)
    await asyncio.gather(*(_run(graph, f"injury count on {d} Oct 2026", context={"catalog": []}) for d in range(10, 15)))
    state = await graph.graph.aget_state({"configurable": {"thread_id": "user@x.com:c1"}})
    history = state.values["history"]
    assert len(history) == 10 and [h["role"] for h in history] == ["user", "assistant"] * 5
    assert not graph._thread_locks
