# API, staging database and hierarchical menu

Scope: `bi-report-api-develop/PowerBi` (.NET API) and `bi-report-web-develop/apps/portal` (Next.js portal).
No secrets are reproduced here. Values shown as `<...>` must come from a secret store or environment variable.

## 1. API analysis

| Area | Finding |
| --- | --- |
| Runtime | .NET 6 (`net6.0`), ASP.NET Core minimal hosting (`Program.cs`) |
| Projects | `PowerBI.Api` (controllers, startup), `PowerBI.Core` (entities, DTOs), `PowerBIPortal.Data` (EF Core DbContext, repositories, migrations), `PowerBIPortal.Services` (business logic), `PowerBIPortal.Root` |
| Data access | EF Core 6.0.9 + `Npgsql.EntityFrameworkCore.PostgreSQL` 6.0.6, one scoped `PortalDbContext`, repositories registered as transient |
| Startup | `PrepareLookUpData` runs `Database.Migrate()` on every start |
| Auth | `Microsoft.Identity.Web` JWT bearer (`AzureAd` section) with audience `clientId` / `api://clientId` |
| Logging | Serilog → PostgreSQL sink (`logs` table), Sentry |
| Private NuGet | `Synergy.Core.EmbeddedAnalytics` / `Synergy.Core.*` from `nuget.pkg.github.com/Synergy-Marine-Group`; `nuget.config` already reads `%NUGET_SECRET%` |
| Tests | No test projects exist in the solution |
| Menu API | `GET /bi-report-api/v1/report/reports` returns `ReportDetailsDto[]` with `categoryId` / `categoryName` only (flat) |

## 2. Database connectivity – root causes

Verified from this machine on 29 Oct 2026 (VPN connected):

| Check | Staging (`synergy-staging…rds.amazonaws.com:5432/synergy_bi_reports`) |
| --- | --- |
| DNS / TCP 5432 | Resolves, port open (only with VPN; without VPN RDS is unreachable — this caused the earlier catalog 500s) |
| Credentials (`bi_user`) | Login succeeds |
| Permissions | CONNECT, CREATE on `public`, full DML on all 11 tables |
| SSL | Server has `ssl=on`. Npgsql's default `SSL Mode=Prefer` negotiated **TLS 1.3** (verified via `pg_stat_ssl`) |
| Migrations | 13 applied = 13 in code, so startup `Migrate()` is a no-op on staging |
| Server | PostgreSQL 16.13 |

Configuration root causes found in the repository (these explain why "staging" did not use the staging database):

1. **Every ECS task definition sets `ASPNETCORE_ENVIRONMENT=Development`** (`task-definitions/develop|qa|staging|prod.json`) and the Dockerfile sets `DOCKER_ENVIRONMENT=develop`. A container built from this repo therefore loads `appsettings.Development.json` (QA host `sac-qa-db…`), never `appsettings.staging.json`. *Assumption:* the live ECS services use these files (the deploy workflows register them); the AWS console was not inspected.
2. **Environment variables could not override JSON.** `Program.cs` re-adds the JSON files after the default host builder has loaded environment variables, so `ConnectionStrings__BIReportDbConnection` (or any secret injected by ECS/SSM) was silently ignored. **Fixed** (see §4).
3. On Linux the file name is case-sensitive: `appsettings.staging.json` is only loaded when `ASPNETCORE_ENVIRONMENT` is exactly `staging` (lower case).
4. Secrets are committed in plain text: the staging DB password, SMTP and EmbeddedAnalytics credentials in `appsettings.*.json`, and a GitHub package token in `PowerBI.Api/Dockerfile`. They should be rotated and moved to SSM Parameter Store / Secrets Manager.
5. `appsettings.staging.json` has `WebUrl` pointing at the QA portal and `ShowStackTrace: true` – review before using it for staging.

Missing to complete a staging deployment (not invented here): the SSM parameter name for the staging connection string, confirmation that the staging ECS service should switch to `ASPNETCORE_ENVIRONMENT=staging`, and a `NUGET_SECRET` GitHub Actions secret for the Docker build.

## 3. Technology recommendations

