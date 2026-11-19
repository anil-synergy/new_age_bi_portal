# SemantIQ output

Every tool returns a JSON object with `status`: `ok`, `error` (with `message`) or `rejected` (with `errors`).

## `answer_question`

### status `ok`

```json
{
  "status": "ok",
  "dax": "EVALUATE TOPN(5, SUMMARIZECOLUMNS('PO'[Vendor], \"Spend\", [Spend]), [Spend], DESC)",
  "executed_dax": "EVALUATE TOPN(5, SUMMARIZECOLUMNS('PO'[Vendor], \"Spend\", [Spend]), [Spend], DESC)",
  "columns": ["Vendor", "Spend"],
  "rows": [{"Vendor": "Acme Marine", "Spend": 412000}, {"Vendor": "Blue Fleet", "Spend": 301500}],
  "row_count": 2,
  "truncated": false,
  "references": ["'PO'[Vendor]", "[Spend]"],
  "assumptions": ["Spend means the [Spend] measure (committed PO value)"],
  "result_description": "Vendor name and total committed spend",
  "model": {"workspaceId": "<guid>", "datasetId": "<guid>", "name": "PO Spend"},
  "rls_user": "user@synergymarinegroup.com",
  "confidence_components": {"schema_match": 1.0, "query_success": 1.0, "intent_clarity": 0.99},
  "attempts": 1,
  "timings": {"load_ms": 12.4, "plan1_ms": 2300.1, "execute_ms": 840.7}
}
```

Column keys are bracket-free (`'PO'[Vendor]` becomes `Vendor`). `executed_dax` includes the `TOPN` row cap when one was added.

### status `needs_clarification` / `unanswerable`

```json
{
  "status": "needs_clarification",
  "clarifying_question": "Do you mean committed PO amount or invoiced amount?",
  "candidates": ["PO[PO Amount]", "Invoice[Invoiced Amount]"],
  "missing": null,
  "confidence_components": {"schema_match": 1.0, "query_success": 0.0, "intent_clarity": 0.0}
}
```

### status `query_failed` / `model_unavailable` / `llm_unavailable`

```json
{
  "status": "query_failed",
  "message": "I could not build a valid query for this question against the model.",
  "errors": ["Unknown measure or column [Total Cost]"],
  "dax": "EVALUATE ROW(\"x\", [Total Cost])",
  "candidates": ["PO[Spend]", "PO[PO Count]"],
  "confidence_components": {"schema_match": 0.0, "query_success": 0.0, "intent_clarity": 0.0}
}
```

## `search_model`

```json
{
  "status": "ok",
  "matches": [
    {"kind": "measure", "table": "PO", "name": "Spend", "formatString": "#,0", "description": "Committed PO value", "score": 1.2},
    {"kind": "column", "table": "Vendor", "name": "Vendor Name", "dataType": "String", "description": null, "score": 1.0}
  ],
  "stats": {"tables": 12, "columns": 140, "measures": 35, "relationships": 11}
}
```

## `get_model_schema`

`{"status": "ok", "schema": {"workspaceId", "datasetId", "name", "stats", "tables": [{"name", "description", "columns": [...], "measures": [...]}], "relationships": [...]}}`. Measure expressions appear only with `include_expressions=true`.

## `get_dataset_freshness`

`{"status": "ok", "freshness": {"refreshedAt": "2026-11-01T06:00:12Z", "refreshStatus": "Completed", "refreshId": "..."}}`. `refreshedAt` is null when the model has no refresh history (SMART then caches for the short TTL only).

## `run_dax`

`{"status": "ok", "columns", "rows", "row_count", "truncated", "references"}`, or `{"status": "rejected", "errors": [...]}` when the guard fails.

## How it reaches the user

SMART turns `rows` into stats, a table and a N.O.V.A. visual; `references` become citations; `dax` sits behind the panel's "DAX" toggle; `rls_user` is shown as "Row-level security applied for ...".
