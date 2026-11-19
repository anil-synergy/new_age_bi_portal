"""Create git-ignored agent .env files from apps/portal/.env.local (run locally)."""
from __future__ import annotations

import re
from pathlib import Path

AGENTS = Path(__file__).resolve().parents[1]
PORTAL_ENV = AGENTS.parents[3] / ".env.local"
MCP = "smart-agents-local-mcp-dev-2026"


def parse_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            out[key] = val
    return out


def main() -> None:
    portal = parse_env(PORTAL_ENV)
    portal_jwt = portal.get("SMART_ORCHESTRATOR_SECRET") or portal.get("JWT_SECRET")
    if not portal_jwt:
        raise SystemExit("Set SMART_ORCHESTRATOR_SECRET (or JWT_SECRET) in apps/portal/.env.local")

    llm_url = portal.get("AZURE_OPENAI_ENDPOINT", "https://aigw.synergymarinegroup.com")
    llm_key = portal.get("AZURE_OPENAI_API_KEY", "")
    llm_deploy = portal.get("AZURE_OPENAI_DEPLOYMENT", "azure_ai/gpt-5.6-luna")

    pbi_tenant = portal.get("SMART_PBI_TENANT_ID") or portal.get("MICROSOFT_TENANT_ID", "")
    pbi_client = portal.get("SMART_PBI_CLIENT_ID", "")
    pbi_secret = portal.get("SMART_PBI_CLIENT_SECRET", "")
    if not all([pbi_tenant, pbi_client, pbi_secret]):
        raise SystemExit("Set SMART_PBI_CLIENT_ID and SMART_PBI_CLIENT_SECRET in .env.local for SemantIQ.")

    semantiq = f"""HOST=127.0.0.1
PORT=8101
LOG_LEVEL=INFO
MCP_SHARED_SECRET={MCP}
PBI_TENANT_ID={pbi_tenant}
PBI_CLIENT_ID={pbi_client}
PBI_CLIENT_SECRET={pbi_secret}
PBI_SCOPE=https://analysis.windows.net/powerbi/api/.default
PBI_API_BASE=https://api.powerbi.com/v1.0/myorg
PBI_ALLOWED_WORKSPACE_IDS=
PBI_MAX_ROWS=500
PBI_MAX_CONCURRENCY=8
PBI_TIMEOUT_S=60
METADATA_CACHE_TTL_S=900
LLM_BASE_URL={llm_url}
LLM_API_KEY={llm_key}
LLM_DEPLOYMENT={llm_deploy}
LLM_TIMEOUT_S=60
LLM_MAX_CONCURRENCY=8
"""

    nova = f"""HOST=127.0.0.1
PORT=8102
LOG_LEVEL=INFO
MCP_SHARED_SECRET={MCP}
NOVA_MAX_POINTS=50
LLM_BASE_URL={llm_url}
LLM_API_KEY={llm_key}
LLM_DEPLOYMENT={llm_deploy}
LLM_TIMEOUT_S=45
LLM_MAX_CONCURRENCY=8
"""

    orch = f"""HOST=127.0.0.1
PORT=8100
LOG_LEVEL=INFO
PORTAL_JWT_SECRET={portal_jwt}
MCP_SHARED_SECRET={MCP}
ALLOWED_ORIGINS=http://localhost:3000
SEMANTIQ_MCP_URL=http://127.0.0.1:8100/mcp/semantiq/mcp
NOVA_MCP_URL=http://127.0.0.1:8100/mcp/nova/mcp
AGENT_REGISTRY={{}}
CONFIDENCE_THRESHOLD=0.98
MAX_CONCURRENT_REQUESTS=32
USER_REQUESTS_PER_MINUTE=20
REQUEST_TIMEOUT_S=120
LLM_BASE_URL={llm_url}
LLM_API_KEY={llm_key}
LLM_DEPLOYMENT={llm_deploy}
LLM_TIMEOUT_S=60
LLM_MAX_CONCURRENCY=16
"""

    (AGENTS / "pbi_semantiq_agent" / ".env").write_text(semantiq, encoding="utf-8")
    (AGENTS / "pbi_nova_visual_generator" / ".env").write_text(nova, encoding="utf-8")
    (AGENTS / "smart_orchestrator" / ".env").write_text(orch, encoding="utf-8")
    print("wrote pbi_semantiq_agent/.env, pbi_nova_visual_generator/.env, smart_orchestrator/.env")


if __name__ == "__main__":
    main()
