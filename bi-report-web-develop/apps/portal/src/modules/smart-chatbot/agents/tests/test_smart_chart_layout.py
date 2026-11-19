"""Layout contract for NOVA cartesian/pie specs (regression)."""

from pbi_nova_visual_generator.chart_extensions import buildable_chart, build_echarts_option
from pbi_nova_visual_generator.visual_spec import build_spec, buildable, recommend


def test_build_spec_pie_type_donut():
    rows = [{"Vendor": "A", "Spend": 10.0}, {"Vendor": "B", "Spend": 20.0}]
    spec = build_spec("donut", ["Vendor", "Spend"], rows, "Vendor", ["Spend"], title="t", max_points=50, rationale="")
    assert spec.chart is not None
    assert spec.chart.type == "donut"


def test_funnel_option_from_rows():
    rows = [{"Stage": "Lead", "Count": 10.0}, {"Stage": "Won", "Count": 3.0}]
    opt = build_echarts_option("funnel", rows, "Stage", ["Count"], columns=["Stage", "Count"])
    assert opt and opt["series"][0]["type"] == "funnel"


def test_map_buildable_with_country():
    rows = [{"Country": "India", "Spend": 5.0}]
    assert buildable("map", ["Country", "Spend"], rows, "Country", ["Spend"])


def test_recommend_still_defaults_bar():
    rows = [{"Vendor": "A", "Spend": 1.0}, {"Vendor": "B", "Spend": 2.0}]
    assert recommend("spend by vendor", ["Vendor", "Spend"], rows)[0][0] == "bar"