# Databricks Apps provider (placeholder)

Admin form fields (`index.ts`): workspace URL and app URL (required, https), app name, open mode,
authentication notes. They validate but are not saved yet (see `../../reports.md`).

Shown at `/dashboard/apps/databricks-apps` with the shared `ProviderPlaceholder` card. No auth or embedding
code exists yet, by design.

## What is needed to implement it

- **Authentication**: Databricks Apps sit behind the workspace's own sign-in. Confirm with the Databricks
  workspace owners whether apps can be embedded for portal users, which identity is used, and whether a
  token hand-off from the portal is supported. Do not implement a flow before that is confirmed.
- **Embedding**: verify the app URL can be framed by the portal origin and that the workspace session cookie
  works inside an iframe (third-party cookie rules).
- **Configuration**: app URL(s) as `NEXT_PUBLIC_*` values or catalog rows; workspace IDs only, never tokens or
  secrets.
- **Loading/error states**: loading while the iframe loads, a sign-in-required message, and a
  blocked-framing message with "Open in new tab".

## Implementation steps

1. Add `DatabricksAppsHost.tsx` in this folder implementing `ReportProviderHostProps`, with cleanup on unmount
   and a `REPORT_REFRESH_EVENT` handler.
2. Point `"databricks-apps"` in `components/ReportHost.tsx` at it and set `status: "available"` in `index.ts`.
3. Document the final flow here.
