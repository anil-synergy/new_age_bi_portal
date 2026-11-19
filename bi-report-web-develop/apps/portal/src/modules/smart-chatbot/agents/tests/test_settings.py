from pbi_nova_visual_generator.settings import NovaSettings
from pbi_semantiq_agent.settings import SemantiqSettings
from smart_common.config import env_file_for
from smart_orchestrator.settings import OrchestratorSettings


def test_defaults_without_env_file():
    s = SemantiqSettings(_env_file=None)
    assert s.port == 8101 and not s.pbi_configured and not s.llm_configured
    assert s.llm_base_url == "https://aigw.synergymarinegroup.com"
    assert s.llm_deployment == "azure_ai/gpt-5.6-luna"
    assert NovaSettings(_env_file=None).port == 8102
    o = OrchestratorSettings(_env_file=None)
    assert o.port == 8100 and o.confidence_threshold == 0.98 and o.portal_jwt_secret is None


def test_real_env_vars_override_and_secrets_are_masked(monkeypatch):
    monkeypatch.setenv("PBI_CLIENT_SECRET", "super-secret-value")
    monkeypatch.setenv("PBI_TENANT_ID", "t")
    monkeypatch.setenv("PBI_CLIENT_ID", "c")
    monkeypatch.setenv("PBI_ALLOWED_WORKSPACE_IDS", "AAA, bbb")
    s = SemantiqSettings(_env_file=None)
    assert s.pbi_configured
    assert s.allowed_workspaces == {"aaa", "bbb"}
    assert "super-secret-value" not in repr(s) and "super-secret-value" not in str(s.model_dump())


def test_agent_registry_merges_extra_agents(monkeypatch):
    monkeypatch.setenv("AGENT_REGISTRY", '{"future_agent": "http://127.0.0.1:8200/mcp"}')
    agents = OrchestratorSettings(_env_file=None).agents()
    assert set(agents) == {"pbi_semantiq_agent", "pbi_nova_visual_generator", "future_agent"}


def test_invalid_registry_is_ignored(monkeypatch):
    monkeypatch.setenv("AGENT_REGISTRY", "not json")
    assert len(OrchestratorSettings(_env_file=None).agents()) == 2


def test_env_file_lives_next_to_agent():
    import pbi_semantiq_agent.settings as mod

    assert env_file_for(mod.__file__).parent.name == "pbi_semantiq_agent"
