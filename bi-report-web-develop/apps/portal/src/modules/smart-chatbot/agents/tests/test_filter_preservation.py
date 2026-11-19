from datetime import date

from pbi_semantiq_agent.filter_preservation import check_filter_preservation, dax_has_time_constraint
from pbi_semantiq_agent.metadata import Column, SemanticModel, Table
from pbi_semantiq_agent.ontology import ConceptBindings, FieldBinding, bind_concepts, reconcile_values, validation_dax, ValidationOutcome
from pbi_semantiq_agent.query_plan import build_query_plan, extract_time_filter


def test_november_2026_time_filter_bounds():
    tf = extract_time_filter("Incidents for November 2026?")
    assert tf["month"] == 11 and tf["year"] == 2026
    assert tf["start_date"] == "2026-11-01"
    assert tf["end_date_exclusive"] == "2026-12-01"
    assert tf["mandatory"] is True


def test_incident_plan_intent():
    model = SemanticModel("ws", "ds", "Incident", [Table("Incidents", columns=[Column("DATE_OF_INCIDENT", data_type="DateTime")])], [])
    bindings = bind_concepts("incidents for november 2026?", model, "ds")
    plan = build_query_plan("incidents for november 2026?", bindings)
    assert plan.primary_intent == "count_incidents"
    assert plan.time_filter.get("mandatory")
    assert bindings.date and bindings.date.column == "DATE_OF_INCIDENT"


def test_guard_rejects_unfiltered_incident_dax():
    model = SemanticModel("ws", "ds", "Incident", [], [])
    bindings = ConceptBindings(
        dataset_id="ds",
        concepts={"incident", "reporting_period"},
        date=FieldBinding("reporting_period", "Incidents", "DATE_OF_INCIDENT", "DateTime"),
        count_measure="[Incident Count]",
    )
    from pbi_semantiq_agent.query_plan import QueryPlan

    plan = QueryPlan(
        original_question="incidents for november 2026?",
        time_filter=extract_time_filter("incidents for november 2026?"),
    )
    dax = 'EVALUATE ROW("Incidents", [Incident Count])'
    assert check_filter_preservation(dax, plan, bindings, model) is not None
    good = (
        "EVALUATE ROW(\"Incidents\", CALCULATE([Incident Count], "
        "YEAR('Incidents'[DATE_OF_INCIDENT])=2026, MONTH('Incidents'[DATE_OF_INCIDENT])=11))"
    )
    assert check_filter_preservation(good, plan, bindings, model) is None
    assert dax_has_time_constraint(good, plan, bindings)


def test_filter_leakage_reconcile():
    planned = ValidationOutcome("ok", planned_value=5243.0)
    validation_rows = [{"ValidationCount": 4.0}]
    out = reconcile_values(planned, validation_rows, mandatory_time_filter=True)
    assert out.status == "filter_leakage"
    assert out.validation_value == 4.0


def test_treatas_other_value_does_not_satisfy_sppl():
    from pbi_semantiq_agent.filter_preservation import literal_filters_satisfied
    from pbi_semantiq_agent.query_plan import FilterLiteral, QueryPlan

    bindings = ConceptBindings(
        dataset_id="ds",
        manager=FieldBinding("manager_company", "Fleet", "MANAGER_GROUP"),
    )
    plan = QueryPlan(
        original_question="x",
        filter_literals=[FilterLiteral(concept="manager_company", raw_value="SPPL", role="manager")],
    )
    dax = 'EVALUATE ROW("x", CALCULATE(1, TREATAS({"Other"}, \'Fleet\'[MANAGER_GROUP])))'
    assert literal_filters_satisfied(dax, plan, bindings) == ["manager_company='SPPL'"]


def test_measure_with_unrelated_all_not_rejected():
    from pbi_semantiq_agent.filter_preservation import measure_strips_date_filters
    from pbi_semantiq_agent.metadata import Measure

    model = SemanticModel(
        "ws",
        "ds",
        "M",
        [Table("T", measures=[Measure("KPI", "T", expression="CALCULATE(COUNT(T[x]), ALL(T[Region]))")])],
        [],
    )
    bindings = ConceptBindings(
        dataset_id="ds",
        date=FieldBinding("reporting_period", "Calendar", "Date"),
    )
    assert measure_strips_date_filters(model, "EVALUATE ROW(\"x\", [KPI])", bindings) is None


def test_unfiltered_incidents_allowed_without_period():
    plan = build_query_plan("Incidents?", bindings=None)
    assert not plan.time_filter
    dax = 'EVALUATE ROW("Incidents", [Incident Count])'
    assert check_filter_preservation(dax, plan, None, None) is None


def test_sppl_november_plan_and_validation_dax():
    model = SemanticModel(
        "ws",
        "ds",
        "Incident",
        [
            Table("Incidents", columns=[Column("DATE_OF_INCIDENT", data_type="DateTime")]),
            Table("Calendar", columns=[Column("Date", data_type="DateTime")]),
            Table("Fleet", columns=[Column("MANAGER_GROUP")]),
        ],
        [
            __import__("pbi_semantiq_agent.metadata", fromlist=["Relationship"]).Relationship(
                "Incidents",
                "DATE_OF_INCIDENT",
                "Calendar",
                "Date",
                cardinality="Many:One",
                active=True,
            )
        ],
    )
    q = "incidents for SPPL in november 2026"
    bindings = bind_concepts(q, model, "ds")
    bindings.manager = FieldBinding("manager_company", "Fleet", "MANAGER_GROUP")
    plan = build_query_plan(q, bindings)
    assert plan.entities.get("manager_company") == "SPPL"
    assert plan.time_filter.get("month") == 11
    assert bindings.date_via_calendar
    assert bindings.date and bindings.date.table == "Calendar"
    vdx = validation_dax(bindings, "[Incident Count]", plan)
    assert vdx and "SPPL" in vdx and "2026" in vdx


def test_validation_dax_incident_includes_date():
    bindings = ConceptBindings(
        dataset_id="ds",
        concepts={"incident", "reporting_period"},
        date=FieldBinding("reporting_period", "Incidents", "DATE_OF_INCIDENT", "DateTime"),
        count_measure="[Incident Count]",
    )
    plan = build_query_plan("incidents for november 2026?", bindings)
    planned = "EVALUATE ROW(\"X\", CALCULATE([Incident Count], MONTH('Incidents'[DATE_OF_INCIDENT])=11))"
    check = validation_dax(bindings, planned, plan)
    assert check is not None
    assert "DATE(2026, 11, 1)" in check or "MONTH" in check


def test_last_month_relative():
    tf = extract_time_filter("incidents last month", today=date(2026, 11, 15))
    assert tf["month"] == 10 and tf["year"] == 2026