| Topic | Recommendation | Action taken |
| --- | --- | --- |
| Pooling | Npgsql pooling is on by default; keep `Pooling=true`, optionally `Maximum Pool Size` per task size | None needed |
| EF Core vs Dapper | Keep EF Core; the hierarchy read uses plain ADO through the same `DbContext` connection only because those columns are not in the EF model | No migration |
| Retries | `EnableRetryOnFailure` is **not** safe here: 11 service methods use manual `BeginTransactionAsync`, which throws under a retrying execution strategy. Introduce it only together with `CreateExecutionStrategy().ExecuteAsync(...)` wrappers | Not enabled |
| Timeouts | Npgsql defaults (`Timeout=15`, `Command Timeout=30`) are reasonable; readiness check has a 5 s cap | Readiness timeout added |
| SSL | Use `SSL Mode=Require;Trust Server Certificate=true` (or the RDS CA bundle with `VerifyFull`) in the secret connection string to make encryption mandatory | Documented |
| Async / cancellation | New hierarchy query is async and accepts a `CancellationToken` | Done |
| Parameterised queries | Existing EF LINQ is parameterised; new SQL has no user input | Done |
| Config & secrets | Env vars / SSM override JSON (fixed); never commit connection strings | Fixed |
| Health checks | Liveness (`/ping`, `/health`) and catalog readiness (`/health/ready`) are served by **Next.js** when callers use the portal proxy (`GET /api/bi/bi-report-api/v1/ping|health|health/ready`); readiness uses Postgres `SELECT 1` via `getDevDbPool()` (same catalog as menu). **bi-report-api** still exposes the same three paths on `:5074` until decommission | Phase 1 cutover (portal) |
| Identity + menu reads | `GET /user/userInfo` and `GET /report/reports` are served by **Next.js** from the catalog Postgres pool via `/api/catalog/user-info`, `/api/catalog/reports`, and the same paths under `/api/bi/bi-report-api/v1/…` (401 when the Entra user has no `users` row on the BI proxy path; catalog routes keep empty profile for unknown users). **bi-report-api** still serves these on `:5074` until later phases | Phase 2 cutover (portal) |
| Favorites | `PUT /report/favoriteReport?reportId=` toggles `bi_user_favorites` in Postgres; GET reports include `favorite`. Served via `/api/bi/bi-report-api/v1/…` (sidebar stars). **bi-report-api** still serves `:5074` until later phases | Phase 3 cutover (portal) |
| Embed + export | `GET /report/token/{id}/embededd` and `POST /report/token/report/{id}/download` use catalog ACL + Power BI service principal via `/api/bi/…`. Dashboard tiles still use **`POST /api/embed/token`**. Admin stays on `:5074` | Phase 4 cutover (portal) |
| Admin CRUD | Known `AdminController` routes under `/bi-report-api/v1/admin/**` (users, groups, categories, reports, permissions, bulk users) are served by **Next.js** + Postgres when matched; **`display-reports`**, report pages, and semantic-model stay proxied to **bi-report-api**. Auth: Entra JWT + catalog `System Admin` or department admin; system-admin-only routes match .NET filters. Writes call `invalidateCatalogCache` | Phase 5 cutover (portal) |
| Display + page ACL + semantic model | `admin/display-reports` CRUD in Postgres (`bi_display_report`); GET by id for any catalog user; `admin/reports/{id}/pages` in `bi_report_page_acl`; `GET report/{id}/semantic-model` via catalog ACL + `D360_PBI_SemanticModel`. Unknown `/api/bi` paths still proxy to **bi-report-api** | Phase 6 cutover (portal) |
| Proxy decommission | `/api/bi/**` is served only by Next.js intercepts (Phases 1–6). Unmatched paths return **404** `{ message: "Not found" }`; no `fetch` to `BI_API_BASE`. **bi-report-api** on `:5074` remains optional for direct probes, not on the portal path | Phase 7 cutover (portal) |
| Logging | Startup logs environment and DB target (`host:port/db`, SSL mode) — never credentials | Added |
| Error handling | Existing `ExceptionMiddleware` unchanged; readiness check returns a generic message, details only in logs | Done |

## 4. Changes

### API (`bi-report-api-develop/PowerBi`)

