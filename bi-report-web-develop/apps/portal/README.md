# Synergy BI Portal (Next.js)

Next.js 14 + TypeScript portal with DATA360-style Microsoft SSO, Power BI tile engine, and Azure Function embed.

## Quick start

```bash
cd apps/portal
cp .env.example .env.local
# Set MICROSOFT_CLIENT_SECRET and JWT_SECRET in .env.local (server-only)
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Microsoft SSO (DATA360 pattern)

1. User signs in at `/login` → Microsoft Entra authorization code flow
2. Callback at `/auth/callback` → `POST /api/sso/token` (client secret stays on server)
3. Portal issues an **app JWT**; `bi-report-api` calls use `Authorization: Bearer`
4. User **UPN** (`preferred_username`) is used as email for report list and Power BI RLS
5. Power BI embed uses Azure Function `BI_Portal_Auth` (no Entra token)

### Required env (see `.env.example`)

**Public:** `NEXT_PUBLIC_MICROSOFT_CLIENT_ID`, `NEXT_PUBLIC_MICROSOFT_TENANT_ID`, `NEXT_PUBLIC_MICROSOFT_REDIRECT_URI`

**Server-only:** `MICROSOFT_CLIENT_SECRET`, `JWT_SECRET`, `MICROSOFT_REDIRECT_URI` (must match public redirect URI)

Register `http://localhost:3000/auth/callback` in Entra app registration.

### Manual embed (dev)

`/dev/embed` — load a report by workspace/report/dataset GUIDs without using the catalog.

## Azure Function

```
POST {NEXT_PUBLIC_AZURE_FUNCTION_BASE}/BI_Portal_Auth
```

Legacy CRA app is in `/_legacy-cra` at repo root.
