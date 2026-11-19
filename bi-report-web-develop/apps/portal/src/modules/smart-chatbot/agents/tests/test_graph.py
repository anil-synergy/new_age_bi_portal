"""SMART supervisor graph routing with mocked MCP agents."""

from __future__ import annotations

from typing import Any

import pytest

from pbi_nova_visual_generator.agent import NovaAgent
from pbi_nova_visual_generator.settings import NovaSettings
from smart_orchestrator.errors import REPORT_DATABASE_DOWN, SMART_DOWN
from smart_orchestrator.graph import NOVA, SEMANTIQ, SmartGraph
from smart_orchestrator.mcp_clients import AgentCallError
from smart_orchestrator.settings import OrchestratorSettings
from tests.conftest import FakeLLM

CTX = {"workspace_id": "ws-1", "report_id": "rep-1", "dataset_id": None, "report_name": "PO"}
OK_RESULT = {
    "status": "ok",
    "dax": "EVALUATE SUMMARIZECOLUMNS('Vendor'[Vendor Name], \"Spend\", [Spend])",
    "columns": ["Vendor Name", "Spend"],
    "rows": [{"Vendor Name": "Acme", "Spend": 400.0}, {"Vendor Name": "Blue", "Spend": 250.0}, {"Vendor Name": "Cove", "Spend": 100.0}],
    "row_count": 3,
    "truncated": False,
    "references": ["'Vendor'[Vendor Name]", "[Spend]"],
    "assumptions": [],
    "rls_user": "user@x.com",
    "confidence_components": {"schema_match": 1.0, "query_success": 1.0, "intent_clarity": 1.0},
}


