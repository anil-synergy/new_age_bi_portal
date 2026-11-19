"""Plain vessel / IMO questions go to the vessel register report; a named module goes to its own report."""

from __future__ import annotations

import pytest

from smart_orchestrator.ontology_ranking import vessel_register_dataset_id
from tests.test_retrieval_pipeline import _retriever

REGISTER_ID = "6fe28c18-151c-4b05-a696-979f0906ddee"


def _pool():
    return [
        {"title": "Fleet Count Vessel Portal", "workspace_id": "ws", "workspace_name": "Embedded PBI", "menu_path": "Fleet > Vessel", "dataset_id": REGISTER_ID, "report_id": "r-vp", "source": "portal"},
        {"title": "Injury Dashboard", "workspace_id": "ws", "workspace_name": "Embedded PBI", "menu_path": "Safety > Injury", "dataset_id": "ds-injury", "report_id": "r-inj", "source": "portal"},
        {"title": "Maersk Tankers", "workspace_id": "ws", "workspace_name": "Embedded PBI Portal", "menu_path": "Tankers", "dataset_id": "ds-maersk", "source": "workspace"},
    ]


@pytest.mark.parametrize(
    "question",
    [
        "no of handymax tankers in sppl for the month oct2026",
        "how many vessels are managed by SPPL",
        "list the IMO numbers of bulk carriers",
        "total deadweight of handymax vessels",
        "vessel count by owner",
    ],
)
def test_plain_vessel_questions_route_to_the_register(question):
    assert vessel_register_dataset_id(question) == REGISTER_ID


@pytest.mark.parametrize(
    "question",
    [
        "number of injuries for handymax vessels in oct 2026",
        "incidents by vessel type this year",
        "audit findings for SPPL vessels",
        "what is the weather today",  # not a vessel question
    ],
)
def test_named_modules_and_non_vessel_questions_do_not_route(question):
    assert vessel_register_dataset_id(question) is None


async def test_plain_handymax_question_selects_the_register_even_with_no_word_overlap():
    decision = await _retriever().retrieve("no of handymax tankers in sppl for the month oct2026", _pool())
    assert decision.action == "select"
    assert decision.reason == "vessel_register"
    assert decision.selected.item["dataset_id"] == REGISTER_ID


async def test_injury_question_still_goes_to_the_injury_module():
    decision = await _retriever().retrieve("number of injuries for handymax vessels in oct 2026", _pool())
    assert decision.reason != "vessel_register"
    assert decision.selected is None or decision.selected.item["dataset_id"] != REGISTER_ID or decision.action != "select"


async def test_draft_request_keeps_environment_rules():
    pool = _pool() + [{"title": "Fleet Count Draft", "workspace_id": "ws", "dataset_id": "ds-draft", "source": "workspace"}]
    decision = await _retriever().retrieve("draft version of handymax tankers in sppl", pool)
    assert decision.reason != "vessel_register"
