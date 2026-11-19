from __future__ import annotations

import json
from functools import lru_cache

from pydantic import SecretStr

from smart_common.config import LLMSettings, ServiceSettings, agent_settings_config, csv_list


class OrchestratorSettings(ServiceSettings, LLMSettings):
    model_config = agent_settings_config(__file__)

    port: int = 8100
    portal_jwt_secret: SecretStr | None = None
    portal_jwt_audience: str = "smart-orchestrator"
    portal_jwt_issuer: str = "bi-portal"
    allowed_origins: str = "http://localhost:3000"

    semantiq_mcp_url: str = "http://127.0.0.1:8100/mcp/semantiq/mcp"
    nova_mcp_url: str = "http://127.0.0.1:8100/mcp/nova/mcp"
    agent_registry: str = "{}"
    agent_timeout_s: float = 120.0

    confidence_threshold: float = 0.98
    workspace_inventory_ttl_s: float = 300.0
    max_concurrent_requests: int = 32
    user_requests_per_minute: int = 20
    request_timeout_s: float = 170.0
    history_turns: int = 6

    # Hybrid retrieval (vector + BM25) and reranking
    retrieval_vector_weight: float = 0.55
    retrieval_bm25_weight: float = 0.45
    retrieval_top_k: int = 12
    rerank_hybrid_weight: float = 0.5
    rerank_title_weight: float = 0.35
    rerank_menu_weight: float = 0.1
    rerank_marker_weight: float = 0.05
    retrieval_vector_floor: float = 0.35
    retrieval_select_threshold: float = 0.55
    retrieval_select_margin: float = 0.12
    retrieval_min_relevance: float = 0.2
    retrieval_max_options: int = 4

    # LLM reasoning between rerank and decision (picks among already-eligible candidates only)
    llm_rerank_enabled: bool = True
    llm_rerank_top_k: int = 6
    llm_rerank_min_confidence: float = 0.7
    # Skip the LLM when the deterministic top score is at least this and clearly ahead.
    llm_rerank_skip_score: float = 0.9
    llm_rerank_max_tokens: int = 400
    llm_rerank_timeout_s: float = 20.0

    embedding_model: str = ""
    embedding_dimensions: int = 512
    embedding_timeout_s: float = 15.0

    pinecone_api_key: SecretStr | None = None
    pinecone_index_host: str = ""
    pinecone_namespace: str = "smart-catalog"
    pinecone_api_version: str = "2025-04"
    pinecone_timeout_s: float = 10.0

    # Opt-in: crawling every model's schema in the background flooded XMLA and re-indexed on every question.
    index_model_metadata: bool = False
    index_metadata_concurrency: int = 3
    index_metadata_max_models: int = 0
    index_metadata_ttl_s: float = 3600.0
    glossary_path: str = ""

    # PROD / DEV / ARCHIVE hard filtering
    report_env_dev_terms: str = "draft,test,testing,tst,dev,development,uat,sandbox,staging,poc,wip,temp,tmp,sample,copy"
    report_env_archive_terms: str = "archive,archived,backup,bkp,bak,old,deprecated,legacy,obsolete"
    report_env_query_weak_terms: str = "draft,test,testing,old,legacy,copy,sample,temp,tmp,obsolete"
    report_env_prod_phrases: str = (
        "draft survey,draft reading,draft readings,draft marks,vessel draft,arrival draft,departure draft,"
        "drug test,alcohol test,test result,test results"
    )
    report_env_overrides: str = "{}"
    report_env_classify_workspace: bool = True
    nonprod_override_users: str = ""

    # Semantic cache
    semantic_cache_enabled: bool = True
    semantic_cache_ttl_s: float = 900.0
    semantic_cache_unknown_freshness_ttl_s: float = 120.0
    semantic_cache_similarity: float = 0.92
    semantic_cache_max_entries: int = 2000
    freshness_ttl_s: float = 60.0

    # Multi-turn state
    pending_ttl_s: float = 900.0
    max_clarifications: int = 2
    checkpoint_sqlite_path: str = ""

    # Feedback and failure analytics
    analytics_db_path: str = ".data/smart_analytics.db"
    repeat_similarity: float = 0.6
    repeat_window: int = 6

    # HITL learning
    learning_promote_score: float = 6.0
    learning_admin_users: str = ""

    @property
    def origins(self) -> list[str]:
        return csv_list(self.allowed_origins)

    def nonprod_users(self) -> set[str]:
        return {u.lower() for u in csv_list(self.nonprod_override_users)}

    def learning_admins(self) -> set[str]:
        return {u.lower() for u in csv_list(self.learning_admin_users)}

    def agents(self) -> dict[str, str]:
        registry = {"pbi_semantiq_agent": self.semantiq_mcp_url, "pbi_nova_visual_generator": self.nova_mcp_url}
        try:
            extra = json.loads(self.agent_registry or "{}")
        except json.JSONDecodeError:
            extra = {}
        if isinstance(extra, dict):
            registry.update({str(k): str(v) for k, v in extra.items()})
        return registry


@lru_cache
def get_settings() -> OrchestratorSettings:
    return OrchestratorSettings()
