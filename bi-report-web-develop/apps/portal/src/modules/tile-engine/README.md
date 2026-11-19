# Tile Engine module (Other UI)

## Purpose
Embeds Power BI content and composes it into tiles: full reports, single visuals, external URLs, and multi-tile "display reports".

## Structure
```
tile-engine/
├─ index.ts                       Barrel (re-exports all components)
└─ components/
   ├─ PowerBIReportTile.tsx       Full report embed: token fetch, page ACL filtering, RLS, refresh events, snapshot target registration
   ├─ PowerBIVisualTile.tsx       Single-visual embed
   ├─ UrlEmbedTile.tsx            iframe tile for external URLs
   ├─ Tile.tsx                    Chooses a tile type from TileConfig
   ├─ TileCanvas.tsx              react-rnd grid canvas
   ├─ TileToolbar.tsx             Tile header actions
   ├─ DisplayReportViewer.tsx     Renders a DisplayReport (tile layout)
   └─ VisualPicker.tsx            Lets admins pick visuals from a report
```

## Functionality and business logic
- Tokens come from `services/pbiEmbedService.fetchEmbedToken` → `/api/embed/token` (server, Azure Function). The browser never sees client secrets.
- `PowerBIReportTile` listens for `REPORT_REFRESH_EVENT`, emits `REPORT_REFRESH_DONE_EVENT`, and registers the embedded report with `snapshot_export/target` for the Header's export.
- Pages hidden by the page ACL are removed from navigation.

## Dependencies
`loaders`, `shared/components/ui`, `services/pbiEmbedService`, `lib` (utils, report-events), `types`, `powerbi-client`, `powerbi-client-react`, `react-rnd`, and `../../../../snapshot_export/target`.

## Safe modification
- Heavy components are loaded with `next/dynamic` by callers. Keep that pattern to protect first-load JS size.
- Update the `snapshot_export` relative path if this folder moves.
