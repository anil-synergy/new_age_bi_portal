"""Notes are created through SMART (N.O.V.A. writes them) and kept in the Visual box."""

from __future__ import annotations

import pytest

from pbi_nova_visual_generator.notes import DEFAULT_STYLE, build_note
from smart_orchestrator.graph import note_request
from tests.conftest import FakeLLM
from tests.test_graph import _graph, _run


@pytest.mark.parametrize(
    "question,title,text",
    [
        ('make a note titled "Fleet check": review IMO list', "Fleet check", "review IMO list"),
        ("note: call the yard about docking", "call the yard about docking", "call the yard about docking"),
        ("add a note Fleet check: review IMO list", "Fleet check", "review IMO list"),
    ],
)
def test_note_commands_are_recognised(question, title, text):
    parsed = note_request(question)
    assert parsed is not None
    assert parsed["text"] == text
    assert parsed["title"] == title


def test_normal_questions_are_not_notes():
    assert note_request("how many vessels are in SPPL") is None
    assert note_request("show my notes") is None  # reading notes is not a command to create one


def test_nova_cleans_title_and_rejects_bad_style_values():
    note = build_note("  Fleet   check  ", "x" * 5000, {"background": "red", "fontSize": 99, "fontFamily": "comic", "bold": True})
    assert note["title"] == "Fleet check"
    assert len(note["text"]) == 4000
    assert note["style"]["background"] == DEFAULT_STYLE["background"]  # 'red' is not a hex colour
    assert note["style"]["fontSize"] == DEFAULT_STYLE["fontSize"]
    assert note["style"]["fontFamily"] == DEFAULT_STYLE["fontFamily"]
    assert note["style"]["bold"] is True


def test_empty_title_gets_a_default():
    assert build_note("   ")["title"] == "Note"


class NovaStub:
    def __init__(self):
        self.calls = []

    async def call(self, agent, tool, arguments):
        self.calls.append((agent, tool, arguments))
        return {"status": "ok", "note": build_note(arguments["title"], arguments.get("text", ""))}


async def test_graph_answers_a_note_request_through_nova():
    nova = NovaStub()
    graph = _graph(nova, FakeLLM(configured=False))
    _, msg = await _run(graph, "make a note titled Fleet check: review IMO list")
    assert nova.calls and nova.calls[0][1] == "generate_note"
    assert msg["kind"] == "answer"
    assert msg["note"]["title"] == "Fleet check" and msg["note"]["text"] == "review IMO list"
    assert "Visual box" in msg["content"]
