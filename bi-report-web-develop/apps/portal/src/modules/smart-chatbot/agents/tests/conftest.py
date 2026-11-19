from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel

from pbi_semantiq_agent.metadata import Column, Measure, Relationship, SemanticModel, Table

_SECRET_ENV = (
    "LLM_API_KEY",
    "PBI_TENANT_ID",
    "PBI_CLIENT_ID",
    "PBI_CLIENT_SECRET",
    "PORTAL_JWT_SECRET",
    "MCP_SHARED_SECRET",
    "PBI_ALLOWED_WORKSPACE_IDS",
    "PINECONE_API_KEY",
    "PINECONE_INDEX_HOST",
    "EMBEDDING_MODEL",
    "NONPROD_OVERRIDE_USERS",
    "CHECKPOINT_SQLITE_PATH",
)


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    """Tests never pick up real credentials from the machine or write analytics outside tmp."""
    for key in _SECRET_ENV:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("ANALYTICS_DB_PATH", str(tmp_path / "analytics.db"))
    monkeypatch.setenv("INDEX_MODEL_METADATA", "false")


@pytest.fixture
def model() -> SemanticModel:
    po = Table(
        name="PO",
        description="Purchase orders",
        columns=[
            Column("PO Number", "String"),
            Column("Order Date", "DateTime"),
            Column("Vendor Key", "Int64", hidden=True),
            Column("Amount", "Decimal", "Line amount"),
        ],
        measures=[
            Measure("Spend", "PO", "SUM('PO'[Amount])", "#,0", "Committed PO value"),
            Measure("Spend PY", "PO", "CALCULATE([Spend], SAMEPERIODLASTYEAR('Date'[Date]))", "#,0"),
            Measure("PO Count", "PO", "COUNTROWS('PO')", "#,0"),
        ],
    )
    vendor = Table(name="Vendor", columns=[Column("Vendor Key", "Int64", hidden=True), Column("Vendor Name", "String")])
    date = Table(name="Date", columns=[Column("Date", "DateTime"), Column("Year", "Int64"), Column("Month", "String")])
    return SemanticModel(
        workspace_id="ws-1",
        dataset_id="ds-1",
        name="PO Spend",
        tables=[po, vendor, date],
        relationships=[
            Relationship("PO", "Vendor Key", "Vendor", "Vendor Key", "ManyToOne"),
            Relationship("PO", "Order Date", "Date", "Date", "ManyToOne"),
        ],
    )


class FakeLLM:
    """Returns queued pydantic objects per schema name; ``configured`` mimics a key being set."""

    def __init__(self, responses: dict[str, list[Any]] | None = None, configured: bool = True):
        self.responses = {k: list(v) for k, v in (responses or {}).items()}
        self.configured = configured
        self.calls: list[tuple[str, str]] = []

    async def complete_json(self, system: str, user: str, schema: type[BaseModel], **_: Any) -> BaseModel:
        from smart_common.llm import LLMUnavailable

        self.calls.append((schema.__name__, user))
        queue = self.responses.get(schema.__name__)
        if not queue:
            raise LLMUnavailable(f"no fake response for {schema.__name__}")
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        return item if isinstance(item, BaseModel) else schema.model_validate(item)
