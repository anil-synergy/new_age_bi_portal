from __future__ import annotations

from functools import lru_cache

from smart_common.config import LLMSettings, ServiceSettings, agent_settings_config


class NovaSettings(ServiceSettings, LLMSettings):
    model_config = agent_settings_config(__file__)

    port: int = 8102
    nova_max_points: int = 50
    llm_max_output_tokens: int = 300


@lru_cache
def get_settings() -> NovaSettings:
    return NovaSettings()
