"""Power BI Desktop bridge: read report structure (pages, visuals, bound fields) from a workspace.

Reads the report *definition* (PBIR / PBIP format) through the Fabric item API, so the report canvas can be
read without downloading the data. PBIX files are not downloaded: they contain the model data.

Two principals, chosen with ``--principal``:
* ``sp``      the SemantIQ service principal (PBI_TENANT_ID / PBI_CLIENT_ID / PBI_CLIENT_SECRET)
* ``fabric``  the alternate Fabric principal (FABRIC_TENANT_ID / FABRIC_CLIENT_ID / FABRIC_CLIENT_SECRET)

CLI (prints JSON, never tokens or secrets):

    python -m pbi_semantiq_agent.pbi_bridge inventory  --principal sp --workspace <ws-guid>
    python -m pbi_semantiq_agent.pbi_bridge canvas     --principal fabric --workspace <ws-guid> --item <report-item-guid>

Only GET-style reads are made (``getDefinition`` is a read even though it uses POST).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import re
import sys
from typing import Any

import httpx
import msal

from .settings import SemantiqSettings, get_settings

logger = logging.getLogger(__name__)

FABRIC_API = "https://api.fabric.microsoft.com/v1"
FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"
POLL_MAX = 30


class BridgeError(RuntimeError):
    """A bridge failure with a message that is safe to show (no tokens, no secrets)."""


def _credentials(settings: SemantiqSettings, principal: str) -> tuple[str, str, str, str]:
    if principal == "fabric":
        if not settings.uses_fabric_principal:
            raise BridgeError("Fabric principal is not configured (FABRIC_TENANT_ID / FABRIC_CLIENT_ID / FABRIC_CLIENT_SECRET)")
        return (
            str(settings.fabric_tenant_id),
            str(settings.fabric_client_id),
            settings.fabric_client_secret.get_secret_value() if settings.fabric_client_secret else "",
            FABRIC_SCOPE,
        )
    if principal == "sp":
        if not settings.pbi_configured:
            raise BridgeError("Service principal is not configured (PBI_TENANT_ID / PBI_CLIENT_ID / PBI_CLIENT_SECRET)")
        return (
            str(settings.pbi_tenant_id),
            str(settings.pbi_client_id),
            settings.pbi_client_secret.get_secret_value() if settings.pbi_client_secret else "",
            FABRIC_SCOPE,
        )
    raise BridgeError("principal must be 'sp' or 'fabric'")


class FabricBridge:
    """Read-only Fabric item access for one principal."""

    def __init__(self, settings: SemantiqSettings, principal: str, http: httpx.AsyncClient | None = None):
        self.principal = principal
        self._tenant, self._client, self._secret, self._scope = _credentials(settings, principal)
        self._http = http or httpx.AsyncClient(timeout=settings.pbi_timeout_s)
        self._owns_http = http is None
        self._app = msal.ConfidentialClientApplication(
            self._client,
            authority=f"https://login.microsoftonline.com/{self._tenant}",
            client_credential=self._secret,
        )

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    def _token(self) -> str:
        result = self._app.acquire_token_for_client(scopes=[self._scope])
        if "access_token" not in result:
            # Describe the failure without echoing the secret or the raw response body.
            raise BridgeError(f"token request failed for principal '{self.principal}': {result.get('error', 'unknown')}")
        return str(result["access_token"])

    async def _get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        resp = await self._http.get(url, params=params, headers={"Authorization": f"Bearer {self._token()}"})
        return self._json(resp)

    @staticmethod
    def _json(resp: httpx.Response) -> dict[str, Any]:
        if resp.status_code in (401, 403):
            raise BridgeError(f"access denied ({resp.status_code}): the principal needs read access to the workspace")
        if resp.status_code == 404:
            raise BridgeError("workspace or item not found for this principal")
        if resp.status_code >= 400:
            raise BridgeError(f"Fabric API returned HTTP {resp.status_code}")
        return resp.json() if resp.content else {}

    async def list_reports(self, workspace_id: str) -> list[dict[str, Any]]:
        """Report items in the workspace (Fabric item list, all pages)."""
        items: list[dict[str, Any]] = []
        token: str | None = None
        while True:
            params: dict[str, Any] = {"type": "Report"}
            if token:
                params["continuationToken"] = token
            data = await self._get(f"{FABRIC_API}/workspaces/{workspace_id}/items", params)
            items.extend(
                {"id": i.get("id"), "name": i.get("displayName"), "type": i.get("type"), "workspaceId": workspace_id}
                for i in data.get("value", [])
            )
            token = data.get("continuationToken")
            if not token:
                break
        return items

    async def get_definition(self, workspace_id: str, item_id: str, fmt: str = "PBIR") -> list[dict[str, Any]]:
        """Report definition parts (base64 payloads). Handles the long-running (202) pattern."""
        url = f"{FABRIC_API}/workspaces/{workspace_id}/items/{item_id}/getDefinition"
        headers = {"Authorization": f"Bearer {self._token()}"}
        resp = await self._http.post(url, params={"format": fmt}, headers=headers)
        if resp.status_code == 202:
            location = resp.headers.get("Location")
            if not location:
                raise BridgeError("Fabric returned an operation without a status location")
            # Poll the operation until it finishes, then fetch its result.
            for _ in range(POLL_MAX):
                await asyncio.sleep(float(resp.headers.get("Retry-After", "2")))
                status_resp = await self._http.get(location, headers={"Authorization": f"Bearer {self._token()}"})
                status = (self._json(status_resp) or {}).get("status")
                if status == "Failed":
                    raise BridgeError("Fabric could not produce the report definition")
                if status == "Succeeded":
                    resp = await self._http.get(location.rstrip("/") + "/result", headers={"Authorization": f"Bearer {self._token()}"})
                    break
                resp = status_resp  # still running: keep the latest Retry-After
            else:
                raise BridgeError("timed out waiting for the report definition")
        data = self._json(resp)
        return list(data.get("definition", {}).get("parts", []))


def _decode(part: dict[str, Any]) -> dict[str, Any]:
    raw = base64.b64decode(part.get("payload") or "")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}


_PAGE = re.compile(r"^definition/pages/([^/]+)/page\.json$")
_VISUAL = re.compile(r"^definition/pages/([^/]+)/visuals/([^/]+)/visual\.json$")


def _field_refs(query_state: dict[str, Any]) -> list[dict[str, str]]:
    """Table / field / kind for every projection bound to a visual (Column, Measure, Aggregation...)."""
    refs: list[dict[str, str]] = []
    for well in (query_state or {}).values():
        for proj in (well or {}).get("projections") or []:
            field = proj.get("field") or {}
            for kind in ("Measure", "Column", "Aggregation", "HierarchyLevel"):
                node = field.get(kind)
                if not node:
                    continue
                expr = node.get("Expression") or {}
                source = (expr.get("SourceRef") or {}).get("Entity") or (expr.get("SourceRef") or {}).get("Source") or ""
                prop = node.get("Property") or node.get("Level") or ""
                refs.append({"table": str(source), "field": str(prop), "kind": kind.lower(), "display": str(proj.get("displayName") or "")})
    return refs


def _visual_title(visual: dict[str, Any]) -> str:
    texts = (visual.get("visualContainerObjects") or {}).get("title") or []
    for t in texts:
        value = (((t or {}).get("properties") or {}).get("text") or {}).get("expr", {}).get("Literal", {}).get("Value")
        if value:
            return str(value).strip("'")
    return ""


def summarize_definition(parts: list[dict[str, Any]]) -> dict[str, Any]:
    """Pages and visuals with the fields each visual is bound to. Structure only: no data values."""
    decoded = {p.get("path", ""): p for p in parts}
    pages: dict[str, dict[str, Any]] = {}
    for path, part in decoded.items():
        m = _PAGE.match(path)
        if m:
            doc = _decode(part)
            pages[m.group(1)] = {"name": doc.get("displayName") or m.group(1), "visuals": []}
    for path, part in decoded.items():
        m = _VISUAL.match(path)
        if not m:
            continue
        page_id, _visual_id = m.group(1), m.group(2)
        visual = _decode(part).get("visual") or {}
        query = (visual.get("query") or {}).get("queryState") or {}
        pages.setdefault(page_id, {"name": page_id, "visuals": []})["visuals"].append(
            {
                "type": visual.get("visualType"),
                "title": _visual_title(visual),
                "fields": _field_refs(query),
            }
        )
    measures = sorted({f["field"] for p in pages.values() for v in p["visuals"] for f in v["fields"] if f["kind"] == "measure"})
    return {"pages": list(pages.values()), "measures_on_canvas": measures}


def report_format(parts: list[dict[str, Any]]) -> str:
    paths = [p.get("path", "") for p in parts]
    if any(p.startswith("definition/") for p in paths):
        return "PBIR"
    if any(p == "report.json" for p in paths):
        return "PBIR-Legacy"
    return "unknown"


async def inventory(settings: SemantiqSettings, principal: str, workspace_id: str) -> dict[str, Any]:
    bridge = FabricBridge(settings, principal)
    try:
        items = await bridge.list_reports(workspace_id)
        return {"principal": principal, "workspace_id": workspace_id, "reports": items, "count": len(items)}
    finally:
        await bridge.aclose()


async def canvas(settings: SemantiqSettings, principal: str, workspace_id: str, item_id: str) -> dict[str, Any]:
    bridge = FabricBridge(settings, principal)
    try:
        parts = await bridge.get_definition(workspace_id, item_id, "PBIR")
        if not parts:
            return {"principal": principal, "item_id": item_id, "status": "no_definition", "format": "unknown"}
        return {
            "principal": principal,
            "item_id": item_id,
            "status": "ok",
            "format": report_format(parts),
            **summarize_definition(parts),
        }
    finally:
        await bridge.aclose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read Power BI report structure without downloading data.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("inventory", "canvas"):
        p = sub.add_parser(name)
        p.add_argument("--principal", choices=("sp", "fabric"), required=True)
        p.add_argument("--workspace", required=True)
        if name == "canvas":
            p.add_argument("--item", required=True)
    args = parser.parse_args(argv)
    settings = get_settings()
    try:
        if args.command == "inventory":
            result = asyncio.run(inventory(settings, args.principal, args.workspace))
        else:
            result = asyncio.run(canvas(settings, args.principal, args.workspace, args.item))
    except BridgeError as exc:
        print(json.dumps({"status": "error", "message": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
