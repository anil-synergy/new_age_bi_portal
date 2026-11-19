# Menu Panel module

## Purpose
The left slide-in report menu. It lists the user's entitled reports grouped by category, with text search and environment/category tag filters.

## Structure
```
menu-panel/
├─ components/Sidebar.tsx   The animated panel (brand, home link, search, tags, category tree)
└─ logic/nav-chrome.tsx     NavChromeProvider + useNavChrome (open, search, activeTags, availableTags) and the WaveMark icon
```

## Functionality and business logic
- `NavChromeProvider` (mounted by `layout/AppShell`) owns the menu state, so the Header's menu button and the Sidebar share it.
- No tag is selected until the user picks one. A saved choice in `localStorage` (`portal.nav.activeTags`) is restored, and tags that are no longer in the catalog are dropped. `availableTags` = `ENV_TAGS` + the sorted distinct `categoryName`s from the catalog.
- Filtering: the title or name must contain the search text, and if any tags are active, at least one of `reportTags(report)` must match.
- Categories collapse by default and auto-expand while searching. Reports without a category go under "Reports".
- The active report link is highlighted (`bg-[#454a85]`).
- Empty state: shows `reportsError` or a sign-in/no-reports message, plus a Sign in link when signed out.

## UI/UX
- Width animates 0 → 280 px and the panel slides up from `y: 105%` with the "liquid" easing `[0.22, 1, 0.36, 1]` over 0.72 s.
- The brand mark uses `layoutId="portal-brand"` for a shared-layout morph with the Header (inside AppShell's `LayoutGroup`).
- The colour scheme is fixed navy `#333869`; tag chips are emerald (active) and slate (available).

## Dependencies
`context/PortalContext` (reports, isLoading, reportsError), `shared/providers/AuthProvider`, `lib/catalog/report-tags`, `lib/config`, `lib/utils`, `framer-motion`, `lucide-react`, `assets/synergy-logo.png`.

## Data flow
Catalog reload (login or `portal:admin-changed`) → `PortalContext.reports` → `availableTags` and the filtered list re-derive automatically.

## Safe modification
- `useNavChrome()` throws outside the provider. Any new consumer must render under `AppShell`.
- Keep `layoutId="portal-brand"` consistent with the Header, or the logo morph breaks.
- `WaveMark` is used by the Header. It lives here only because it was co-located with the nav state originally; moving it is safe if you update the Header import.
