# Synergy BI Portal — Module Architecture

The portal is a Next.js 14 App Router app. UI code is organised into feature modules under `src/modules/`. Route files stay in `src/app/` because the App Router requires them there; they are thin and import from modules.

## Top-level layout

```
apps/portal/
├─ MODULES.md                 ← this file
├─ snapshot_export/           Report snapshot export (PPT/PDF/Word/Email). Outside src, unchanged.
├─ scripts/dev.mjs            Dev launcher (clears .next for OneDrive).
└─ src/
   ├─ app/                    Next.js routes, layouts and API route handlers (server proxy, embed, SSO, catalog).
   ├─ middleware.ts           Auth/route middleware.
   ├─ assets/                 Images, the ship .glb model, and two standalone reference projects (bi-transition-react, wave-icon).
   ├─ context/PortalContext   Global portal state (user, report catalog, semantic model). Shared service layer.
   ├─ lib/                    Config, auth, axios client + endpoints, catalog, azure-embed, utils. Shared service layer.
   ├─ services/               biServices (bi-report-api calls), pbiEmbedService (embed tokens). Shared service layer.
   ├─ types/                  Shared TypeScript types and module declarations (.glb, powerbi-client-react).
   └─ modules/
      ├─ homepage/            Home screen (background, welcome copy, 3D ship slot).
      ├─ 3d-model/            Three.js ship renderer (HomeShip).
      ├─ cursor-follow/       Docs only — the cursor-follow spring lives inside 3d-model/HomeShip.
      ├─ menu-panel/          Left report menu (Sidebar) and its search/tag state (nav-chrome).
      ├─ smart-chatbot/       SMART AI chat panel, chart/KPI renderers, AI provider, panel open-state hook.
      ├─ layout/              AppShell, glass Header, AccountMenu, GlassTray, MinimalShell.
      ├─ loaders/             BILoader, BITransition, AILoadingAnimation, QHSE loader + CSS.
      ├─ reports/             ReportViewer (single report page), ReportLoadForm (dev embed), provider host/admin fields and providers/* (see reports.md).
      ├─ tile-engine/         Power BI report/visual tiles, URL tiles, tile canvas, display reports.
      ├─ admin/               Admin CRUD screens' building blocks (AdminChrome, CategoryAdmin, etc.).
      └─ shared/              UI primitives (button, input, sheet, tabs), Auth/Theme providers, ProtectedRoute.
```

Each module has a `README.md` describing purpose, structure, behaviour, dependencies, data flow and safe-change rules.

## Module dependency graph

Arrows mean "imports from". Verified acyclic at file level after the refactor.

```
homepage     → layout, 3d-model, context, assets
3d-model     → assets
layout       → menu-panel, smart-chatbot, loaders, shared, context, lib, assets
menu-panel   → shared, context, lib, assets
smart-chatbot→ shared, types, assets
reports      → tile-engine, loaders, shared, context, services, lib, types
tile-engine  → loaders, shared, services, lib, types   (+ ../snapshot_export/target)
admin        → layout, tile-engine, shared, services, types
loaders      → lib
shared       → loaders, lib
context      → services, lib, types
services     → lib, types
lib          → types
```

Rules:

- Feature modules may import from `shared`, `loaders`, `context`, `lib`, `services`, `types`, `assets`.
- `layout` is the composition root for the signed-in shell; it may import feature modules (`menu-panel`, `smart-chatbot`). Feature modules must not import `layout`, except `homepage` and `admin`, which render the `Header`.
- Nothing may import from `src/app/`.
- Inside a module use relative imports; across modules use `@/modules/<name>/...`.

## Shared state

| State | Owner | Consumers |
| --- | --- | --- |
| User, report catalog, semantic model, `refreshUser` | `context/PortalContext` | Almost every module |
| Menu open, search text, active tags | `menu-panel/logic/nav-chrome` (`NavChromeProvider`, mounted by `AppShell`) | Sidebar, Header |
| SMART panel open/close | `smart-chatbot/hooks/useSmartPanel` (provided by `AppShell`) | Header, AppShell |
| Theme | `shared/providers/ThemeProvider` | Header and themed UI |
| Auth session | `shared/providers/AuthProvider` | ProtectedRoute, Sidebar, AccountMenu, login/callback routes |

Window events (unchanged): `portal:token-ready`, `portal:admin-changed` (admin CRUD → `PortalContext.refreshUser` → menu and filters refresh), and the report refresh events in `lib/report-events`.

## Data flow (unchanged by the refactor)

Browser → `/api/bi/*` (Next route proxy) → bi-report-api. Power BI embed tokens and DAX go through server-only `/api/embed/*` → `lib/azure-embed`. The catalog comes from `/api/catalog/*`. No endpoint, auth flow, environment variable or payload was changed.

## Why some things were not moved

- `lib/`, `services/`, `context/`, `types/` already form a clean shared service layer, and they are imported by `middleware.ts` and server route handlers. Moving them adds churn in auth and data-flow files for no organisational gain, so they stay at the top level and are documented in `modules/shared/README.md`.
- `assets/` stays put. Images are imported through `@/assets/...` in several modules, and the folder contains two standalone reference projects (with their own `node_modules`) that must not be scanned or moved.
- Cursor follow is not a separate component. It is the pointer handler and critically damped spring inside `HomeShip`'s render loop. Extracting it would mean rewriting the 3D render loop, so it was left in place byte-for-byte (see `modules/cursor-follow/README.md`).
- `snapshot_export/` stays outside `src`; only the relative import paths that point to it were updated.

## Config touched

`tailwind.config.ts` `content` now scans `./src/app/**` and `./src/modules/**`. The old `components/` and `features/` globs were removed because those folders no longer exist. If you add UI code outside these folders, add its glob or its Tailwind classes will be purged.
