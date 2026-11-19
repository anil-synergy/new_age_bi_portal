# Loaders module (Other UI)

## Purpose
All loading visuals: the BI loader, the liquid page transition, the staged embed loading animation, and the QHSE canvas loader.

## Structure
```
loaders/
├─ components/
│  ├─ BILoader.tsx           Inline/overlay loader (scene "portal" | "qhse")
│  ├─ BITransition.tsx       Route-change liquid transition wrapper used by AppShell
│  ├─ AILoadingAnimation.tsx Staged loader (fetching-token → embedding → rendering) + LoadingStage type
│  └─ QhseReportLoader.tsx   Canvas loader for QHSE reports
├─ logic/qhse-report-animation.ts  Canvas animation driver (startQhseReportAnimation)
└─ styles/bi-transition.css        Global CSS for the transition and loader scenes (imported once in app/layout.tsx)
```

## Functionality
- `BITransition` re-keys on `pathname` and holds a covering state while `loading` is true (catalog loading with no reports yet).
- `AILoadingAnimation` maps `LoadingStage` to copy and progress for Power BI embeds.
- The QHSE loader runs a canvas animation and stops it on unmount through the returned disposer.

## UI/UX
`bi-transition.css` is adapted from the reference project in `src/assets/bi-transition-react`, which is kept for reference and not imported. It respects `prefers-reduced-motion`.

## Dependencies
`lib/utils` only. Consumed by `layout`, `shared` (ProtectedRoute), `reports`, `tile-engine`, and several routes (login, auth callback, redirecting, display).

## Safe modification
- `bi-transition.css` is global. Keep the single import in `app/layout.tsx`; importing it from components would duplicate the CSS.
- `LoadingStage` is a public type used by the tile engine. Extend it rather than renaming values.
