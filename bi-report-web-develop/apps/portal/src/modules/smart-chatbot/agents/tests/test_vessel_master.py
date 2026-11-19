from pbi_semantiq_agent.metadata import Column, SemanticModel, Table, select_slice
from pbi_semantiq_agent.ontology import bind_concepts
from pbi_semantiq_agent.vessel_master import vessel_master_table


def _model_with_master() -> SemanticModel:
    return SemanticModel(
        "ws",
        "ds",
        "Injury",
        [
            Table("VW_INJURY", columns=[Column("MANAGER_GROUP"), Column("IMO")]),
            Table(
                "IMO_MASTER_LIST",
                columns=[
                    Column("IMO"),
                    Column("MANAGER_GROUP"),
                    Column("VESSEL_TYPE"),
                    Column("VESSEL_NAME"),
                    Column("HANDOVER_DATE", data_type="DateTime"),
                ],
            ),
        ],
        [],
    )


def test_prefers_imo_master_for_manager_when_both_exist():
    model = _model_with_master()
    q = "injuries split by doc"
    bindings = bind_concepts(q, model, "ds")
    assert bindings.vessel_master_table == "IMO_MASTER_LIST"
    assert bindings.manager
    assert bindings.manager.table == "IMO_MASTER_LIST"
    assert bindings.manager.column == "MANAGER_GROUP"
    assert bindings.manager.source == "vessel_master"


def test_slice_includes_master_columns():
    model = _model_with_master()
    q = "injuries by manager group"
    bindings = bind_concepts(q, model, "ds")
    sl = select_slice(model, q, bindings=bindings)
    assert "IMO_MASTER_LIST" in sl.tables
    col_names = {c.name for t, c in sl.columns if t == "IMO_MASTER_LIST"}
    assert "MANAGER_GROUP" in col_names
    assert "VESSEL_NAME" in col_names


def test_vessel_master_table_detection():
    rules = {
        "vessel_dimension_table": {
            "table_names": ["IMO_MASTER_LIST"],
        }
    }
    assert vessel_master_table(_model_with_master(), rules) == "IMO_MASTER_LIST"