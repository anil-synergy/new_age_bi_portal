import re

from pbi_semantiq_agent.dax_sanitize import sanitize_group_column_filters
from pbi_semantiq_agent.dax_skeleton import try_grouped_breakdown_dax
from pbi_semantiq_agent.metadata import Column, Measure, SemanticModel, Table
from pbi_semantiq_agent.ontology import FieldBinding, bind_concepts, ConceptBindings
from pbi_semantiq_agent.query_plan import FilterLiteral, QueryPlan, build_query_plan


def _injury_model() -> SemanticModel:
    return SemanticModel(
        "ws",
        "ds",
        "Injury",
        [
            Table("VW_INJURY", columns=[Column("MANAGER_GROUP")]),
            Table("Measure", measures=[Measure("INJURY_COUNT", "Measure", expression="COUNTROWS(VW_INJURY)")]),
        ],
        [],
    )


def test_plan_split_by_doc_is_group_not_filter():
    q = "create pie chart for total injuries split by DOC"
    plan = build_query_plan(q, None)
    assert "manager_company" in plan.group_by
    assert plan.output_type == "table"
    manager_filters = [fl for fl in plan.filter_literals if fl.role == "manager"]
    assert not any(fl.raw_value.upper() in {"GROUP", "DOC"} for fl in manager_filters)


def test_skeleton_injuries_by_manager():
    model = _injury_model()
    q = "create pie chart for total injuries split by DOC"
    bindings = bind_concepts(q, model, "ds")
    plan = build_query_plan(q, bindings)
    out = try_grouped_breakdown_dax(q, plan, bindings, model)
    assert out is not None
    dax, _ = out
    assert "SUMMARIZECOLUMNS('VW_INJURY'[MANAGER_GROUP]" in dax
    assert "CALCULATE('Measure'[INJURY_COUNT])" in dax
    assert re.search(r"MANAGER_GROUP\]\s*=\s*\"GROUP\"", dax, re.I) is None


def test_sanitizer_strips_group_literal():
    bindings = ConceptBindings(
        dataset_id="ds",
        concepts={"manager_company"},
        manager=FieldBinding("manager_company", "VW_INJURY", "MANAGER_GROUP"),
        count_measure="'Measure'[INJURY_COUNT]",
    )
    plan = QueryPlan(
        original_question="split by doc",
        group_by=["manager_company"],
        output_type="table",
    )
    bad = """EVALUATE SUMMARIZECOLUMNS(
        'VW_INJURY'[MANAGER_GROUP],
        "Total Injuries", CALCULATE(
            'Measure'[INJURY_COUNT],
            'VW_INJURY'[MANAGER_GROUP] = "GROUP"
        )
    )"""
    clean = sanitize_group_column_filters(bad, plan, bindings)
    assert '= "GROUP"' not in clean and '="GROUP"' not in clean
    assert "'Measure'[INJURY_COUNT]" in clean


def test_sanitizer_keeps_sppl_filter():
    bindings = ConceptBindings(
        dataset_id="ds",
        concepts={"manager_company"},
        manager=FieldBinding("manager_company", "VW_INJURY", "MANAGER_GROUP"),
    )
    plan = QueryPlan(
        original_question="injuries for sppl",
        filter_literals=[FilterLiteral(concept="manager_company", raw_value="SPPL", role="manager")],
        group_by=[],
    )
    dax = "EVALUATE CALCULATE('Measure'[INJURY_COUNT], 'VW_INJURY'[MANAGER_GROUP] = \"SPPL\")"
    assert sanitize_group_column_filters(dax, plan, bindings) == dax