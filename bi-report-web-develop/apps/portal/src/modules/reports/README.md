# Reports module (Other UI)

## Purpose
Single-report viewing at `/dashboard/:reportId`, embedded apps from other providers at
`/dashboard/apps/:provider`, and the manual embed form used by `/dev/embed`.

## Structure
```
reports/
├─ reports.md                       Multi-provider design, integration points, validation
├─ components/
│  ├─ ReportViewer.tsx              Resolves the report, page ACL and RLS identity, then renders a Power BI or URL tile
│  ├─ ReportLoadForm.tsx            Manual workspace/report form with sessionStorage persistence (dev only)
│  ├─ ProviderConfigFields.tsx      Provider-specific fields for Administration → Reports
│  ├─ ReportHost.tsx                Lazily renders a provider host
│  └─ ProviderPlaceholder.tsx       Card for providers not implemented yet
└─ providers/                       power-bi, fabric-rayfin, azure-web-apps, databricks-apps, other-web-apps
```

## Functionality and business logic
- `ReportViewer` finds the report in the `PortalContext` catalog, fetches details and page ACL (`getReportDetail`, `getReportPageACL`), and builds the `EffectiveIdentity` (RLS) with `firstGuid` for workspace/report ids.
- Power BI reports render `PowerBIReportTile` (loaded with `next/dynamic`); URL-type reports render `UrlEmbedTile`.
- `AILoadingAnimation` covers the resolution phase.
- The application type is chosen only in Administration → Reports (default Power BI); see `reports.md` and each provider's `README.md`.

## Dependencies
`tile-engine`, `loaders`, `shared/components/ui`, `context/PortalContext`, `services/biServices`, `lib/azure-embed/ids`, `types`.
Fabric Rayfin adds `@azure/msal-browser` and `@microsoft/rayfin-embed-host` (loaded only on its route).

## Data flow
Route param → catalog lookup → bi-report-api (through `/api/bi/*`) for details and ACL → tile props → embed token via `/api/embed/token` (inside the tile).

## Safe modification
Keep the `{ reportId }` prop. Do not call `/api/embed/*` directly here; token handling belongs to the tile engine and `services/pbiEmbedService`.
Provider-specific auth and SDK code stays inside `providers/<id>/`.
