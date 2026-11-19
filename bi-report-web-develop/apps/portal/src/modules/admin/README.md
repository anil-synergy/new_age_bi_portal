# Admin module (Other UI)

## Purpose
Building blocks for the admin screens: Department/Category, Users, Groups, Reports and Display Reports.

## Structure
```
admin/
└─ components/
   ├─ AdminChrome.tsx            AdminScreen frame, AdminToolbar, AdminPager, RowMenu (portaled), TagPicker, Flag, readPage, apiError, notifyAdminChanged
   ├─ CategoryAdmin.tsx          Department/Category CRUD (used by /admin/departments and /admin/categories)
   ├─ BulkUserImport.tsx         Excel/CSV user import (xlsx)
   ├─ ReportPagePermissions.tsx  Per-page ACL editor for a report
   └─ DisplayReportBuilder.tsx   Display report (tile layout) editor
```
Routes in `src/app/admin/*` hold the Users, Groups and Reports screens and compose these components.

## Business logic (unchanged)
- New records send `00000000-0000-0000-0000-000000000000` or a client UUID, never `""`, for Guid fields; the API returns 400 on empty strings.
- Report save: create/update → unmap removed groups/users by `mappingId` → map current groups/users with the selected RLS roles.
- After any CRUD, `notifyAdminChanged()` dispatches `portal:admin-changed`, and `PortalContext` reloads the catalog so the menu and filters stay in sync.

## UI/UX
- `AdminScreen` is a full-height, non-scrolling frame. Tables scroll inside it with a sticky header.
- `TagPicker` gives searchable chips with Add and an X to remove, in single- or multi-select mode.
- The section nav lives in `layout/Header`.

## Dependencies
`layout` (Header), `tile-engine` (DisplayReportViewer, VisualPicker, loaded with `next/dynamic`), `shared/components/ui`, `services/biServices`, `services/pbiEmbedService`, `types`.

## Safe modification
- Always call `notifyAdminChanged()` after a successful mutation.
- Keep `RowMenu` portaled to `document.body`; table overflow clips it otherwise.
