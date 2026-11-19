# Azure Web Apps provider (placeholder)

Admin form fields (`index.ts`): App URL (required, https), App Service name or resource ID, open mode,
authentication notes. They validate but are not saved yet (see `../../reports.md`).

Shown at `/dashboard/apps/azure-web-apps` with the shared `ProviderPlaceholder` card. No auth or embedding
code exists yet, by design: nothing is assumed until a target app and its auth model are agreed.

## What is needed to implement it

- **Authentication**: decide how the app authenticates the embedded user (App Service Authentication "Easy Auth"
  with Entra, an app-specific token, or anonymous). If it needs a delegated token from the portal, define the
  scope and the hand-off contract (query string, postMessage, or cookie), and who validates it.
- **Embedding**: the app must allow framing by the portal origin (`Content-Security-Policy: frame-ancestors`,
  no `X-Frame-Options: DENY`) and third-party cookie behavior must be tested if it uses cookies.
- **Configuration**: list the app URL(s) as `NEXT_PUBLIC_*` values or catalog rows; never secrets in the browser.
- **Loading/error states**: loading while the iframe loads, a blocked-framing message with "Open in new tab",
  and an auth-failure message.

## Implementation steps

1. Add `AzureWebAppsHost.tsx` in this folder implementing `ReportProviderHostProps`, with cleanup on unmount and
   a `REPORT_REFRESH_EVENT` handler.
2. Point `"azure-web-apps"` in `components/ReportHost.tsx` at it and set `status: "available"` in `index.ts`.
3. Document the final flow here.
