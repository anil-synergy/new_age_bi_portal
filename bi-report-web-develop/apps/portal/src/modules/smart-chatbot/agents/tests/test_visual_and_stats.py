from pbi_nova_visual_generator.agent import NovaAgent
from pbi_nova_visual_generator.settings import NovaSettings
from pbi_nova_visual_generator.visual_spec import build_spec, recommend
from smart_orchestrator.graph import _heuristic_intent
from smart_orchestrator.stats import compute_stats, deterministic_summary, stat_cards
from tests.conftest import FakeLLM

VENDOR_ROWS = [{"Vendor": "Acme", "Spend": 400.0}, {"Vendor": "Blue", "Spend": 250.0}, {"Vendor": "Cove", "Spend": 100.0}]
MONTH_ROWS = [{"Month": "2026-03-01", "Spend": 30.0}, {"Month": "2026-01-01", "Spend": 10.0}, {"Month": "2026-02-01", "Spend": 20.0}]


def test_recommend_shapes():
    assert recommend("spend by vendor", ["Vendor", "Spend"], VENDOR_ROWS)[0][0] == "bar"
    assert recommend("vendor share of spend", ["Vendor", "Spend"], VENDOR_ROWS)[0][0] == "pie"
    assert recommend("spend", ["Month", "Spend"], MONTH_ROWS)[0][0] == "line"
    doc_rows = [{"DOC": f"D{i}", "Injuries": float(i + 1)} for i in range(24)]
    assert recommend("create pie chart for total injuries split by DOC", ["DOC", "Injuries"], doc_rows)[0][0] == "pie"
    assert recommend("total", ["Spend"], [{"Spend": 5.0}])[0] == ["kpi", "table"]
    assert recommend("names", ["Vendor"], [{"Vendor": "A"}])[0] == ["table"]


def test_chart_values_are_copied_and_line_sorted():
    spec = build_spec("line", ["Month", "Spend"], MONTH_ROWS, "Month", ["Spend"], title="t", max_points=50)
    assert spec.chart.labels == ["2026-01-01", "2026-02-01", "2026-03-01"]
    assert spec.chart.datasets[0].data == [10.0, 20.0, 30.0]


def test_bar_truncates_to_top_n():
    rows = [{"Vendor": f"V{i}", "Spend": float(i)} for i in range(10)]
    spec = build_spec("bar", ["Vendor", "Spend"], rows, "Vendor", ["Spend"], title="t", max_points=3)
    assert spec.truncated and spec.chart.labels == ["V9", "V8", "V7"]


def test_kpi_delta_against_prior():
    spec = build_spec("kpi", ["Spend", "Spend PY"], [{"Spend": 110.0, "Spend PY": 100.0}], None, ["Spend", "Spend PY"], title="t", max_points=50)
    assert spec.kind == "kpi" and spec.kpi.value == "110" and spec.kpi.delta == 10.0


async def test_nova_ignores_llm_choice_outside_allowed():
    llm = FakeLLM({"VisualChoice": [{"kind": "scatter", "title": "Nice"}]})
    agent = NovaAgent(NovaSettings(_env_file=None), llm)  # type: ignore[arg-type]
    spec = await agent.generate("spend by vendor", ["Vendor", "Spend"], VENDOR_ROWS)
    assert spec.kind == "chart" and spec.chart.type == "bar"
    assert spec.title == "Nice"


async def test_nova_preferred_type_wins_when_allowed():
    agent = NovaAgent(NovaSettings(_env_file=None), FakeLLM(configured=False))  # type: ignore[arg-type]
    spec = await agent.generate("spend by vendor", ["Vendor", "Spend"], VENDOR_ROWS, preferred="pie")
    assert spec.chart.type == "pie"


def test_pie_many_categories_rolls_into_other():
    rows = [{"DOC": f"D{i}", "Injuries": float(i + 1)} for i in range(24)]
    spec = build_spec(
        "pie",
        ["DOC", "Injuries"],
        rows,
        "DOC",
        ["Injuries"],
        title="t",
        max_points=50,
        rationale="test",
    )
    assert spec.chart.type == "pie"
    assert "Other" in spec.chart.labels
    assert spec.truncated
    plotted = sum(spec.chart.datasets[0].data)
    assert plotted == sum(r["Injuries"] for r in rows)


async def test_nova_pie_preferred_with_many_categories():
    rows = [{"DOC": f"D{i}", "Injuries": float(i + 1)} for i in range(24)]
    agent = NovaAgent(NovaSettings(_env_file=None), FakeLLM(configured=False))  # type: ignore[arg-type]
    question = "create pie chart for total injuries split by DOC"
    spec = await agent.generate(question, ["DOC", "Injuries"], rows, preferred="pie")
    assert spec.chart.type == "pie"
    assert "Other" in spec.chart.labels


def test_heuristic_intent_sets_pie_preferred():
    intent = _heuristic_intent("create pie chart for total injuries split by DOC")
    assert intent.preferred_visual == "pie"
    assert intent.wants_visual


def test_heuristic_table_visual_in_question():
    intent = _heuristic_intent("give a table (visual) for all sppl incidents")
    assert intent.preferred_visual == "table"
    assert intent.wants_visual


def test_table_spec_embeds_rows():
    rows = [{"Incident": f"I{i}", "DOC": f"D{i % 3}", "Count": float(i)} for i in range(5)]
    spec = build_spec("table", list(rows[0].keys()), rows, None, [], title="Incidents", max_points=50)
    assert spec.kind == "table"
    assert spec.table is not None
    assert len(spec.table.rows) == 5


def test_matrix_pivot():
    rows = [
        {"Region": "East", "Month": "Jan", "Spend": 10.0},
        {"Region": "East", "Month": "Feb", "Spend": 20.0},
        {"Region": "West", "Month": "Jan", "Spend": 5.0},
    ]
    spec = build_spec("matrix", ["Region", "Month", "Spend"], rows, "Region", ["Spend"], title="t", max_points=50)
    assert spec.kind == "matrix"
    assert spec.matrix is not None
    jan = spec.matrix.column_labels.index("Jan")
    feb = spec.matrix.column_labels.index("Feb")
    east = spec.matrix.row_labels.index("East")
    assert spec.matrix.cells[east][jan] == 10.0
    assert spec.matrix.cells[east][feb] == 20.0


async def test_nova_preferred_table():
    rows = [{"Vendor": "A", "Spend": 1.0}, {"Vendor": "B", "Spend": 2.0}]
    agent = NovaAgent(NovaSettings(_env_file=None), FakeLLM(configured=False))  # type: ignore[arg-type]
    spec = await agent.generate("give a table for vendors", ["Vendor", "Spend"], rows, preferred="table")
    assert spec.kind == "table"
    assert spec.table and len(spec.table.rows) == 2


def test_stats_and_template_summary_are_grounded():
    stats = compute_stats(["Vendor", "Spend"], VENDOR_ROWS)
    entry = stats["measures"]["Spend"]
    assert entry["total"] == 750.0 and entry["top"]["label"] == "Acme" and entry["top_share_pct"] == 53.33
    text = deterministic_summary("q", stats)
    assert "750" in text and "Acme" in text
    cards = stat_cards(stats)
    assert {"label": "Total Spend", "value": "750"} in cards


def test_stats_change_over_time():
    entry = compute_stats(["Month", "Spend"], MONTH_ROWS)["measures"]["Spend"]
    assert entry["change_pct"] == 200.0


def test_empty_result_summary():
    assert "no rows" in deterministic_summary("q", compute_stats(["Spend"], []))
