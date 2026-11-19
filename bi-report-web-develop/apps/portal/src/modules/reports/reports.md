# Reports: multiple embedded app providers

Administrators choose the **application type** when adding a report in **Administration → Reports**:
Power BI, Fabric Rayfin, Azure Web Apps, Databricks Apps or Other Web Apps. The left report menu and the
report-viewing experience are unchanged (there is no provider selector outside Reports Administration).

## Current status

| Provider | Admin form | Validation | Saved | Embedding |
| --- | --- | --- | --- | --- |
| Power BI | Existing form (unchanged) | Existing | Yes (`bi_report`) | Existing flow, unchanged |
| Fabric Rayfin | Hosting URL, workspace ID, item ID | Yes | Yes (`bi_fabric_apps` + role/user access) | `ReportViewer` → `RayfinHost` (MSAL + embed host); menu/catalog same as PBI |
| Azure Web Apps | App URL, App Service name/resource ID, open mode, auth notes | Yes | **No** | Placeholder |
| Databricks Apps | Workspace URL, app URL, app name, open mode, auth notes | Yes | **No** | Placeholder |
| Other Web Apps | App URL, open mode, auth notes | Yes | **No** | Placeholder |

### Fabric Rayfin storage

Fabric apps live in **`bi_fabric_apps`** with **`bi_fabric_app_role_access`** and **`bi_fabric_app_user_access`**
(mirrors Power BI report permissions). Run `apps/portal/scripts/migrate-bi-fabric-apps.sql` on the catalog database.
Admin save uses the same `POST/PUT …/admin/reports` route with `applicationType: "fabric-rayfin"`.
The user catalog merges entitled fabric rows in `fabric-apps-catalog.ts`; favorites use `bi_fabric_app_id` when present.

Power BI rows remain in `bi_report`. Other non-PBI providers are still validate-only until storage is added.

## Administration panel

The admin entries under the profile icon (Users, Reports, Groups, Categories, Departments, Display Reports) are
present in `modules/layout/components/AccountMenu.tsx` and unchanged. They are shown only when
`canConfigurePortal` confirms an admin role from `user/userInfo` (bi-report-api, then the catalog database).
When the RDS database is unreachable (VPN off), that lookup fails, so the links are hidden and `/admin/*`
redirects to `/access-denied`. Per the agreed decision the live check stays as is; the links return once the
database is reachable.

## Authentication reuse decision (Azure Functions vs Fabric Rayfin)

**Power BI** reports use **BI_Portal_Auth** (confidential client / SPN → `GenerateToken`). **Fabric Rayfin** does **not** use that function; it uses **browser MSAL** and `hosting_url` from `bi_fabric_apps` (see `providers/fabric-rayfin/README.md` and `docs/d360-pbi-embed.md`). The portal blocks Fabric catalog ids on `/api/embed/token`.

The Hawkeye Azure Function (`lib/azure-embed/function-client.ts`: `BI_Portal_Auth`, `D360_PBI_Pages`,
`D360_PBI_SemanticModel`, `D360_PBI_ExecuteDax`) runs server-side with a service principal and returns
**Power BI embed tokens**. Rayfin's `brokered/authorize/external` endpoint needs the signed-in user's
**delegated Microsoft Entra access token** (scope `Item.Execute.All`), obtained in the browser by the parent page
(`@microsoft/rayfin-embed-host` calls `getAccessToken` per handoff). An embed token is not an Entra access token
and an app-only token carries no user, so the function is **not compatible** and is not reused or modified.
The portal's own SSO issues an app JWT, also not usable. Rayfin therefore follows the reference project:
MSAL `PublicClientApplication` (SPA client, sessionStorage cache) plus `createEmbedHost`.

## Configuration

