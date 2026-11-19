# Homepage module

## Purpose
The signed-in landing screen at `/dashboard`: the cinematic midnight-sea scene (`ocean-scene`: sky, waves, lighthouse and the 3D ship), or pinned SMART visuals when they exist, plus the welcome/catalog summary in a glass panel.

## Structure
```
homepage/
├─ components/HomePage.tsx   Page body (default export DashboardHomePage)
└─ logic/pinned-visuals.ts   PinnedHomeVisual type + pinnedHomeVisuals list (empty for now)
```
Route: `src/app/dashboard/page.tsx` is a one-line re-export of `HomePage`. The route file must stay in `app/` for the App Router.

## Functionality and business logic
- Shows `HomeShip` only when `pinnedHomeVisuals` is empty. Once SMART pinning exists, the pinned visual cards replace the ship.
- Welcome line uses the first name from `userInfo.name`, falling back to the email local-part, then a generic greeting.
- Subtitle shows "Loading your report catalog…" while `isLoading`, otherwise the report count.

## UI/UX
- The root carries `night-home`, which re-themes the header glass for a dark scene (CSS variables in `globals.css`, scoped, nothing global changes).
- Background: `night-backdrop` gradient (visible while WebGL loads and behind the pinned board). `Homepage_BG.jpg` is no longer used here.
- `OceanScene` is loaded with `next/dynamic` and `ssr: false` (WebGL is browser-only).
- A `night-vignette` overlay (z-10, no pointer events) frames the scene.
- Welcome copy sits bottom-left in a `glass-panel` with an `ocean-rise` entrance, `pointer-events-none` so it never blocks cursor follow.
- Layer order: canvas, vignette (10), welcome panel (20), header (30), Visual box button (30) and window (40).

## Dependencies
`layout` (Header), `ocean-scene` (OceanScene), `visual-box`, `context/PortalContext`.

## Data flow
`PortalContext` → `{ userInfo, reports, isLoading }` → render. No API calls of its own.

## Safe modification
- Keep the `dynamic(..., { ssr: false })` import of OceanScene; server-rendering three.js breaks the build.
- Keep the welcome block `pointer-events-none`, or the ship stops following the cursor over that area.
- To add pinned visuals, populate `pinnedHomeVisuals` (or replace it with a hook) without changing the `showShip` rule.
