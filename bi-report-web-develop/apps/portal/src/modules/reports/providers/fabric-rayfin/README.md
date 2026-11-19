# Fabric Rayfin provider

Admin form (Administration → Reports, type **Fabric Rayfin**): hosting URL (required, https),
Fabric workspace ID and Rayfin item ID (required GUIDs). Rows are saved in **`bi_fabric_apps`** with the same
group/user access model as Power BI reports. Sign-in settings stay in environment variables.

## Where it runs

- **Menu / reports:** `/dashboard/{catalogId}` — same as Power BI; [`ReportViewer`](../../components/ReportViewer.tsx) loads [`RayfinHost`](./RayfinHost.tsx) with the catalog row’s `hostingUrl`.
- **MSAL redirect URI:** `http://localhost:3000/dashboard/apps/fabric-rayfin` (recommended for this portal). Unlike `rayfin_embed_test` (Vite serves one page at `http://localhost:8501`), Next.js `/` used to **307** before MSAL could finish unless you use [`HomeRouter`](../../app/HomeRouter.tsx). Register the **exact** redirect in Entra (SPA). After consent, MSAL lands on the fabric-rayfin route (or `/` if you use bare origin), then restores `/dashboard/{catalogId}` from `sessionStorage`.

The embed flow follows the reference project `rayfin_embed_test` and uses `@azure/msal-browser` 4.x and
`@microsoft/rayfin-embed-host` 1.36.2.

## Why a separate sign-in

The portal SSO issues an app JWT; it does not expose a Microsoft delegated token. Rayfin’s
`brokered/authorize/external` needs Entra **`Item.Execute.All`** from the parent page, so this provider uses its
own MSAL `PublicClientApplication` without changing portal auth. **BI_Portal_Auth** (SPN embed tokens) is not used for Fabric; see `apps/portal/docs/d360-pbi-embed.md`.

## Flow

1. Read env auth config; per-app URL/workspace/item id come from the catalog (`getRayfinConfigForApp`, `fromCatalogOnly` when `reportId` is set).
2. `getRayfinMsal` → `handleRedirectPromise` → restore return path to the menu report when needed (`return-path.ts`).
3. Match cached Entra account to the portal user (`portal_user` UPN/email).
4. Preflight `acquireTokenSilent` before the iframe; consent uses `loginRedirect` / `acquireTokenRedirect` with return path stored.
5. `RayfinEmbed` registers `createEmbedHost` before the iframe, then brokers the `fabric-auth` handshake.

## Configuration (`apps/portal/.env.local`, see `.env.example`)

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_RAYFIN_TENANT_ID` | Falls back to `NEXT_PUBLIC_MICROSOFT_TENANT_ID` |
| `NEXT_PUBLIC_RAYFIN_CLIENT_ID` | Entra SPA app for Rayfin embed (not the portal SSO app) |
| `NEXT_PUBLIC_RAYFIN_REDIRECT_URI` | Defaults to `<origin>/dashboard/apps/fabric-rayfin` |
| `NEXT_PUBLIC_RAYFIN_SCOPES` | Usually `https://analysis.windows.net/powerbi/api/Item.Execute.All` |
| `NEXT_PUBLIC_RAYFIN_APP_URL` / `_WORKSPACE_ID` / `_APP_ID` | **Smoke test only** (`/dashboard/apps/fabric-rayfin` without a catalog `reportId`) |

Per production app: **`hosting_url`**, workspace, and item id in **`bi_fabric_apps`**.

### Entra and Rayfin app setup

- Register redirect URI(s) as **Single-page application** on the Rayfin client app.
- Rayfin app: `externalEntraExchange: true`; allow framing from the portal origin.

## Catalog fallback API

If the client catalog cache misses a row, `ReportViewer` calls `GET /api/catalog/reports/{id}` (entitled rows only)
before falling back to bi-report-api for legacy Power BI detail.

## Local dev: OneDrive and `EBUSY` on `.next`

Projects under OneDrive can lock files under `apps/portal/.next` (`EBUSY` on `vendor-chunks/next.js`).
`next.config.mjs` uses in-memory webpack cache in dev, but OneDrive may still lock build output.

1. Stop all `next dev` / Node processes using the portal.
2. Delete `apps/portal/.next`.
3. Restart `npm run dev` from `apps/portal`.

If locks persist, pause OneDrive sync for the repo folder or move the clone outside OneDrive.

## Files

- `config.ts` — env and per-app config; catalog vs smoke-test validation messages.
- `return-path.ts` — MSAL return navigation to `/dashboard/{reportId}`.
- `msal.ts` — MSAL client, redirect handling, portal account binding.
- `RayfinHost.tsx` — waits for catalog, stores return path, embed lifecycle.
- `RayfinEmbed.tsx` — embed host and full-height iframe (no handshake UI).