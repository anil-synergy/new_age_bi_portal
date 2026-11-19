# Shared module (components and services)

## Purpose
Cross-cutting building blocks that every feature module may use.

## Structure
```
shared/
├─ components/
│  ├─ ui/button.tsx, input.tsx, sheet.tsx, tabs.tsx   Design-system primitives (cva + Tailwind, Radix where applicable)
│  └─ auth/ProtectedRoute.tsx                         Redirects unauthenticated users; shows BILoader while the session resolves
└─ providers/
   ├─ AuthProvider.tsx    useAuth() over lib/auth/authService (MSAL / Entra)
   └─ ThemeProvider.tsx   useTheme() light/dark, persisted, toggles the `dark` class
```

### Shared service layer (left at the top level of `src/` on purpose)
| Folder | Contents |
| --- | --- |
| `src/context/PortalContext.tsx` | User info, report catalog (cached as `portal_catalog_v1`), semantic model, `refreshUser`; listens for `portal:token-ready` and `portal:admin-changed` |
| `src/lib/` | `config`, `api/axios` + `api/endpoints`, `auth/*`, `azure-embed/*` (server-only), `catalog/*`, `outlook`, `server/*`, `report-events`, `utils` (`cn`) |
| `src/services/` | `biServices` (all bi-report-api calls through `/api/bi/*`), `pbiEmbedService` (embed tokens, pages, semantic model) |
| `src/types/` | Domain types, `.glb` and `powerbi-client-react` declarations |

These are imported by `middleware.ts` and server route handlers (`app/api/*`), as well as by UI. Moving them would touch authentication and data-flow files without any organisational benefit, so they stay where they are.

## Dependencies
`shared` → `loaders` (BILoader inside ProtectedRoute), `lib`.

## Safe modification
- Primitives are used everywhere. Add variants rather than changing defaults.
- `lib/azure-embed` and `lib/auth/sso-server` are server-only. Never import them from client components.
- Do not change `lib/api/endpoints.ts`, `lib/config.ts` or the env var names without coordinating with bi-report-api and deployment settings.
