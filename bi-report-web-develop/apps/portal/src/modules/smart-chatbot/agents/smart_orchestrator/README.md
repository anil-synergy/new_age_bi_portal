# SMART orchestrator (`smart_orchestrator`)

The supervisor behind the portal's SMART panel. It receives a question from the Next route `/api/smart/chat`, runs a LangGraph graph that calls SemantIQ and N.O.V.A. over MCP, checks the answer and streams progress and the final message as Server-Sent Events.

## Run

```powershell
cd apps/portal/src/modules/smart-chatbot/agents
.\.venv\Scripts\Activate.ps1
python -m smart_orchestrator.app   # unified :8100 (SemantIQ + N.O.V.A. mounted)
```

Or rely on `npm run dev` in `apps/portal`, which starts the same process automatically.

`GET http://127.0.0.1:8100/health/ready` returns 200 only when the LLM key and portal secret are set and both mounted agents answer.

## Configuration (`.env`, git-ignored; real env vars win)

| Key | Purpose |
|---|---|
| `HOST`, `PORT` (8100), `LOG_LEVEL` | Service binding and JSON log level |
| `PORTAL_JWT_SECRET` | Verifies the token the Next route signs; equals the portal's `SMART_ORCHESTRATOR_SECRET` |
| `MCP_SHARED_SECRET` | Bearer secret sent to the agents |
| `ALLOWED_ORIGINS` | CORS allow-list (the browser does not call SMART directly; kept for tooling) |
| `SEMANTIQ_MCP_URL`, `NOVA_MCP_URL` | Agent MCP endpoints (default unified: `http://127.0.0.1:8100/mcp/semantiq/mcp` and `.../mcp/nova/mcp`) |
| `AGENT_REGISTRY` | JSON map of extra agents: `{"agent_id":"http://host:port/mcp"}` |
| `CONFIDENCE_THRESHOLD` | Answer gate (default 0.98) |
| `WORKSPACE_INVENTORY_TTL_S` | How long workspace report and model names are reused (default 300). User permissions are not cached. |
| `MAX_CONCURRENT_REQUESTS` | Graph runs in parallel; extra requests wait and see a "queued" step |
| `USER_REQUESTS_PER_MINUTE` | Per-user limit (HTTP 429 above it) |
| `REQUEST_TIMEOUT_S` | Hard limit for one question |
| `LLM_*` | AI gateway URL, key, deployment, timeout and concurrency |
| `EMBEDDING_*`, `PINECONE_*`, `RETRIEVAL_*`, `RERANK_*`, `INDEX_*`, `GLOSSARY_PATH` | Hybrid retrieval (Pinecone or local vectors + BM25), weights, thresholds, metadata indexing |
| `REPORT_ENV_*`, `NONPROD_OVERRIDE_USERS` | PROD/DEV/ARCHIVE hard filter and the authorized override |
| `SEMANTIC_CACHE_*`, `FRESHNESS_TTL_S` | Permission- and freshness-safe answer cache |
| `PENDING_TTL_S`, `MAX_CLARIFICATIONS`, `CHECKPOINT_SQLITE_PATH` | Multi-turn clarification state |
| `ANALYTICS_DB_PATH`, `REPEAT_*` | Feedback, repeated-question and failure analytics |

All defaults are in `.env.example`; the design is in [RETRIEVAL.md](RETRIEVAL.md).

Without `LLM_API_KEY` SMART still works: intent falls back to keyword rules and summaries to the code-built template (SemantIQ still needs its own key to write DAX).

## HTTP API

- `POST /chat` with `Authorization: Bearer <portal JWT>` and body `{"message": "...", "conversation_id": "...", "context": {"workspace_id", "report_id", "dataset_id", "report_name"}}`. The response is `text/event-stream`; see [OUTPUT.md](OUTPUT.md).
  `context.include_nonprod=true` is honoured only for users in `NONPROD_OVERRIDE_USERS`.
- `POST /feedback` with the same bearer token and body `{"request_id", "rating": "up"|"down", "reason"?, "comment"?}`. 404 when the answer is not the caller's.
- `GET /health` (liveness), `GET /health/ready` (dependencies).

## Files

| File | Responsibility |
|---|---|
| `app.py` | FastAPI app, JWT check, rate limit, concurrency cap, SSE |
| `graph.py` | LangGraph supervisor graph (see [LOGIC.md](LOGIC.md)) |
| `mcp_clients.py` | Agent registry and MCP calls with timeouts and per-agent limits |
| `stats.py` | Totals, top/bottom, share and change computed in code |
| `retrieval.py` | Workspace inventory cache, menu authorization, the user's model pool |
| `environment.py` | PROD/DEV/ARCHIVE classification and what the question asks for |
| `ingestion.py`, `hybrid_index.py`, `bm25.py`, `vector_store.py`, `embeddings.py` | Index documents, BM25, Pinecone/local vectors, embedders |
| `ranking.py` | Hybrid search, rerank and the select/ask/none decision |
| `query_norm.py`, `knowledge/glossary.json` | Tokens, business glossary, time and query signatures |
| `semantic_cache.py`, `conversation.py`, `analytics.py` | Answer cache, pending clarifications, feedback and failure patterns |
| `scripts/retrieval_eval.py`, `scripts/learning_review.py`, `scripts/apply_learning.py` | Offline evaluation and the reviewed learning loop |
| `prompts/intent.md`, `prompts/summarize.md` | Versioned system prompts |