class FakeAgents:
    def __init__(self, semantiq: dict[str, Any] | None = None, nova_fails: bool = False):
        self.semantiq = semantiq or OK_RESULT
        self.nova_fails = nova_fails
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.workspaces: list[dict[str, Any]] = []
        self.models_by_workspace: dict[str, list[dict[str, Any]]] = {}
        self.reports_by_workspace: dict[str, list[dict[str, Any]]] = {}
        self.unavailable_datasets: set[str] = set()
        self.refreshed_at: dict[str, str] = {}
        self.schemas: dict[str, dict[str, Any]] = {}
        self.nova = NovaAgent(NovaSettings(_env_file=None), FakeLLM(configured=False))  # type: ignore[arg-type]

    async def call(self, agent_id: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((agent_id, tool, arguments))
        if agent_id == SEMANTIQ and tool == "list_workspaces":
            return {"status": "ok", "workspaces": self.workspaces}
        if agent_id == SEMANTIQ and tool == "list_semantic_models":
            return {"status": "ok", "models": self.models_by_workspace.get(arguments.get("workspace_id"), [])}
        if agent_id == SEMANTIQ and tool == "list_reports":
            return {"status": "ok", "reports": self.reports_by_workspace.get(arguments.get("workspace_id"), [])}
        if agent_id == SEMANTIQ and tool == "resolve_report_model":
            return {"status": "ok", "report": {"id": "rep-1", "name": "PO", "datasetId": "ds-1", "datasetWorkspaceId": "ws-1"}}
        if agent_id == SEMANTIQ and tool == "answer_question":
            if arguments.get("dataset_id") in self.unavailable_datasets:
                return {"status": "model_unavailable", "message": "Could not read the semantic model"}
            return self.semantiq
        if agent_id == SEMANTIQ and tool == "get_dataset_freshness":
            return {"status": "ok", "freshness": {"refreshedAt": self.refreshed_at.get(arguments.get("dataset_id"), "2026-10-31T00:00:00Z")}}
        if agent_id == SEMANTIQ and tool == "get_model_schema":
            schema = self.schemas.get(arguments.get("dataset_id"))
            return {"status": "ok", "schema": schema} if schema else {"status": "error", "message": "unreadable"}
        if agent_id == SEMANTIQ and tool == "search_model":
            return {"status": "ok", "matches": [{"kind": "measure", "table": "PO", "name": "Spend", "description": "Committed PO value"}], "stats": {}}
        if agent_id == SEMANTIQ and tool == "search_catalog_metadata":
            return {"status": "ok", "matches": [], "count": 0}
        if agent_id == NOVA and tool == "generate_visual":
            if self.nova_fails:
                raise AgentCallError("nova down")
            spec = await self.nova.generate(arguments["question"], arguments["columns"], arguments["rows"], preferred=arguments.get("preferred_type"))
            return {"status": "ok", "visual": spec.model_dump(exclude_none=True)}
        raise AssertionError(f"unexpected call {agent_id}.{tool}")


def _graph(agents: FakeAgents, llm: FakeLLM | None = None) -> SmartGraph:
    return SmartGraph(OrchestratorSettings(_env_file=None), agents, llm or FakeLLM(configured=False))  # type: ignore[arg-type]


async def _run(graph: SmartGraph, question: str, context: dict[str, Any] | None = CTX, user: str = "user@x.com", conv: str = "c1"):
    steps, message = [], None
    async for kind, payload in graph.run(question=question, user_email=user, conversation_id=conv, context=context or {}):
        if kind == "step":
            steps.append(payload)
        elif kind == "message":
            message = payload
    return steps, message


async def test_greeting_needs_no_agent():
    agents = FakeAgents()
    _, msg = await _run(_graph(agents), "hello")
    assert msg["kind"] == "info" and agents.calls == []


async def test_no_report_context_asks_to_name_one():
    agents = FakeAgents()
    _, msg = await _run(_graph(agents), "top vendors by spend", context={"catalog": []})
    assert agents.calls[0][1] == "search_catalog_metadata"
    assert "list_workspaces" in [call[1] for call in agents.calls]
    assert msg["kind"] == "info" and "menu" in msg["content"].lower()
    assert "open a report first" not in msg["content"].lower()


async def test_catalog_down_searches_workspace_models_for_injury_count():
    agents = FakeAgents(
        {
            **OK_RESULT,
            "columns": ["Injury Count"],
            "rows": [{"Injury Count": 7.0}],
            "row_count": 1,
        }
    )
    agents.workspaces = [{"id": "ws-inj", "name": "Safety"}]
    agents.models_by_workspace = {"ws-inj": [{"id": "ds-inj", "name": "Injury", "workspaceId": "ws-inj"}]}
    agents.reports_by_workspace = {
        "ws-inj": [{"id": "rep-inj", "name": "Injury Dashboard", "datasetId": "ds-inj", "datasetWorkspaceId": "ws-inj", "workspaceId": "ws-inj"}]
    }
    question = "18th Oct to 24th Oct 2026 - Injury Count can u give me"
    _, msg = await _run(_graph(agents), question, context={"catalog": [], "catalog_unavailable": True})
    tools = [call[1] for call in agents.calls]
    assert tools[0] == "search_catalog_metadata"
    assert "list_workspaces" in tools
    assert "list_semantic_models" in tools and "list_reports" in tools
    answered = next(call for call in agents.calls if call[1] == "answer_question")
    assert answered[2]["dataset_id"] == "ds-inj"
    assert answered[2]["workspace_id"] == "ws-inj"
    assert "18th Oct" in answered[2]["question"]
    assert msg["kind"] == "answer" and "7" in msg["content"]
    assert "open a report first" not in msg["content"].lower()


async def test_unreadable_catalog_model_retries_workspace_matches():
    agents = FakeAgents(
        {
            **OK_RESULT,
            "columns": ["Injury Count"],
            "rows": [{"Injury Count": 7.0}],
            "row_count": 1,
        }
    )
    agents.unavailable_datasets = {"ds-bad", "ds-archive"}
    agents.workspaces = [{"id": "ws-inj", "name": "Safety"}]
    agents.models_by_workspace = {
        "ws-inj": [
            {"id": "ds-archive", "name": "Injury Archive", "workspaceId": "ws-inj"},
            {"id": "ds-inj", "name": "Injury", "workspaceId": "ws-inj"},
        ]
    }
    agents.reports_by_workspace = {"ws-inj": []}
    question = "18th Oct to 24th Oct 2026 - Injury Count can u give me"
    catalog = [
        {"portal_id": "p1", "title": "Injury Report", "workspace_id": "ws-bad", "dataset_id": "ds-bad"},
        {"portal_id": "p2", "title": "Injury", "workspace_id": "ws-inj", "dataset_id": "ds-inj"},
    ]
    _, msg = await _run(_graph(agents), question, context={"catalog": catalog})
    answered = [call[2]["dataset_id"] for call in agents.calls if call[1] == "answer_question"]
    assert answered == ["ds-inj"]
    assert msg["kind"] == "answer" and "7" in msg["content"]
    assert "could not read this report" not in msg["content"].lower()


async def test_main_workspace_model_is_used_before_a_draft_on_the_menu():
    agents = FakeAgents(
        {
            **OK_RESULT,
            "columns": ["Injury Count"],
            "rows": [{"Injury Count": 7.0}],
            "row_count": 1,
        }
    )
    agents.unavailable_datasets = set()
    agents.workspaces = [{"id": "ws-inj", "name": "Embedded PBI Portal"}]
    agents.models_by_workspace = {
        "ws-inj": [
            {"id": "draft", "name": "INJURY_REPORT_DRAFT", "workspaceId": "ws-inj"},
            {"id": "live", "name": "Injury", "workspaceId": "ws-inj"},
            {"id": "finance", "name": "Finance", "workspaceId": "ws-inj"},
        ]
    }
    catalog = [{"portal_id": "p1", "title": "INJURY_REPORT_DRAFT", "workspace_id": "ws-inj", "dataset_id": "draft"}]
    _, msg = await _run(_graph(agents), "is there any injuries in last 1 day?", context={"catalog": catalog})
    answered = [call[2]["dataset_id"] for call in agents.calls if call[1] == "answer_question"]
    assert answered[0] == "live"
    assert "finance" not in answered
    assert "INJURY_REPORT_DRAFT" not in msg["content"]
    assert "Injury" in msg["content"]


async def test_unreadable_production_model_never_offers_a_draft_fallback():
    agents = FakeAgents(
        {
            **OK_RESULT,
            "columns": ["Injuries"],
            "rows": [{"Injuries": 0}],
            "row_count": 1,
        }
    )
    agents.unavailable_datasets = {"live"}
    agents.workspaces = [{"id": "ws-inj", "name": "Embedded PBI Portal"}]
    agents.models_by_workspace = {
        "ws-inj": [
            {"id": "draft", "name": "INJURY_REPORT_DRAFT", "workspaceId": "ws-inj"},
            {"id": "live", "name": "Injury", "workspaceId": "ws-inj"},
        ]
    }
    agents.reports_by_workspace = {"ws-inj": []}
    graph = _graph(agents)
    ctx = {"catalog": [], "catalog_unavailable": True}
    _, msg = await _run(graph, "how many injuries on oct 12th 2026", context=ctx)
    answered = [call[2]["dataset_id"] for call in agents.calls if call[1] == "answer_question"]
    assert answered == ["live"]
    assert msg["kind"] == "error"
    assert msg["content"] == SMART_DOWN
    assert "INJURY_REPORT_DRAFT" not in msg["content"]
    assert "awaiting" not in msg


async def test_open_report_uses_menu_when_catalog_is_up():
    catalog = [{"portal_id": "rightship", "title": "RightShip", "workspace_id": "ws", "report_id": "rep", "dataset_id": "ds"}]
    _, msg = await _run(_graph(FakeAgents()), "Show me the RightShip report", context={"catalog": catalog})
    assert msg["openReportId"] == "rightship"
    assert msg["content"].startswith("Opening")


async def test_open_report_when_catalog_api_is_down():
    _, msg = await _run(_graph(FakeAgents()), "Open the Vessel Issues report", context={"catalog": [], "catalog_unavailable": True})
    assert msg["content"] == REPORT_DATABASE_DOWN
    assert "openReportId" not in msg


async def test_both_discovery_paths_down():
    class Down(FakeAgents):
        async def call(self, agent_id, tool, arguments):
            raise AgentCallError("down")

    _, msg = await _run(_graph(Down()), "total vessel incidents this year", context={"catalog": [], "catalog_unavailable": True})
    assert msg["content"] == SMART_DOWN


async def test_catalog_match_runs_without_open_report():
    agents = FakeAgents(
        {
            **OK_RESULT,
            "columns": ["Count of incidents"],
            "rows": [{"Count of incidents": 5192.0}],
            "row_count": 1,
        }
    )
    catalog = [
        {
            "portal_id": "2",
            "title": "Incident Dashboard",
            "menu_path": "Safety Reporting > Incident",
            "workspace_id": "ws-2",
            "report_id": "rep-inc",
        }
    ]
    _, msg = await _run(_graph(agents), "give me incidents count", context={"catalog": catalog})
    tools = [call[1] for call in agents.calls]
    assert "resolve_report_model" in tools and "list_workspaces" in tools
    assert msg["kind"] == "answer"
    normalized = msg["content"].replace(",", "")
    assert "5192" in normalized
    assert not msg.get("stats")
    assert not msg.get("table")


async def test_data_question_full_path():
    agents = FakeAgents()
    steps, msg = await _run(
        _graph(agents),
        "Compare spend by vendor",
        context={**CTX, "catalog": [{"portal_id": "p1", "title": "PO", "workspace_id": "ws-1", "dataset_id": "ds-1"}]},
    )
    tools = [c[1] for c in agents.calls]
    assert "list_workspaces" in tools and "resolve_report_model" in tools and "answer_question" in tools and "generate_visual" in tools
    answered = next(c for c in agents.calls if c[1] == "answer_question")
    assert answered[2]["user_email"] == "user@x.com" and answered[2]["dataset_id"] == "ds-1"
    assert msg["kind"] == "answer" and msg["confidence"] == 1.0
    assert msg["visual"]["kind"] == "chart" and msg["visual"]["chart"]["datasets"][0]["data"] == [400.0, 250.0, 100.0]
    assert {"label": "Total Spend", "value": "750"} in msg["stats"]
    assert msg["agents"] == [SEMANTIQ, NOVA] and msg["rlsUser"] == "user@x.com"
    assert "750" in msg["content"]
    assert {s["step"] for s in steps} >= {"classify", "retrieve", "query", "visualize", "verify"}


async def test_dataset_in_context_skips_resolution():
    agents = FakeAgents()
    await _run(_graph(agents), "spend by vendor", context={**CTX, "dataset_id": "ds-9"})
    answered = next(c for c in agents.calls if c[1] == "answer_question")
    assert "list_workspaces" in [c[1] for c in agents.calls]
    assert answered[2]["dataset_id"] == "ds-9"


async def test_nova_failure_still_answers():
    _, msg = await _run(_graph(FakeAgents(nova_fails=True)), "Compare spend by vendor")
    assert msg["kind"] == "answer" and "visual" not in msg and msg["table"]["rows"]


async def test_table_visual_preferred():
    agents = FakeAgents()
    _, msg = await _run(_graph(agents), "give a table (visual) for all spend by vendor")
    assert msg["kind"] == "answer"
    assert msg["visual"]["kind"] == "table"
    assert msg["visual"]["table"]["rows"]
    nova = next(c for c in agents.calls if c[1] == "generate_visual")
    assert nova[2].get("preferred_type") == "table"


async def test_clarification_is_passed_through():
    agents = FakeAgents({"status": "needs_clarification", "clarifying_question": "Committed or invoiced?", "candidates": ["PO[Spend]"]})
    _, msg = await _run(_graph(agents), "how much did we spend")
    assert msg["kind"] == "clarification" and msg["candidates"] == ["PO[Spend]"] and msg["confidence"] == 0.0


async def test_low_intent_clarity_is_gated():
    result = {**OK_RESULT, "confidence_components": {**OK_RESULT["confidence_components"], "intent_clarity": 0.9}}
    _, msg = await _run(_graph(FakeAgents(result)), "spend by vendor")
    assert msg["kind"] == "low_confidence" and msg["confidence"] < 0.98 and "visual" not in msg


async def test_ungrounded_llm_summary_is_replaced():
    llm = FakeLLM(
        {
            "IntentResult": [{"intent": "data_question", "wants_visual": True, "standalone_question": "spend by vendor"}],
            "SummaryResult": [{"summary": "Spend reached 9,999,999 led by Acme.", "highlights": []}],
        }
    )
    _, msg = await _run(_graph(FakeAgents(), llm), "spend by vendor")
    assert "9,999,999" not in msg["content"] and "750" in msg["content"]
    assert msg["confidence"] == 1.0


async def test_grounded_llm_summary_is_kept():
    llm = FakeLLM(
        {
            "IntentResult": [{"intent": "data_question", "standalone_question": "spend by vendor"}],
            "SummaryResult": [{"summary": "Acme leads with 400 of 750 total.", "highlights": ["Acme is 53.33% of spend"]}],
        }
    )
    _, msg = await _run(_graph(FakeAgents(), llm), "spend by vendor")
    assert msg["content"] == "Acme leads with 400 of 750 total."
    assert msg["highlights"] == ["Acme is 53.33% of spend"]


async def test_schema_question_lists_fields():
    agents = FakeAgents()
    _, msg = await _run(_graph(agents), "which measures are available for spend?")
    assert "PO[Spend]" in msg["content"] and msg["citations"][0]["name"] == "Spend"
    assert any(call[1] == "search_model" for call in agents.calls)


async def test_internal_semantiq_errors_are_not_shown_to_users():
    agents = FakeAgents({"status": "model_unavailable", "message": "Power BI service principal is not configured (PBI_CLIENT_SECRET)"})
    _, msg = await _run(_graph(agents), "spend by vendor")
    assert msg["kind"] == "error" and msg["content"] == SMART_DOWN and "PBI_" not in msg["content"]


async def test_query_failed_offers_candidates():
    agents = FakeAgents({"status": "query_failed", "message": "I could not build a valid query.", "candidates": ["PO[Spend]"], "dax": "EVALUATE x"})
    _, msg = await _run(_graph(agents), "spend by vendor")
    assert msg["kind"] == "low_confidence" and msg["candidates"] == ["PO[Spend]"] and msg["query"] == "EVALUATE x"


async def test_filter_leakage_is_not_treated_as_model_unreadable():
    from smart_orchestrator.errors import model_unreadable_message

    msg_text = "Planned value 5243 does not match independently filtered validation 4."
    agents = FakeAgents({"status": "query_failed", "message": msg_text})
    _, msg = await _run(_graph(agents), "incidents for november 2026")
    assert msg["content"] == msg_text
    assert msg["content"] != model_unreadable_message("Incident")


async def test_semantiq_unavailable_is_an_error_message():
    class Down(FakeAgents):
        async def call(self, agent_id, tool, arguments):
            raise AgentCallError("down")

    _, msg = await _run(_graph(Down()), "spend by vendor", context={**CTX, "dataset_id": "ds-1"})
    assert msg["kind"] == "error" and msg["content"] == SMART_DOWN


@pytest.mark.parametrize("other_user", ["someone@x.com"])
async def test_memory_is_per_user(other_user):
    llm = FakeLLM({"IntentResult": [{"intent": "greeting", "standalone_question": "hi"}]})
    graph = _graph(FakeAgents(), llm)
    await _run(graph, "hi", user="user@x.com", conv="same")
    await _run(graph, "hi", user="user@x.com", conv="same")
    await _run(graph, "hi", user=other_user, conv="same")
    mine = await graph.graph.aget_state({"configurable": {"thread_id": "user@x.com:same"}})
    theirs = await graph.graph.aget_state({"configurable": {"thread_id": f"{other_user}:same"}})
    assert len(mine.values["history"]) == 4 and len(theirs.values["history"]) == 2
