from smart_common.grounding import Confidence, allowed_values_from_rows, check_grounding, extract_numbers


def test_extracts_thousands_scales_and_percent():
    found = {n.text: n for n in extract_numbers("Spend was 1,245,300 (33.1%) or 1.2m overall")}
    assert found["1,245,300"].value == 1245300
    assert found["33.1"].is_percent
    assert found["1.2"].value == 1_200_000


def test_grounded_text_passes_with_rounding():
    allowed = allowed_values_from_rows([{"Vendor": "Acme", "Spend": 412000.4}, {"Vendor": "Blue", "Spend": 301500}])
    report = check_grounding("Acme leads with 412,000 ahead of Blue at 301,500.", allowed)
    assert report.coverage == 1.0


def test_invented_number_is_flagged():
    report = check_grounding("Spend grew to 999,999.", [412000.0])
    assert report.coverage == 0.0
    assert report.ungrounded == ["999,999"]


def test_percent_of_fraction_matches():
    assert check_grounding("Share is 33.08%", [0.3308]).coverage == 1.0


def test_numbers_from_question_are_allowed():
    report = check_grounding("Top 5 vendors in 2026", [], also_allowed_text="Show the top 5 vendors for 2026")
    assert report.coverage == 1.0


def test_confidence_is_product_and_clamped():
    assert Confidence({"a": 1.0, "b": 0.99}).score == 0.99
    assert Confidence({"a": 1.0, "b": 0.0}).score == 0.0
    assert Confidence({"a": 1.5}).score == 1.0
    assert not Confidence({"a": 0.97}).passes(0.98)
