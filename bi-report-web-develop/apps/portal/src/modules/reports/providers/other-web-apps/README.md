# Other Web Apps provider (placeholder)

Admin form fields (`index.ts`): App URL (required, https), open mode, authentication notes. They validate but
are not saved yet (see `../../reports.md`).

Shown at `/dashboard/apps/other-web-apps` with the shared `ProviderPlaceholder` card. No auth or embedding
code exists yet, by design.

Existing URL-type catalog reports are **not** affected: they keep opening from the report list at
`/dashboard/:reportId` and render through `tile-engine/UrlEmbedTile` under the Power BI provider.

## What is needed to implement it

- **Authentication**: per app. Public apps need none; apps that need the user identity must define their own
  hand-off (for example a delegated Entra token via postMessage, like Rayfin). Agree the contract first.
- **Embedding**: the app must allow framing by the portal origin. `UrlEmbedTile` can be reused for plain,
  unauthenticated URLs.
- **Configuration**: an app list (catalog rows or `NEXT_PUBLIC_*` values) with title and URL; never secrets.
- **Loading/error states**: loading while the iframe loads, a blocked-framing message with "Open in new tab",
  and an empty state when no apps are configured.

## Implementation steps

1. Add `OtherWebAppsHost.tsx` in this folder implementing `ReportProviderHostProps`, with cleanup on unmount and
   a `REPORT_REFRESH_EVENT` handler.
2. Point `"other-web-apps"` in `components/ReportHost.tsx` at it and set `status: "available"` in `index.ts`.
3. Document the final flow here.
