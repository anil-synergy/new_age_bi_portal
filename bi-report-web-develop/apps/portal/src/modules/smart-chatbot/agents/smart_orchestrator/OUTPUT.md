# SMART output

`POST /chat` streams Server-Sent Events: several `step` events, then exactly one `message`.

```text
event: step
data: {"step": "accepted", "status": "done", "label": "SMART received your question", "requestId": "3f9c..."}

event: step
data: {"step": "query", "status": "done", "label": "Query returned 5 rows", "agent": "pbi_semantiq_agent", "ms": 2140.5}

event: message
data: { ...final message... }
```

## Final message

Empty fields are omitted.

| Field | Type | Meaning |
|---|---|---|
| `content` | string | Summary text (grounded) or a clarifying / info message |
| `kind` | `answer` \| `info` \| `clarification` \| `low_confidence` \| `error` | How the panel should treat it |
| `confidence` | number 0-1 | Product of the validator scores |
| `confidenceDetail` | `{score, components}` | Per-check scores |
| `agents` | string[] | Agents that contributed |
| `highlights` | string[] | Short grounded bullet points |
| `stats` | `{label, value}[]` | Up to 4 stat cards computed in code |
| `table` | `{columns, rows, truncated}` | Up to 50 result rows |
| `visual` | VisualSpec | N.O.V.A. chart / KPI spec, see `pbi_nova_visual_generator/OUTPUT.md` |
| `citations` | `{kind, name}[]` | Model objects referenced by the DAX |
| `assumptions` | string[] | Interpretations SemantIQ made |
| `candidates` | string[] | Suggested measures / readings when clarification is needed |
| `query` | string | DAX as written (the executed version adds the row cap) |
| `rlsUser` | string | Identity used for row-level security |
| `requestId`, `elapsedMs` | string, number | Correlation id (also in logs, and the id sent to `POST /feedback`) and total time |
| `cache` | `{hit, ageS, similarity}` | Present on answers reused from the semantic cache |
| `environment` | `DEV` \| `ARCHIVE` | Present only when the source model is not production; the text also names it |

## Example answer

```json
{
  "content": "Total spend is 1,245,300 across 5 vendors. Acme Marine is highest at 412,000 (33.08% of the total).",
  "kind": "answer",
  "confidence": 1.0,
  "agents": ["pbi_semantiq_agent", "pbi_nova_visual_generator"],
  "highlights": ["Acme Marine accounts for a third of spend"],
  "stats": [{"label": "Total Spend", "value": "1,245,300"}, {"label": "Top: Acme Marine", "value": "412,000"}],
  "table": {"columns": ["Vendor", "Spend"], "rows": [{"Vendor": "Acme Marine", "Spend": 412000}], "truncated": false},
  "visual": {"kind": "chart", "title": "Spend by Vendor", "chart": {"type": "bar", "labels": ["Acme Marine"], "datasets": [{"label": "Spend", "data": [412000]}]}},
  "citations": [{"kind": "reference", "name": "'PO'[Vendor]"}, {"kind": "reference", "name": "[Spend]"}],
  "query": "EVALUATE TOPN(5, SUMMARIZECOLUMNS('PO'[Vendor], \"Spend\", [Spend]), [Spend], DESC)",
  "rlsUser": "user@synergymarinegroup.com",
  "requestId": "3f9c...",
  "elapsedMs": 6120
}
```

## Example clarification

```json
{
  "content": "Do you mean committed PO amount or invoiced amount?",
  "kind": "clarification",
  "confidence": 0.0,
  "candidates": ["PO[PO Amount]", "Invoice[Invoiced Amount]"],
  "agents": ["pbi_semantiq_agent"]
}
```

## How the portal renders it

`SmartOrchestratorProvider` maps the message onto `ChatMessage`. `SmartAnswer` shows:

- the text and highlights;
- stat cards;
- the N.O.V.A. chart or KPI (existing `ChatChart` / `ChatKpi`);
- the data table;
- candidate chips (click to ask);
- citations;
- a confidence badge;
- DAX and step toggles;
- the RLS note.
