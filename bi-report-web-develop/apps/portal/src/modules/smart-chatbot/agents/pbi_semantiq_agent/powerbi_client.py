"""Async Power BI client: REST for inventory, XMLA/ADOMD for DAX (INFO.VIEW and queries).

MSAL client credentials for REST; XMLA uses app:{client_id}@{tenant_id} in the ADOMD connection string.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Any

import httpx
import msal

from smart_common.logging import log
from smart_common.resilience import RETRYABLE_STATUS, RetryableStatus, retrying

from .settings import SemantiqSettings
from . import xmla_client

logger = logging.getLogger(__name__)


class PowerBIError(RuntimeError):
    def __init__(self, message: str, status: int | None = None, detail: str | None = None):
        super().__init__(message)
        self.status = status
        self.detail = detail


class WorkspaceNotAllowed(PowerBIError):
    pass


class PowerBIClient:
    def __init__(
        self,
        settings: SemantiqSettings,
        *,
        xmla_runner: Callable[..., dict[str, Any]] | None = None,
    ):
        self.settings = settings
        self._xmla_runner = xmla_runner or xmla_client.execute_dax_sync
        self._app: msal.ConfidentialClientApplication | None = None
        self._token: str | None = None
        self._token_expiry = 0.0
        self._token_lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(max(1, settings.pbi_max_concurrency))
        self._workspace_meta: dict[str, tuple[str, bool]] = {}
        self._dataset_catalog: dict[tuple[str, str], str] = {}
        self._http = httpx.AsyncClient(
            base_url=settings.pbi_api_base.rstrip("/"),
            timeout=httpx.Timeout(settings.pbi_timeout_s, connect=10.0),
            limits=httpx.Limits(max_connections=settings.pbi_max_concurrency * 2, max_keepalive_connections=settings.pbi_max_concurrency),
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    # ---------------------------------------------------------------- auth
    def _msal_app(self) -> msal.ConfidentialClientApplication:
        if not self.settings.pbi_configured:
            raise PowerBIError("Power BI service principal is not configured (PBI_TENANT_ID / PBI_CLIENT_ID / PBI_CLIENT_SECRET)")
        if self._app is None:
            self._app = msal.ConfidentialClientApplication(
                self.settings.active_pbi_client_id,
                authority=f"https://login.microsoftonline.com/{self.settings.active_pbi_tenant_id}",
                client_credential=self.settings.active_pbi_client_secret.get_secret_value(),  # type: ignore[union-attr]
            )
        return self._app

    async def _access_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 300:
            return self._token
        async with self._token_lock:
            if self._token and time.time() < self._token_expiry - 300:
                return self._token
            app = self._msal_app()
            result = await asyncio.to_thread(app.acquire_token_for_client, scopes=[self.settings.pbi_scope])
            if "access_token" not in result:
                log(logger, logging.ERROR, "pbi_token_failed", error=result.get("error"), description=result.get("error_description"))
                raise PowerBIError("Could not acquire a Power BI token for the service principal")
            self._token = result["access_token"]
            self._token_expiry = time.time() + float(result.get("expires_in", 3600))
            return self._token

    # ---------------------------------------------------------------- http
    async def _request(self, method: str, path: str, *, json: Any = None) -> Any:
        # REST reads only (GETs). DAX runs over XMLA, not executeQueries.
        async for attempt in retrying():
            with attempt:
                token = await self._access_token()
                async with self._semaphore:
                    response = await self._http.request(method, path, json=json, headers={"Authorization": f"Bearer {token}"})
                if response.status_code in RETRYABLE_STATUS:
                    retry_after = response.headers.get("Retry-After")
                    if retry_after and retry_after.isdigit():
                        await asyncio.sleep(min(int(retry_after), 30))
                    raise RetryableStatus(response)
        if response.status_code >= 400:
            detail = response.text[:2000]
            log(logger, logging.WARNING, "pbi_request_failed", method=method, path=path, status=response.status_code)
            raise PowerBIError(f"Power BI API returned {response.status_code}", status=response.status_code, detail=detail)
        return response.json() if response.content else None

    def _check_workspace(self, workspace_id: str) -> None:
        allowed = self.settings.allowed_workspaces
        if allowed and workspace_id.lower() not in allowed:
            raise WorkspaceNotAllowed(f"Workspace {workspace_id} is not in PBI_ALLOWED_WORKSPACE_IDS")

    # ---------------------------------------------------------------- api
    async def list_workspaces(self) -> list[dict[str, Any]]:
        data = await self._request("GET", "/groups")
        allowed = self.settings.allowed_workspaces
        return [
            {"id": g["id"], "name": g.get("name"), "type": g.get("type"), "isOnDedicatedCapacity": g.get("isOnDedicatedCapacity")}
            for g in data.get("value", [])
            if not allowed or g["id"].lower() in allowed
        ]

    async def list_datasets(self, workspace_id: str) -> list[dict[str, Any]]:
        self._check_workspace(workspace_id)
        data = await self._request("GET", f"/groups/{workspace_id}/datasets")
        return [
            {
                "id": d["id"],
                "name": d.get("name"),
                "workspaceId": workspace_id,
                "configuredBy": d.get("configuredBy"),
                "isEffectiveIdentityRequired": d.get("isEffectiveIdentityRequired"),
                "isEffectiveIdentityRolesRequired": d.get("isEffectiveIdentityRolesRequired"),
                "targetStorageMode": d.get("targetStorageMode"),
                "description": d.get("description"),
            }
            for d in data.get("value", [])
        ]

    async def get_dataset_freshness(self, workspace_id: str, dataset_id: str) -> dict[str, Any]:
        """Latest refresh of a dataset; used to expire cached answers when the data changes."""
        self._check_workspace(workspace_id)
        data = await self._request("GET", f"/groups/{workspace_id}/datasets/{dataset_id}/refreshes?$top=1")
        latest = next(iter((data or {}).get("value", [])), None) or {}
        return {
            "refreshedAt": latest.get("endTime") or latest.get("startTime"),
            "refreshStatus": latest.get("status"),
            "refreshId": latest.get("requestId") or latest.get("id"),
        }

    async def list_datasources(self, workspace_id: str, dataset_id: str) -> list[dict[str, Any]]:
        self._check_workspace(workspace_id)
        data = await self._request("GET", f"/groups/{workspace_id}/datasets/{dataset_id}/datasources")
        out: list[dict[str, Any]] = []
        for ds in (data or {}).get("value", []):
            details = ds.get("connectionDetails") or {}
            if isinstance(details, dict):
                details = {k: v for k, v in details.items() if "password" not in str(k).lower() and "secret" not in str(k).lower()}
            out.append(
                {
                    "datasourceType": ds.get("datasourceType"),
                    "gatewayId": ds.get("gatewayId"),
                    "connectionDetails": details,
                }
            )
        return out

    async def list_reports(self, workspace_id: str) -> list[dict[str, Any]]:
        self._check_workspace(workspace_id)
        data = await self._request("GET", f"/groups/{workspace_id}/reports")
        return [
            {
                "id": r["id"],
                "name": r.get("name"),
                "datasetId": r.get("datasetId"),
                "datasetWorkspaceId": r.get("datasetWorkspaceId") or workspace_id,
                "workspaceId": workspace_id,
                "description": r.get("description"),
            }
            for r in data.get("value", [])
        ]

    async def get_report(self, workspace_id: str, report_id: str) -> dict[str, Any]:
        self._check_workspace(workspace_id)
        report = await self._request("GET", f"/groups/{workspace_id}/reports/{report_id}")
        return {
            "id": report["id"],
            "name": report.get("name"),
            "datasetId": report.get("datasetId"),
            "datasetWorkspaceId": report.get("datasetWorkspaceId") or workspace_id,
        }

    async def list_report_pages(self, workspace_id: str, report_id: str) -> list[dict[str, Any]]:
        self._check_workspace(workspace_id)
        data = await self._request("GET", f"/groups/{workspace_id}/reports/{report_id}/pages")
        return [
            {
                "name": p.get("name"),
                "displayName": p.get("displayName"),
                "order": p.get("order"),
            }
            for p in (data or {}).get("value", [])
        ]

    async def list_page_visuals(self, workspace_id: str, report_id: str, page_name: str) -> list[dict[str, Any]]:
        self._check_workspace(workspace_id)
        data = await self._request(
            "GET",
            f"/groups/{workspace_id}/reports/{report_id}/pages/{page_name}/visuals",
        )
        return list((data or {}).get("value", []))

    async def list_report_filters(self, workspace_id: str, report_id: str) -> list[dict[str, Any]]:
        self._check_workspace(workspace_id)
        data = await self._request("GET", f"/groups/{workspace_id}/reports/{report_id}/filters")
        return list((data or {}).get("value", []))

    async def _workspace_record(self, workspace_id: str) -> dict[str, Any]:
        key = workspace_id.lower()
        cached = self._workspace_meta.get(key)
        if cached is not None:
            return {"id": workspace_id, "name": cached[0], "isOnDedicatedCapacity": cached[1]}
        self._check_workspace(workspace_id)
        group = await self._request("GET", f"/groups/{workspace_id}")
        name = group.get("name") or workspace_id
        dedicated = bool(group.get("isOnDedicatedCapacity"))
        self._workspace_meta[key] = (name, dedicated)
        return {"id": workspace_id, "name": name, "isOnDedicatedCapacity": dedicated}

    async def _dataset_name(self, workspace_id: str, dataset_id: str) -> str:
        key = (workspace_id.lower(), dataset_id.lower())
        cached = self._dataset_catalog.get(key)
        if cached:
            return cached
        self._check_workspace(workspace_id)
        dataset = await self._request("GET", f"/groups/{workspace_id}/datasets/{dataset_id}")
        name = dataset.get("name")
        if not name:
            raise PowerBIError("Dataset name could not be resolved for XMLA", detail=f"{workspace_id}/{dataset_id}")
        self._dataset_catalog[key] = name
        return name

    async def _resolve_xmla_target(self, workspace_id: str, dataset_id: str) -> tuple[str, str]:
        try:
            ws = await self._workspace_record(workspace_id)
        except PowerBIError as exc:
            # region agent log
            xmla_client._agent_log(hypothesis_id="A,C", location="powerbi_client.py:_resolve_xmla_target:workspace_rest_failed", message="GET /groups/{id} failed", data={"workspace_id": workspace_id, "status": exc.status, "error": str(exc)[:200], "detail": (exc.detail or "")[:500]})
            # endregion
            raise
        if not ws.get("isOnDedicatedCapacity"):
            log(
                logger,
                logging.WARNING,
                "xmla_capacity_flag_false",
                workspace_id=workspace_id,
                workspace_name=ws.get("name"),
                detail="REST isOnDedicatedCapacity is false; attempting XMLA anyway (XMLA_Test path)",
            )
        try:
            catalog = await self._dataset_name(workspace_id, dataset_id)
        except PowerBIError as exc:
            # region agent log
            xmla_client._agent_log(hypothesis_id="A,C", location="powerbi_client.py:_resolve_xmla_target:dataset_rest_failed", message="GET /datasets/{id} failed", data={"workspace_id": workspace_id, "dataset_id": dataset_id, "status": exc.status, "error": str(exc)[:200], "detail": (exc.detail or "")[:500]})
            # endregion
            raise
        # region agent log
        xmla_client._agent_log(hypothesis_id="A,C", location="powerbi_client.py:_resolve_xmla_target:ok", message="XMLA target resolved via REST", data={"workspace_id": workspace_id, "workspace_name": ws.get("name"), "dedicated": ws.get("isOnDedicatedCapacity"), "catalog": catalog})
        # endregion
        return str(ws["name"]), catalog

    async def execute_dax(
        self,
        workspace_id: str,
        dataset_id: str,
        dax: str,
        *,
        impersonated_user: str | None = None,
    ) -> dict[str, Any]:
        """Run one DAX query over XMLA as the service principal (ADOMD; same path as XMLA_Test)."""
        del impersonated_user
        if not self.settings.pbi_configured:
            raise PowerBIError("Power BI service principal is not configured (PBI_TENANT_ID / PBI_CLIENT_ID / PBI_CLIENT_SECRET)")
        self._check_workspace(workspace_id)
        workspace_name, catalog = await self._resolve_xmla_target(workspace_id, dataset_id)
        tenant = self.settings.active_pbi_tenant_id
        client_id = self.settings.active_pbi_client_id
        secret = self.settings.active_pbi_client_secret
        assert tenant and client_id and secret

        async with self._semaphore:
            try:
                raw = await asyncio.to_thread(
                    self._xmla_runner,
                    workspace_name=workspace_name,
                    catalog=catalog,
                    dax=dax,
                    tenant_id=tenant,
                    client_id=client_id,
                    client_secret=secret.get_secret_value(),
                )
            except RuntimeError as exc:
                # region agent log
                xmla_client._agent_log(hypothesis_id="B,E", location="powerbi_client.py:execute_dax:xmla_failed", message="ADOMD execution failed", data={"workspace_name": workspace_name, "catalog": catalog, "dax_head": dax[:80], "error": str(exc)[:800]})
                # endregion
                raise PowerBIError("DAX query failed", detail=str(exc)[:2000]) from exc
            # region agent log
            xmla_client._agent_log(hypothesis_id="B,E", location="powerbi_client.py:execute_dax:xmla_ok", message="ADOMD execution ok", data={"workspace_name": workspace_name, "catalog": catalog, "dax_head": dax[:80], "row_count": len(raw.get("rows") or [])})
            # endregion

        rows = [{clean_key(k): v for k, v in row.items()} for row in raw.get("rows") or []]
        columns = list(rows[0].keys()) if rows else list(raw.get("columns") or [])
        return {"columns": columns, "rows": rows}

    async def execute_dax_with_rls_retry(
        self, workspace_id: str, dataset_id: str, dax: str, *, user: str | None
    ) -> dict[str, Any]:
        """Metadata reads via INFO.VIEW; same SP-only XMLA path as analytical queries."""
        del user
        return await self.execute_dax(workspace_id, dataset_id, dax)


def clean_key(key: str) -> str:
    """'Sales[Amount]' -> 'Amount', '[Total]' -> 'Total'."""
    if key.endswith("]") and "[" in key:
        return key[key.rindex("[") + 1 : -1]
    return key
