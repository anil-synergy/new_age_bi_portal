# SemantIQ (`pbi_semantiq_agent`)

An AI-powered assistant that discovers, interprets, and navigates Power BI semantic models, helping users identify relevant tables, columns, measures, relationships, and business metrics.

SemantIQ is an MCP server (streamable HTTP on `/mcp`). SMART calls it; it is not meant to be exposed to browsers.

## Run

```powershell
cd apps/portal/src/modules/smart-chatbot/agents
.\.venv\Scripts\Activate.ps1
pbi-semantiq                # or: python -m pbi_semantiq_agent.server
```

`GET http://127.0.0.1:8101/health/ready` returns 200 when the service principal can get a Power BI token and the LLM key is set.

## Configuration (`.env`, git-ignored; real env vars win)

| Key | Purpose |
|---|---|
| `HOST`, `PORT` (8101), `LOG_LEVEL` | Service binding |
| `MCP_SHARED_SECRET` | Bearer secret SMART must present |
| `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET` | Service principal (MSAL client credentials) |
| `PBI_SCOPE`, `PBI_API_BASE` | Power BI REST scope and base URL |
| `PBI_ALLOWED_WORKSPACE_IDS` | Comma-separated allow-list; empty means every workspace the principal can see |
| `PBI_MAX_ROWS` | Row cap per query (enforced with `TOPN`) |
| `PBI_MAX_CONCURRENCY`, `PBI_TIMEOUT_S` | Parallel Power BI calls and timeout |
| `METADATA_CACHE_TTL_S`, `METADATA_CACHE_MAX_ENTRIES` (1024) | Schema cache lifetime and max datasets cached in memory |
| `GRAPH_*` | Reserved for a later Microsoft Graph integration |
| `LLM_*` | AI gateway used to write DAX |

Never copy credentials from scripts such as `PO_SPEND_Powerbi_rls_embed_script.py`; take them from the secret store.

## Power BI prerequisites

- SemantIQ agents run on **Windows** with **pythonnet** and the vendored `adomd/Microsoft.AnalysisServices.AdomdClient.dll`.
- Tenant settings allow service principals to use Power BI APIs; workspaces must be on **Premium, Fabric, or PPU** capacity (XMLA read).
- The principal is a member of each allowed workspace and has **Dataset.Read.All** (or ReadWrite) on the app registration.
- **REST** (`MSAL` + `api.powerbi.com`) lists workspaces, datasets, reports, and refresh history.
- **XMLA** (`powerbi://…` + ADOMD) runs all DAX, including `INFO.VIEW.*` metadata and analytical queries, as the service principal only (no `EffectiveUserName` / `impersonatedUserName`). Portal SMART does not impersonate the signed-in user; RLS is not applied on this path.

## MCP tools

| Tool | Purpose |
|---|---|
| `list_workspaces()` | Allowed workspaces |
| `list_semantic_models(workspace_id)` | Datasets in a workspace, with RLS flags |
| `resolve_report_model(workspace_id, report_id)` | Dataset behind a report |
| `get_model_schema(workspace_id, dataset_id, user_email?, include_expressions?)` | Tables, columns, measures, relationships |
| `search_model(workspace_id, dataset_id, query, user_email?, limit?)` | Ranked matching tables / columns / measures |
| `get_dataset_freshness(workspace_id, dataset_id)` | Last refresh time, status and id (SMART's cache invalidation) |
| `validate_dax(workspace_id, dataset_id, dax, user_email?)` | Static guard only (no XMLA execute) |
| `run_dax(workspace_id, dataset_id, dax, user_email)` | Guarded read-only DAX as the service principal (`user_email` audit only; no per-user RLS) |
| `answer_question(question, workspace_id, dataset_id, user_email, report_id?)` | Full subgraph (optional `report_id` for catalog resolution) |

Logic: [LOGIC.md](LOGIC.md). Output shapes: [OUTPUT.md](OUTPUT.md).

## Files

| File | Responsibility |
|---|---|
| `server.py` | FastMCP tools, health routes, shared-secret middleware |
| `powerbi_client.py` | MSAL + REST inventory; XMLA DAX via `xmla_client.py`, workspace/dataset name resolution |
| `xmla_client.py` | ADOMD.NET connection (SP in connection string), sync DAX execution |
| `metadata.py` | `INFO.VIEW.*` loading, schema model, relevance ranking and schema slices |
| `dax_guard.py` | Static validation and row cap for generated DAX |
| `agent.py` | LangGraph sub-graph for `answer_question` |
| `cache.py` | Async TTL cache with single-flight loading |
| `prompts/semantiq_dax.md` | DAX planner system prompt |