Per deployment (`apps/portal/.env.local`, documented in `.env.example`), used by the embed and not shown on the form:
`NEXT_PUBLIC_RAYFIN_TENANT_ID` (falls back to `NEXT_PUBLIC_MICROSOFT_TENANT_ID`), `NEXT_PUBLIC_RAYFIN_CLIENT_ID`,
`NEXT_PUBLIC_RAYFIN_REDIRECT_URI` (default `<origin>/dashboard/apps/fabric-rayfin`), `NEXT_PUBLIC_RAYFIN_SCOPES`.
Per app (admin form / DB): hosting URL, workspace ID, item ID override the optional env defaults
`NEXT_PUBLIC_RAYFIN_APP_URL` / `_WORKSPACE_ID` / `_APP_ID` (handy for `/dashboard/apps/fabric-rayfin` smoke tests).
No secrets are used: the Rayfin client is a public SPA client.

One-time setup: register the redirect URI as **Single-page application** on the Rayfin Entra app; the Rayfin
app needs `externalEntraExchange: true` and must allow framing/redirects from the portal origin.

After Entra consent, MSAL returns to the registered SPA redirect (`/dashboard/apps/fabric-rayfin` or bare origin); the portal restores the menu route
`/dashboard/{catalogId}` so the correct `hosting_url` is used. See `providers/fabric-rayfin/return-path.ts`.

### Dev: OneDrive `EBUSY` on `.next`

If `next dev` fails with `EBUSY` on files under `apps/portal/.next`, stop Node, delete `.next`, and restart.
OneDrive file locking is unrelated to Rayfin embed; details in `providers/fabric-rayfin/README.md`.

## Structure

```
reports/
├─ reports.md                       This file
├─ components/
│  ├─ ReportViewer.tsx              Power BI, URL, and Fabric Rayfin viewer
│  ├─ ReportLoadForm.tsx            Existing /dev/embed form (unchanged)
│  ├─ ProviderConfigFields.tsx      Renders a provider's admin fields
│  ├─ ReportHost.tsx                Lazily renders a provider host (keyed by provider)
│  └─ ProviderPlaceholder.tsx       Host for providers not implemented yet
└─ providers/
   ├─ types.ts                      Provider definition + host props
   ├─ config-schema.ts              Field schema, defaults, validation
   ├─ registry.ts                   Provider list, default, per-provider fields
   ├─ power-bi/                     Definition + adapter over ReportViewer
   ├─ fabric-rayfin/                Fields, env config, MSAL, embed host
   └─ azure-web-apps/, databricks-apps/, other-web-apps/   Fields + docs
```

`app/dashboard/apps/[provider]/page.tsx` hosts `ReportHost`. It is not linked from navigation; it exists as the
Rayfin MSAL redirect target and test page (`/dashboard/apps/fabric-rayfin`, using the env app URL).

## Modified files (this change)

- `src/modules/menu-panel/components/Sidebar.tsx`: provider dropdown removed (back to its original content).
- `src/modules/reports/components/ReportProviderDropdown.tsx`: deleted.
- `src/app/admin/reports/page.tsx`: application-type select; Power BI branch keeps the existing inputs, payload,
  validation and API calls; other types render `ProviderConfigFields` and validate only. Editing an existing
  report locks the type to Power BI.
- `src/modules/reports/providers/registry.ts`, `config-schema.ts` (new), each provider `index.ts`: field
  definitions.
- `src/modules/reports/components/ProviderConfigFields.tsx` (new),
  `providers/fabric-rayfin/config.ts` (`missingRayfinAuthConfig`).
- Docs: this file and provider READMEs.

Unchanged: `AccountMenu`, admin layout, Users/Groups/Categories/Departments pages, `ReportViewer`,
`PowerBIReportTile`, `/api/embed/*`, Azure Function client, bi-report-api, database.

## Validation

Done: `tsc --noEmit` clean; `next lint` clean on changed files; production build (see summary).

Not verified (needs VPN/database and a signed-in admin session):
- Admin panel visibility and the four admin sections at runtime.
- Power BI create/edit/RLS/embedding end to end (code path unchanged, not exercised).
- Rayfin sign-in and embed (also needs the SPA redirect URI registered).
- Provider forms rendering in the browser.
