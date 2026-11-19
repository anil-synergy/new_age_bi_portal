# 3D Model module

## Purpose
Renders the Ivory Voyager ship on the homepage with three.js and makes it turn gently toward the cursor.

## Structure
```
3d-model/
└─ components/HomeShip.tsx   Self-contained WebGL canvas component
```
Asset: `src/assets/Meshy_AI_Ivory_Voyager_1019163912_texture.glb`. It is kept in the shared assets folder and loaded through the webpack `asset/resource` rule for `.glb` in `next.config.mjs`. The type declaration is in `src/types/glb.d.ts`.

## Functionality
- `WebGLRenderer` (antialias, alpha) with pixel ratio capped at 2, sRGB output, ACES filmic tone mapping (exposure 1.05).
- Lighting: `RoomEnvironment` through PMREM (environment map), a hemisphere light, a warm key "sun" and a cool rim light.
- Camera: perspective 30°, positioned at (1.15, 1.55, 6.6) and looking at (0.1, -0.2, 0).
- The model is centred, scaled so its longest side is 4.4 units, and rotated 0.75π. Mesh `envMapIntensity` is 0.75 and texture anisotropy is set to the maximum.
- Responsive fit: on screens narrower than 720 px the pivot scale is 0.72; otherwise it is clamped between 0.82 and 1 based on aspect ratio. A `ResizeObserver` on the parent stage drives this.
- Fade-in: the canvas starts at `opacity-0` and gets `.is-ready` once the GLB loads (1 s transition).
- Cursor follow: see `../cursor-follow/README.md`. It lives inside this component's render loop.
- Cleanup on unmount: cancels the RAF, disconnects the observer, removes listeners, and disposes geometries, materials, the environment, PMREM and the renderer.

## Environment hook (added for the night-sea scene)
`HomeShip` takes an optional `environment` prop (`types.ts`: `ShipSceneEnvironmentFactory`). When given, the factory receives the scene, camera, renderer and the three lights, and returns `{ onShipReady, onResize, update, dispose }`, which HomeShip calls from its single render loop. With the prop absent, behaviour is unchanged. When present HomeShip also: caps pixel ratio at 1.5 (instead of 2), drops to 1 if frames stay slow, and stops/resumes rendering on `visibilitychange`. The ship model, materials, damping spring and cursor-follow code are untouched. See `../ocean-scene/README.md`.

## Dependencies
`three` (core, `GLTFLoader`, `RoomEnvironment`), `assets`. No portal state or API.

## Data flow
None. Pure presentation; the parent decides whether to mount it.

## Safe modification
- This file was moved byte-for-byte during the modularization. Treat it as frozen unless the visual is meant to change.
- The canvas must be absolutely positioned inside a sized parent. The component measures `canvas.parentElement` and listens for pointer events on it.
- Always mount it with `next/dynamic` and `ssr: false`.
- If you change the model, keep the disposal block in sync, or GPU memory leaks on every navigation back to Home.
