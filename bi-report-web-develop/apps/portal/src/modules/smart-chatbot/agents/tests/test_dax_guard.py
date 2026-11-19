from pbi_semantiq_agent import dax_guard


def test_valid_query_gets_row_cap(model):
    result = dax_guard.validate("EVALUATE SUMMARIZECOLUMNS('Vendor'[Vendor Name], \"Total\", [Spend])", model, max_rows=100)
    assert result.ok, result.errors
    assert "TOPN(101," in result.dax
    assert "'Vendor'[Vendor Name]" in result.references
    assert "[Spend]" in result.references


def test_unknown_measure_is_rejected(model):
    result = dax_guard.validate("EVALUATE ROW(\"x\", [Total Cost])", model, max_rows=100)
    assert not result.ok
    assert any("Total Cost" in e for e in result.errors)


def test_unknown_table_and_column_rejected(model):
    assert not dax_guard.validate("EVALUATE VALUES('Ship'[Name])", model, max_rows=10).ok
    assert not dax_guard.validate("EVALUATE VALUES('PO'[Colour])", model, max_rows=10).ok


def test_unquoted_table_reference(model):
    assert dax_guard.validate("EVALUATE VALUES(Vendor[Vendor Name])", model, max_rows=10).ok


def test_must_start_with_evaluate_or_define(model):
    result = dax_guard.validate("SELECT * FROM PO", model, max_rows=10)
    assert not result.ok


def test_exactly_one_evaluate(model):
    result = dax_guard.validate("EVALUATE VALUES('PO'[PO Number]) EVALUATE VALUES('Vendor'[Vendor Name])", model, max_rows=10)
    assert not result.ok


def test_define_measure_and_var_are_allowed(model):
    dax = """
    DEFINE
      MEASURE 'PO'[Avg Spend] = DIVIDE([Spend], [PO Count])
      VAR Top5 = TOPN(5, VALUES('Vendor'[Vendor Name]), [Spend])
    EVALUATE SUMMARIZECOLUMNS('Vendor'[Vendor Name], TREATAS(Top5, 'Vendor'[Vendor Name]), "Avg", [Avg Spend])
    """
    result = dax_guard.validate(dax, model, max_rows=50)
    assert result.ok, result.errors


def test_order_by_disables_topn_rewrite(model):
    result = dax_guard.validate("EVALUATE VALUES('PO'[PO Number]) ORDER BY 'PO'[PO Number]", model, max_rows=10)
    assert result.ok
    assert "TOPN" not in result.dax


def test_comments_and_strings_cannot_hide_or_fake_refs(model):
    # A fake reference inside a comment or string must not count; the real one must still be checked.
    ok = dax_guard.validate("EVALUATE ROW(\"[Not A Measure]\", [Spend]) // [Also Fake]", model, max_rows=10)
    assert ok.ok, ok.errors
    bad = dax_guard.validate("EVALUATE ROW(\"label\", [Missing]) /* [Spend] */", model, max_rows=10)
    assert not bad.ok


def test_length_cap(model):
    assert not dax_guard.validate("EVALUATE " + "x" * 9000, model, max_rows=10).ok


def test_empty(model):
    assert not dax_guard.validate("  ", model, max_rows=10).ok
