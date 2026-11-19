# Layout module (Other UI)

## Purpose
The signed-in application shell: page frame, the floating glass header, the account menu and the glass tray. It is the composition root that wires the menu panel, SMART chatbot and page transition together.

## Structure
```
layout/
└─ components/
   ├─ AppShell.tsx     Frame: Sidebar | main (BITransition) | SMART aside. Provides NavChrome + SmartPanel contexts and LayoutGroup.
   ├─ Header.tsx       Glass top bar: menu toggle, title, admin section nav, report search, refresh, snapshot export, notifications, theme, SMART, account.
   ├─ AccountMenu.tsx  Avatar dropdown: admin links (Users, Reports, Groups, Categories, Departments, Display Reports) gated by canConfigurePortal, and sign out.
   ├─ GlassTray.tsx    Liquid-glass pill tray with animated active indicator.
   └─ MinimalShell.tsx Simple titled wrapper. Currently unused; kept for compatibility.
```

## Functionality and business logic
- AppShell derives `contextId` from `/dashboard/:id` or `/display/:id` and loads the semantic model only while SMART is open.
- Header behaviour by route:
  - Admin pages: the report search is replaced by `AdminSectionNav` (Department/Category, Users, Groups, Reports), with the active item `bg-[#1d4e89] text-white` in both themes.
  - Non-admin routes: center is always `HeaderReportSearch` + in-field SMART while the SMART chat panel is closed (menu open or collapsed).
  - Hidden only when the SMART side panel is open, or on admin pages (section nav in center).
  - Tray SMART is hidden while search-in-bar is visible; no duplicate launcher.
- Refresh button dispatches `REPORT_REFRESH_EVENT` and waits for `REPORT_REFRESH_DONE_EVENT` (`lib/report-events`).
- Snapshot export opens `SnapshotDialog` from `../../../../snapshot_export`.

## UI/UX
- Glass styling comes from `app/globals.css` (`.glass-bar`, `.glass-backplate`, `.glass-icon` and their `--compact` variants).
- Brand mark morphs with the Sidebar through `layoutId="portal-brand"` inside AppShell's `LayoutGroup`.
- Light and dark themes come from `shared/providers/ThemeProvider`.

## Dependencies
`menu-panel` (Sidebar, NavChromeProvider, useNavChrome, WaveMark), `smart-chatbot` (AIChatPanel, SmartPanelContext/useSmartPanel), `loaders` (BITransition), `shared` (Auth/Theme providers), `context/PortalContext`, `lib`, `assets`, `snapshot_export`.

## Data flow
Routes render `<AppShell>` from their `layout.tsx`. Pages render `<Header title>` themselves. All data comes from `PortalContext`; the layout makes no API calls except through the context.

## Safe modification
- Header is used by the homepage, report, display and admin pages. Keep the `{ title?: string }` prop contract.
- Do not import `layout` from `menu-panel` or `smart-chatbot`; that would create a cycle.
- If you move this folder, update the `snapshot_export` relative paths in `Header.tsx`.
