from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr

from smart_common.config import LLMSettings, ServiceSettings, agent_settings_config, csv_list


class SemantiqSettings(ServiceSettings, LLMSettings):
    model_config = agent_settings_config(__file__)

    port: int = 8101

    pbi_tenant_id: str | None = None
    pbi_client_id: str | None = None
    pbi_client_secret: SecretStr | None = None
    # Optional Fabric / alternate service principal (APP-SynergyFabric-OAuth). When all three are set,
    # they override PBI_* for Power BI REST calls.
    fabric_tenant_id: str | None = None
    fabric_client_id: str | None = None
    fabric_client_secret: SecretStr | None = None
    pbi_scope: str = "https://analysis.windows.net/powerbi/api/.default"
    pbi_api_base: str = "https://api.powerbi.com/v1.0/myorg"
    pbi_allowed_workspace_ids: str = ""
    pbi_max_rows: int = 500
    pbi_max_concurrency: int = 8
    pbi_timeout_s: float = 60.0
    metadata_cache_ttl_s: int = 900
    metadata_cache_max_entries: int = 1024
    # Live XMLA (INFO.VIEW) is the production path when credentials exist; disk artifacts are fallback only.
    metadata_prefer_live_xmla: bool = True
    index_metadata_concurrency: int = 3
    # Background metadata refresh inside the server process (seconds). 0 disables (default): run
    # `pbi-sync-metadata --mode incremental` on a schedule instead, so chat questions are not slowed down.
    metadata_sync_interval_s: int = 0
    # Budget for the value lookup before a question is answered. On timeout the answer continues without it.
    value_resolution_timeout_s: float = 8.0

    # Keyword router (offline indexer -> Qdrant -> targeted DAX). See keyword_index.py / keyword_router.py.
    keyword_router_enabled: bool = True
    keyword_router_min_score: float = 0.55
    # Deep enough that value hits (many similar SPPL/company names) cannot push the measure out of the results.
    keyword_router_top_k: int = 40
    keyword_router_timeout_s: float = 10.0
    # "local" = free model that runs on this machine (fastembed/ONNX, no API key).
    # "gateway" = the AI gateway embedding deployment named in EMBEDDING_MODEL.
    embedding_provider: str = "local"
    embedding_model: str = ""
    local_embedding_model: str = "BAAI/bge-small-en-v1.5"
    local_embedding_fallback_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    # Outside OneDrive: fastembed stores models with symlinks, which fail under a OneDrive folder on Windows.
    local_embedding_cache_dir: str = str(Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "smart-agents" / "fastembed")
    embedding_dimensions: int = 384
    # Local Qdrant needs no key: leave QDRANT_API_KEY empty.
    qdrant_url: str | None = None
    qdrant_api_key: SecretStr | None = None
    qdrant_collection: str = "smart_keywords"
    # Keyword vector store. "pgvector" = bi_semantiq database (default); "qdrant" = the Qdrant fallback above.
    keyword_store: str = "pgvector"
    # Optional explicit DSN for bi_semantiq. Empty = built from BI_REPORT_DB_* with BI_SEMANTIQ_DATABASE.
    semantic_pg_dsn: SecretStr | None = None
    semantic_pg_table: str = "semantic_keyword_embeddings"
    keyword_enrich_batch: int = 20
    keyword_enrich_max_measures: int = 2000
    # Per-object signatures, keyword cache, lock and last-success time for the indexer.
    keyword_state_dir: str = str(Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "smart-agents" / "keyword_index")
    # Catch-up: if the nightly run has not succeeded for this many hours when the server starts, run it once.
    keyword_catch_up_after_h: float = 24.0
    # Paused for local testing. Set KEYWORD_CATCH_UP_ENABLED=true when hosted on a production server.
    keyword_catch_up_enabled: bool = False
    # Portal menu catalogue (Next route /api/smart/catalog). Service JWT signed with the shared secret.
    portal_catalog_url: str | None = None
    portal_catalog_secret: SecretStr | None = None
    portal_catalog_timeout_s: float = 30.0
    # Auto-update of ontology concept bindings after model extraction.
    ontology_auto_bindings: bool = True
    # Workspace inventory refresh (semantic_model_catalog.jsonl / report_lookup_index.jsonl).
    inventory_sync_enabled: bool = True

    # Reserved for future Microsoft Graph features (not used to read semantic models).
    graph_tenant_id: str | None = None
    graph_client_id: str | None = None
    graph_client_secret: SecretStr | None = None

    @property
    def allowed_workspaces(self) -> set[str]:
        return {w.lower() for w in csv_list(self.pbi_allowed_workspace_ids)}

    @property
    def uses_fabric_principal(self) -> bool:
        return bool(self.fabric_tenant_id and self.fabric_client_id and self.fabric_client_secret)

    @property
    def active_pbi_tenant_id(self) -> str | None:
        return self.fabric_tenant_id if self.uses_fabric_principal else self.pbi_tenant_id

    @property
    def active_pbi_client_id(self) -> str | None:
        return self.fabric_client_id if self.uses_fabric_principal else self.pbi_client_id

    @property
    def active_pbi_client_secret(self) -> SecretStr | None:
        return self.fabric_client_secret if self.uses_fabric_principal else self.pbi_client_secret

    @property
    def pbi_configured(self) -> bool:
        return bool(self.active_pbi_tenant_id and self.active_pbi_client_id and self.active_pbi_client_secret)


@lru_cache
def get_settings() -> SemantiqSettings:
    return SemantiqSettings()
