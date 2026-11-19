# pbi_semantic_metadata

Portal and Power BI metadata for SemantIQ and SMART retrieval. Two pipelines coexist:

1. **Legacy slug build** (`pbi-build-metadata`) — `catalog.json` + human-readable markdown under workspace/category paths (gitignored).
2. **Metadata intelligence layer** (`pbi-sync-metadata`) — ID-keyed catalog and artifacts under `Workspace_semantic_metadata/` (checked-in inventory jsonl + generated portal catalog).

## Sync (recommended)

From the agents venv, configure `PBI_*` (or Fabric) credentials and `BI_REPORT_DB_*` (same as the portal), then:

```bash
pbi-sync-metadata --mode full
pbi-sync-metadata --mode incremental
pbi-sync-metadata --mode status
```

Production: set `PBI_METADATA_ROOT` to a writable volume. Do **not** assume the Next.js `src/` tree is writable in deploy.

MCP tools (SemantIQ): `sync_semantic_metadata`, `semantic_metadata_status`, `retry_failed_extractions`.

Portal system admins: `POST /api/admin/semantic-metadata/sync`, `GET /api/admin/semantic-metadata/status` (proxies to SemantIQ).

## Layout (`PBI_METADATA_ROOT`, default `Workspace_semantic_metadata/`)

| Path | Purpose |
|------|---------|
| `semantic_model_catalog.jsonl` | **Read-only** dataset inventory snapshot (never overwritten by sync) |
| `semantic_model_catalog_enriched.jsonl` | Dataset-grain business context (domains, entities, systems). Copy from `pbi_semantiq_agent/semantic_model_catalog_enriched.jsonl` or set `PBI_ENRICHED_CATALOG`. |
| `ontology/` | Organisation concepts, aliases, validated bindings, visual→measure map, business rules |
| `portal_report_semantic_catalog.jsonl` | One row per portal report (IDs, env, mapping/extraction status) |
| `workspaces/{workspace_id}/reports/{report_id}/` | Report REST artifacts (`pages.json`, `visuals.json`, …) |
| `workspaces/{workspace_id}/semantic_models/{dataset_id}/` | XMLA artifacts (tables, measures, relationships, hierarchies, DAX refs) |
| `sync_state.json`, `sync_logs/`, `extraction_logs/` | Checkpoints and structured logs (no secrets) |

## Permissions and limitations

- **Report pages/visuals** — Power BI REST `.../reports/{id}/pages` and `.../visuals`. On 403/404, extraction is marked `unsupported`; previous files are kept.
- **Field wells / PBIR** — Not fabricated. `visual_field_mapping.json` records `unsupported` when the API does not expose bindings.
- **XMLA / INFO.VIEW** — Requires workspace on dedicated capacity (Premium, Fabric, or PPU). Otherwise models log `unsupported` and skip XMLA writes.
- **Paginated reports** — Rows with empty `dataset_id` in `semantic_model_catalog.jsonl` stay `unmapped_no_dataset` (no invented model).

## Legacy build

```bash
python -m pbi_semantiq_agent.build_semantic_metadata
```

Options: `--concurrency 3`, `--limit 5` (debug), `--output <path>`.