| File | Change |
| --- | --- |
| `PowerBI.Api/Program.cs` | Environment variables and command line are added after the JSON files so secrets override config; registers `DatabaseHealthCheck` at `/bi-report-api/v1/health/ready`; logs the masked DB target at startup |
| `PowerBI.Api/Helpers/HealthChecks/DatabaseHealthCheck.cs` | New. `CanConnectAsync` with 5 s timeout; `DescribeTarget` prints host/port/database/SSL mode only |
| `PowerBI.Core/Models/Dto/ReportDetailsDto.cs` | Additive `CategoryPath` (`List<CategoryPathItem>`, null when unsupported) and `CategoryPathItem` |
| `PowerBIPortal.Data/Interfaces/IReportCategoriesRepository.cs`, `Repositories/ReportCategoriesRepository.cs` | `GetActiveCategoryHierarchy` – detects `parent_id` + `display_order` once per connection string, returns null when absent |
| `PowerBIPortal.Data/Helpers/CategoryPathBuilder.cs` | New. Root-first path with missing-parent, cycle and depth (32) guards |
| `PowerBIPortal.Services/Services/ReportService.cs` | `GetAllMyReport` fills `CategoryPath`; entitlement logic untouched |

Not changed: endpoints, response fields that already existed, authentication/authorization, CRUD, EF model, migrations, `appsettings.*.json`, production settings, Dockerfile, task definitions, workflows.

### Portal (`apps/portal`)

| File | Change |
| --- | --- |
| `src/types/index.ts` | Optional `PortalReport.categoryPath`, `CategoryPathItem` |
| `src/lib/catalog/category-hierarchy.ts` | New, presentation-free: `buildCategoryPath`, `hasCategoryHierarchy`, `buildMenuTree`, `ancestorKeysOfReport` |
| `src/lib/catalog/map-reports.ts` | Maps and validates `categoryPath` from the API (invalid → ignored) |
| `src/lib/catalog/fetch-reports.ts` | Merge keeps the API path, falls back to the DB catalog path |
| `src/lib/catalog/reports-catalog.ts` | DB fallback detects the columns and builds the same paths |
| `src/modules/menu-panel/components/Sidebar.tsx` | Recursive `CategoryNode` (indentation via nested lists, expand/collapse, `aria-expanded`, active report highlight, ancestors of the active report auto-expanded). The original flat markup is rendered unchanged when no hierarchy exists |
| `src/lib/server/bi-health.ts` | Phase 1: `ping` / `health` liveness (200 plain text) and `health/ready` (catalog `SELECT 1`, 200 `Healthy` / 503 `Unhealthy`, ~5 s timeout) without calling bi-report-api |
| `src/lib/server/bi-api-proxy.ts` | BI catch-all: Phase 1–6 intercepts only; Phase 7 returns 404 for unknown paths (no .NET proxy) |
| `src/lib/server/bi-catalog-reads.ts` | Phase 2: intercept GET `user/userInfo` and GET `report/reports` (Entra JWT → `loadCatalogForEmail`) |
| `src/lib/catalog/fetch-reports.ts` | Dashboard catalog loaders; Postgres-only (no `BI_API_BASE` for menu/identity) |
| `src/lib/server/bi-favorites.ts` | Phase 3: intercept PUT `report/favoriteReport`; toggle `bi_user_favorites` and return refreshed report list |
| `src/lib/catalog/reports-catalog.ts` | Also loads `favorite` from `bi_user_favorites`; `toggleFavoriteForUser`, `invalidateCatalogCache` |
| `src/lib/server/bi-embed.ts` | Phase 4: GET embededd + POST download (catalog ACL, SP embed/export, `report_access_log` on embed) |
| `src/lib/server/bi-admin.ts`, `bi-admin-auth.ts`, `bi-admin-users.ts`, `bi-admin-groups.ts`, `bi-admin-categories.ts`, `bi-admin-reports.ts`, `bi-admin-common.ts` | Phase 5: AdminController intercept, Entra + admin/dept auth, Postgres CRUD |
| `src/lib/server/bi-admin-schema.ts`, `bi-admin-display.ts`, `bi-admin-pages.ts`, `bi-semantic-model.ts` | Phase 6: display reports, page ACL tables, semantic-model intercept |
| `src/lib/server/bi-api-proxy.ts` | Also intercepts known admin paths after embed/download; Phase 6 semantic-model |
| `src/app/api/bi/[...path]/route.ts` | Delegates to `proxyBiRequest` |

