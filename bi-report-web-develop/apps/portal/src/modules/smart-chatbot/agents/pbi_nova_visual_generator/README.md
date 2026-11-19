# N.O.V.A. (`pbi_nova_visual_generator`)

**Ask. Imagine. Visualize.**

| | |
|---|---|
| Agent name | N.O.V.A. |
| Technical id | `pbi_nova_visual_generator` |
| Role | AI-powered visual generation |
| Personality | Intelligent, precise, creative, and futuristic |

N.O.V.A. turns query results into chart and KPI specs that the portal renders with `ChatChart` (uipkge bar/line/pie) and `ChatKpi`. It is an MCP server (streamable HTTP on `/mcp`) called by SMART.

## Run

```powershell
cd apps/portal/src/modules/smart-chatbot/agents
.\.venv\Scripts\Activate.ps1
pbi-nova                    # or: python -m pbi_nova_visual_generator.server
```

It works without an LLM key: the chart type then comes from data-shape rules alone. `/health/ready` is always 200 and reports whether the LLM is configured.

## Configuration (`.env`, git-ignored; real env vars win)

| Key | Purpose |
|---|---|
| `HOST`, `PORT` (8102), `LOG_LEVEL` | Service binding |
| `MCP_SHARED_SECRET` | Bearer secret SMART must present |
| `NOVA_MAX_POINTS` | Maximum points per chart (top N for bars, latest N for lines) |
| `LLM_*` | AI gateway, used only to choose among valid chart types and a title |

## MCP tools

| Tool | Purpose |
|---|---|
| `generate_visual(question, columns, rows, preferred_type?, title?)` | Validated `VisualSpec` (up to 2,000 input rows) |
| `recommend_visual(question, columns, rows)` | Allowed visual kinds plus x / y columns, rules only |

See [LOGIC.md](LOGIC.md) and [OUTPUT.md](OUTPUT.md).

## Files

| File | Responsibility |
|---|---|
| `server.py` | FastMCP tools and health routes |
| `visual_spec.py` | Column profiling, rule-based recommendation, spec building (all numbers copied from rows) |
| `agent.py` | Optional LLM choice among the allowed kinds |
| `prompts/nova_system.md` | Persona and selection rules |
