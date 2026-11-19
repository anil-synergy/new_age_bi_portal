"""Settings loading.

Each agent keeps its secrets in its own git-ignored ``.env`` next to its code.
Real environment variables win over the file, so ECS / Key Vault / CI can inject
values without touching the file. Nothing secret has a default value.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


def env_file_for(module_file: str) -> Path:
    """The ``.env`` that sits in the same folder as the given module."""
    return Path(module_file).resolve().parent / ".env"


def agent_settings_config(module_file: str) -> SettingsConfigDict:
    return SettingsConfigDict(
        env_file=env_file_for(module_file),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


def csv_list(value: str | None) -> list[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]


class LLMSettings(BaseSettings):
    """OpenAI-compatible AI gateway used by every agent."""

    llm_base_url: str = "https://aigw.synergymarinegroup.com"
    llm_api_key: SecretStr | None = None
    llm_deployment: str = "azure_ai/gpt-5.6-luna"
    llm_timeout_s: float = 60.0
    llm_max_concurrency: int = 8
    llm_max_output_tokens: int = 1500
    # GPT-5 family deployments only accept the default temperature, so it is omitted unless set.
    llm_temperature: float | None = None

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_base_url and self.llm_api_key and self.llm_api_key.get_secret_value())


class ServiceSettings(BaseSettings):
    """Network and inter-service auth shared by all three services."""

    host: str = "127.0.0.1"
    port: int = 8100
    log_level: str = "INFO"
    # Bearer secret the orchestrator presents to the MCP agents. Required outside local dev.
    mcp_shared_secret: SecretStr | None = None

    def mcp_secret(self) -> str | None:
        return self.mcp_shared_secret.get_secret_value() if self.mcp_shared_secret else None
