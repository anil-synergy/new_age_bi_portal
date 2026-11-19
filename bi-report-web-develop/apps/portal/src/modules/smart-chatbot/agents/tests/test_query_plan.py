from pbi_semantiq_agent.metadata import Column, SemanticModel, Table
from pbi_semantiq_agent.ontology import bind_concepts
from pbi_semantiq_agent.query_plan import build_query_plan


def test_query_plan_handymax_sppl_oct():
    model = SemanticModel(
        "ws",
        "ds",
        "Fleet",
        [
            Table(
                "Vessels",
                columns=[
                    Column("IMO_NUMBER"),
                    Column("SUB_TYPE"),
                    Column("MANAGER_GROUP"),
                    Column("MY_DATE", data_type="DateTime"),
                ],
            )
        ],
        [],
    )
    q = "no of handymax tankers in sppl for oct 2026 fleet count"
    bindings = bind_concepts(q, model, "ds")
    plan = build_query_plan(q, bindings)
    assert plan.aggregation == "distinct_count"
    assert plan.entities.get("vessel_subtype") == "Handymax"
    assert plan.entities.get("manager_company") == "SPPL"
    assert plan.time_filter.get("year") == 2026
    assert plan.time_filter.get("month") == 10
