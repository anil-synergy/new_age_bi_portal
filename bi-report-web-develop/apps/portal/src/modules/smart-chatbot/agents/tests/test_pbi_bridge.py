"""Power BI Desktop bridge: report structure from PBIR parts (synthetic definitions, no live calls)."""

from __future__ import annotations

import base64
import json

import pytest

from pbi_semantiq_agent import pbi_bridge
from pbi_semantiq_agent.settings import SemantiqSettings


def _part(path: str, doc: dict) -> dict:
    return {"path": path, "payload": base64.b64encode(json.dumps(doc).encode()).decode(), "payloadType": "InlineBase64"}


PARTS = [
    _part("definition/report.json", {"name": "r"}),
    _part("definition/pages/p1/page.json", {"displayName": "Fleet Overview"}),
    _part(
        "definition/pages/p1/visuals/v1/visual.json",
        {
            "visual": {
                "visualType": "card",
                "visualContainerObjects": {"title": [{"properties": {"text": {"expr": {"Literal": {"Value": "'Total vessels'"}}}}}]},
                "query": {
                    "queryState": {
                        "Values": {
                            "projections": [
                                {"field": {"Measure": {"Expression": {"SourceRef": {"Entity": "Fleet"}}, "Property": "Vessel Count"}}, "queryRef": "x"}
                            ]
                        },
                        "Category": {
                            "projections": [
                                {"field": {"Column": {"Expression": {"SourceRef": {"Entity": "IMO_MASTER_LIST"}}, "Property": "MANAGER_GROUP"}}}
                            ]
                        },
                    }
                },
            }
        },
    ),
]


def test_report_format_detects_pbir_and_legacy():
    assert pbi_bridge.report_format(PARTS) == "PBIR"
    assert pbi_bridge.report_format([{"path": "report.json"}]) == "PBIR-Legacy"
    assert pbi_bridge.report_format([{"path": "other.bin"}]) == "unknown"


def test_summary_lists_pages_visuals_and_bound_fields():
    out = pbi_bridge.summarize_definition(PARTS)
    page = next(p for p in out["pages"] if p["name"] == "Fleet Overview")
    visual = page["visuals"][0]
    assert visual["type"] == "card" and visual["title"] == "Total vessels"
    kinds = {(f["table"], f["field"], f["kind"]) for f in visual["fields"]}
    assert ("Fleet", "Vessel Count", "measure") in kinds
    assert ("IMO_MASTER_LIST", "MANAGER_GROUP", "column") in kinds
    assert out["measures_on_canvas"] == ["Vessel Count"]


def test_summary_contains_no_data_values():
    text = json.dumps(pbi_bridge.summarize_definition(PARTS))
    assert "SPPL" not in text and "rows" not in text


def test_missing_credentials_give_a_safe_error(monkeypatch):
    for k in ("PBI_TENANT_ID", "PBI_CLIENT_ID", "PBI_CLIENT_SECRET", "FABRIC_TENANT_ID", "FABRIC_CLIENT_ID", "FABRIC_CLIENT_SECRET"):
        monkeypatch.delenv(k, raising=False)
    settings = SemantiqSettings(_env_file=None)
    with pytest.raises(pbi_bridge.BridgeError) as exc:
        pbi_bridge.FabricBridge(settings, "fabric")
    assert "FABRIC_CLIENT_SECRET" in str(exc.value)  # names the setting, never a value


def test_unknown_principal_is_rejected():
    with pytest.raises(pbi_bridge.BridgeError):
        pbi_bridge._credentials(SemantiqSettings(_env_file=None), "someone")


def test_cli_reports_errors_as_json_on_stderr(monkeypatch, capsys):
    for k in ("PBI_TENANT_ID", "PBI_CLIENT_ID", "PBI_CLIENT_SECRET", "FABRIC_TENANT_ID", "FABRIC_CLIENT_ID", "FABRIC_CLIENT_SECRET"):
        monkeypatch.delenv(k, raising=False)
    code = pbi_bridge.main(["inventory", "--principal", "sp", "--workspace", "00000000-0000-0000-0000-000000000000"])
    assert code == 1
    assert json.loads(capsys.readouterr().err)["status"] == "error"