## 5. Menu hierarchy

Schema (staging and QA – **not** in EF migrations, added outside the code base):

```sql
bi_report_categories.parent_id     uuid NULL  REFERENCES bi_report_categories(id) ON DELETE SET NULL
bi_report_categories.display_order integer NOT NULL DEFAULT 0
-- indexes: (parent_id), (parent_id, display_order)
```

The Development database (`sac-qa-db…/synergy_bi_reports`) does not have these columns, which is why they are detected at runtime instead of being mapped in EF (mapping them would break every category query there).

Staging data: 99 categories (62 active), 15 with a parent, depth up to 3 (e.g. QHSE → Audit Tracker & Planners → Vessel), 0 missing parents, 0 cycles, 37 reports attached to categories that also have children, all `display_order = 0` (so siblings sort by name).

Rules:

- Hierarchy comes only from `parent_id`; names are never parsed.
- Inactive (soft-deleted) or missing parent → the child is shown as a root.
- Cycles / conflicting duplicates → the offending link is dropped and the node becomes a root; nothing is hidden.
- Duplicate reports in one category are shown once.
- Siblings sort by `display_order`, then name. Reports keep API order.
- Search and tag filters apply to reports; ancestors with no matching reports disappear.
- If no report sits below a parent (flat data or columns missing), the sidebar renders the previous flat category list exactly as before.
- After adding `parent_id`/`display_order` to another environment, restart the API so the column detection runs again.

## 6. Configuration examples (no real values)

Local API against staging:

```powershell
$env:ASPNETCORE_ENVIRONMENT = "staging"
$env:ConnectionStrings__BIReportDbConnection = "Host=<staging-host>;Port=5432;Database=synergy_bi_reports;Username=<user>;Password=<from secret store>;SSL Mode=Require;Trust Server Certificate=true;Pooling=true"
```

ECS task definition (`task-definitions/staging.json`) – proposed, not applied:

```json
"environment": [{ "name": "ASPNETCORE_ENVIRONMENT", "value": "staging" }],
"secrets": [{ "name": "ConnectionStrings__BIReportDbConnection", "valueFrom": "/staging/<bi_report_db_connection>" }]
```

Dockerfile private feed – proposed replacement for the hard-coded token (requires `--build-arg NUGET_SECRET=${{ secrets.NUGET_SECRET }}` in the workflows):

```dockerfile
RUN dotnet nuget add source https://nuget.pkg.github.com/Synergy-Marine-Group/index.json -n synergy-github \
      -u Synergy-Marine-Group -p "$NUGET_SECRET" --store-password-in-clear-text \
 && dotnet restore "PowerBI.Api/PowerBIPortal.Api.csproj"
```

Local restore needs only the `NUGET_SECRET` user environment variable (already referenced by `nuget.config`).

## 7. Validation

| Check | Result |
| --- | --- |
| Staging DNS, TCP, login, privileges, SSL, schema, migrations | Verified (read-only queries) |
| `dotnet build` (API, isolated output folder) | Passed, 0 errors (existing nullable/obsolete warnings only) |
| New API on port 5075, `ASPNETCORE_ENVIRONMENT=Development` + `ConnectionStrings__…` override | Connected to **staging** (session from this machine, TLS 1.3) – proves the override fix |
| `/bi-report-api/v1/health/ready` | `200 Healthy` |
| `/bi-report-api/v1/health` | Unchanged liveness response |
| `/report/reports` without token | `401` (auth unchanged) |
| Hierarchy unit checks (10 cases: 3 levels, missing parent, cycle, unknown id, flat, empty, duplicates, conflicting parents, ordering, active ancestors) | Passed |
| Portal `tsc --noEmit`, ESLint on changed files | Passed |
| Portal `next build` | Passed |

Not verified: `report/reports` returning `categoryPath` with a real signed-in token against staging, and the nested sidebar in a signed-in browser (the local portal and API on 5074 still use the Development database, which has no hierarchy, so the menu stays flat there by design).
