from pbi_semantiq_agent.metadata import Column, Measure, SemanticModel, Table
from pbi_semantiq_agent.ontology import apply_binding_slice_adjustments, bind_concepts, concepts_in_question, validation_dax
from pbi_semantiq_agent.query_plan import build_query_plan


def _mini_model() -> SemanticModel:
    table = Table(
        name="Vessels",
        columns=[
            Column("IMO_NUMBER"),
            Column("SUB_TYPE"),
            Column("MANAGER_GROUP"),
            Column("MY_DATE", data_type="DateTime"),
        ],
        measures=[],
    )
    table.measures = [
        Measure("Type Group", "Vessels", expression="SELECTEDVALUE(...)"),
        Measure("Fleet Size", "Vessels", expression="DISTINCTCOUNT(Vessels[IMO_NUMBER])"),
    ]
    return SemanticModel("ws", "ds", "Fleet Count", [table], [])


def test_concepts_in_handymax_question():
    q = "How many Handymax vessels does SPPL have in Oct 2026 in fleet count vessel portal?"
    concepts = concepts_in_question(q)
    assert "vessel_subtype" in concepts
    assert "manager_company" in concepts
    assert "fleet_count" in concepts


def test_bind_concepts_maps_columns():
    model = _mini_model()
    bindings = bind_concepts("Handymax SPPL Oct 2026 fleet size", model, "ds")
    assert bindings.vessel_id and bindings.vessel_id.column == "IMO_NUMBER"
    assert bindings.subtype and bindings.subtype.column == "SUB_TYPE"
    assert bindings.manager and bindings.manager.column == "MANAGER_GROUP"
    scores = [(1.0, model.all_measures()[0]), (1.0, model.all_measures()[1])]
    adjusted = apply_binding_slice_adjustments(bindings, scores)
    assert adjusted[0][0] < adjusted[1][0]


def test_validation_dax_uses_plan_literals():
    model = _mini_model()
    q = "Handymax SPPL Oct 2026 fleet size"
    bindings = bind_concepts(q, model, "ds")
    plan = build_query_plan(q, bindings)
    dax = validation_dax(bindings, "", plan)
    assert dax
    assert "Handymax" in dax
    assert "SPPL" in dax
    assert "2026" in dax and ("MONTH" in dax or "DATE(" in dax)
    assert "VALUES" not in dax
