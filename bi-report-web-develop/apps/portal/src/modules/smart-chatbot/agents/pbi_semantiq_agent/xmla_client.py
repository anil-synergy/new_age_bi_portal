"""Run DAX over the Power BI XMLA endpoint via ADOMD.NET (pythonnet).

Service principal auth uses User ID=app:{client_id}@{tenant_id} in the connection string.
No EffectiveUserName — portal SMART path is SP-only.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

_ADOMD: tuple[Any, Any] | None = None
_ADOMD_LOCK = threading.Lock()
_DEBUG_LOG = Path(__file__).resolve().parent / "debug-285207.log"


def _adomd_dir() -> Path:
    return Path(__file__).resolve().parent / "adomd"


def _agent_log(*, hypothesis_id: str, location: str, message: str, data: dict[str, Any], run_id: str = "pre-fix") -> None:
    # region agent log
    payload = {
        "sessionId": "285207",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
        "runId": run_id,
    }
    try:
        with _DEBUG_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload) + "\n")
    except OSError:
        pass
    # endregion


def _load_adomd() -> tuple[Any, Any]:
    global _ADOMD
    if _ADOMD is not None:
        return _ADOMD
    # pythonnet runtime init is not thread-safe; INFO.VIEW queries arrive on parallel worker threads.
    with _ADOMD_LOCK:
        if _ADOMD is not None:
            return _ADOMD
        adomd_path = str(_adomd_dir())
        # region agent log
        _agent_log(hypothesis_id="G", location="xmla_client.py:_load_adomd:locked_entry", message="loading ADOMD under lock", data={"thread": threading.get_ident()}, run_id="post-fix")
        # endregion
        try:
            if adomd_path not in sys.path:
                sys.path.append(adomd_path)
            import clr  # type: ignore[import-not-found]  # pythonnet

            clr.AddReference("Microsoft.AnalysisServices.AdomdClient")
            from Microsoft.AnalysisServices.AdomdClient import AdomdCommand, AdomdConnection  # type: ignore[import-not-found]
        except BaseException as exc:
            # region agent log
            _agent_log(hypothesis_id="G", location="xmla_client.py:_load_adomd:error", message="ADOMD load failed", data={"error_type": type(exc).__name__, "error": str(exc)[:300]}, run_id="post-fix")
            # endregion
            raise
        _ADOMD = (AdomdConnection, AdomdCommand)
        return _ADOMD


def build_connection_string(
    *,
    workspace_name: str,
    catalog: str,
    tenant_id: str,
    client_id: str,
    client_secret: str,
) -> str:
    return (
        f"Data Source=powerbi://api.powerbi.com/v1.0/myorg/{workspace_name};"
        f"Initial Catalog={catalog};"
        f"User ID=app:{client_id}@{tenant_id};Password={client_secret};"
    )


def execute_dax_sync(
    *,
    workspace_name: str,
    catalog: str,
    dax: str,
    tenant_id: str,
    client_id: str,
    client_secret: str,
    connection_builder: Callable[..., str] | None = None,
) -> dict[str, Any]:
    """Execute one DAX query and return {columns, rows} with raw ADOMD column names."""
    builder = connection_builder or build_connection_string
    conn_str = builder(
        workspace_name=workspace_name,
        catalog=catalog,
        tenant_id=tenant_id,
        client_id=client_id,
        client_secret=client_secret,
    )
    AdomdConnection, AdomdCommand = _load_adomd()
    conn = AdomdConnection(conn_str)
    try:
        conn.Open()
        reader = AdomdCommand(dax, conn).ExecuteReader()
        names = [reader.GetName(i) for i in range(reader.FieldCount)]
        rows: list[dict[str, Any]] = []
        while reader.Read():
            row = {}
            for i, name in enumerate(names):
                row[name] = None if reader.IsDBNull(i) else reader.GetValue(i)
            rows.append(row)
        reader.Close()
    except Exception as exc:
        raise RuntimeError(str(exc)) from None
    finally:
        conn.Close()
    columns = list(rows[0].keys()) if rows else names
    return {"columns": columns, "rows": rows}
