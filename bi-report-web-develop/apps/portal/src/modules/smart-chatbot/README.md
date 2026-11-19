# SMART Chatbot module

## Purpose
The SMART AI assistant panel that slides in on the right. It answers questions about the current report's semantic model and can render charts and KPIs inline.

## Structure
```
smart-chatbot/
├─ components/
│  ├─ AIChatPanel.tsx    Chat UI (messages, input, live agent steps, idle auto-close)
│  ├─ SmartAnswer.tsx    Assistant reply: text, highlights, stats, chart/KPI, table, citations, confidence, DAX
│  ├─ ChatChart.tsx      chart.js renderer for ChartPayload replies
│  └─ ChatKpi.tsx        KPI card renderer for KpiPayload replies
├─ hooks/useSmartPanel.ts SmartPanelContext + useSmartPanel() (open, setOpen, toggle)
├─ services/
│  ├─ types.ts                      AIProvider / SemanticModelContext / ChatOptions contracts
│  ├─ SmartOrchestratorProvider.ts  Calls /api/smart/chat and parses the SSE stream
│  └─ PlaceholderGPT5Provider.ts    Fallback when the orchestrator is not configured or unreachable
└─ agents/               Python services: SMART orchestrator, SemantIQ, N.O.V.A. (see agents/README.md)
```

Server route: `src/app/api/smart/chat/route.ts`.

## Multi-agent backend
The panel talks to the SMART LangGraph orchestrator, which calls two MCP agents:
- **SemantIQ** (`agents/pbi_semantiq_agent`) reads Power BI semantic models and runs validated, RLS-scoped DAX.
- **N.O.V.A.** (`agents/pbi_nova_visual_generator`) turns results into charts and KPIs.

Design, threat model and run order: [agents/README.md](agents/README.md). Each agent folder has `README.md`, `LOGIC.md` and `OUTPUT.md`.

## Functionality and business logic
- `AppShell` owns the open state and provides it through `SmartPanelContext`. The Header's SMART button calls `toggle()`.
- When the panel opens on `/dashboard/:id` or `/display/:id`, AppShell calls `loadSemanticModel(id)` and passes the model to `AIChatPanel`.
- `autoCloseSeconds` (AppShell passes 0, meaning disabled) closes the panel after inactivity.
- `SmartOrchestratorProvider` posts `{message, conversationId, reportId}` with the user's Entra bearer to `/api/smart/chat`. The route:
  - verifies the token;
  - resolves the report's workspace, report and dataset ids from the user's own catalog (403 if the report is not theirs);
  - signs a 2-minute HS256 token with `SMART_ORCHESTRATOR_SECRET`;
  - streams the orchestrator's SSE back.
- Step events update the live progress list. The final message becomes a `ChatMessage` with the optional orchestrator fields: `kind`, `stats`, `highlights`, `table`, `citations`, `confidence`, `query`, `agentTrace`, and so on.
- A new `conversationId` is created per report, so the orchestrator's memory never mixes semantic models.
- If the route returns 503 (orchestrator not configured or unreachable), the panel uses `PlaceholderGPT5Provider` instead. It posts to `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${deployment}/chat/completions` when endpoint and key are present; otherwise it returns a placeholder reply.

## UI/UX
- Panel width animates 0 ↔ 380 px (0.32 s, easing `[0.22, 1, 0.36, 1]`) inside AppShell's `motion.aside`.
- Uses the `assets/SMART_logo.png` brand mark.

## Dependencies
`shared/components/ui` (Button, Input), `types` (ChatMessage, SemanticModel, ChartPayload, KpiPayload), `chart.js`, `assets`.

## Data flow
1. The Header button calls `useSmartPanel().toggle`, which updates the AppShell state.
2. AppShell calls `PortalContext.loadSemanticModel` and passes the result to `AIChatPanel` as props.
3. The panel calls `SmartOrchestratorProvider.chat`, which posts to `/api/smart/chat`.
4. The route calls the SMART orchestrator, which calls SemantIQ and N.O.V.A.
5. SSE step events stream back, followed by the final message.
6. `SmartAnswer` renders the reply.

Env (server only, `.env.local`): `SMART_ORCHESTRATOR_URL`, `SMART_ORCHESTRATOR_SECRET`.

## Safe modification
- `SmartPanelContext` must have exactly one provider (AppShell). `useSmartPanel()` returns `null` outside it, and callers already handle that.
- Known limitation (pre-existing, not changed): the provider runs in the browser, where non-`NEXT_PUBLIC_` env vars are undefined, so it always uses the fallback. Real Azure OpenAI calls should go through a server route so the key is never exposed.
- To add a provider, implement `AIProvider` in `services/` and swap the instance in `AIChatPanel`.
- To add a backend agent, follow "Adding an agent" in [agents/README.md](agents/README.md); the panel needs no change.
- Never pass workspace or dataset ids from the browser to the orchestrator; the route resolves them from the catalog.
