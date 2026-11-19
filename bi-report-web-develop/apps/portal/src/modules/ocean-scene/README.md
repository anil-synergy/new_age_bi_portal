# Ocean Scene module (midnight-sea homepage)

## Purpose
The cinematic night-sea environment behind the homepage: moonlit sky, layered waves, a distant lighthouse whose rotating beam sweeps the sea and lights the existing 3D ship. The ship is still the original `HomeShip` (same GLB, materials, renderer and cursor-follow). This module only decorates its scene.

## Structure
```
ocean-scene/
├─ components/OceanScene.tsx        <HomeShip environment={createOceanEnvironment} />
└─ logic/
   ├─ createOceanEnvironment.ts     Composition root: builds every part, fits the sea to the hull, drives the frame loop
   ├─ constants.ts                  Tunables, shared BeamState, responsive layout, disposeObject
   ├─ shaders.ts                    Shared GLSL: noise, sky gradient, tone-map/sRGB/dither tail
   ├─ NightSky.ts                   Sky dome shader: moon + halo, stars + twinkle, drifting clouds
   ├─ OceanWaves.ts                 Sea shader: 4 displaced swells + 2 ripples, moon road, crest glow, beam glint, foam
   ├─ Lighthouse.ts                 Procedural tower (or optional GLB), headland, distant coast, rotating beam rig
   ├─ AtmosphericEffects.ts         Volumetric beam shafts, lamp bloom, horizon mist
   └─ ShipLighting.ts               Beam <-> ship coupling: SpotLight, moonlit fill, bobbing, night re-tune of HomeShip lights
```
Hook contract: `src/modules/3d-model/types.ts` (`ShipSceneEnvironment`). `HomeShip` accepts an optional `environment` factory. Without it the ship renders exactly as before.

## How the signature effect works
One `BeamState` (constants.ts) is owned by `Lighthouse` and read by everything else, so the visuals cannot drift apart:
1. `Lighthouse.update` advances the beam heading `yaw` through a full 2π every `BEAM_PERIOD_S` (22 s) and computes `shipAlign` (0..1, eased smoothstep) from the angular distance between the beam and the lamp-to-ship heading.
2. `AtmosphericEffects` draws the shaft along `yaw/pitch`, plus a dimmer counter-beam and a lamp bloom that grows when the beam points toward the camera.
3. `OceanWaves` brightens and glints the water inside the beam's angular wedge.
4. `ShipLighting` moves a real `THREE.SpotLight` to the lamp aimed along the beam, so hull, deck and superstructure are lit by actual lighting as the cone crosses them. The moonlit fill (HomeShip's former "sun") and hemisphere light are lifted by `shipAlign`, then ease back to the night level. Foam around the hull also brightens.
The first pass over the ship happens `FIRST_PASS_S` (5 s) after start. Each following pass is one period later.

## Scene scale and layout
- Camera position is HomeShip's own; only `fov` (33), `far` and `lookAt` change so the horizon, moon and lighthouse fit above the ship.
- The sea surface is fitted to the ship's world bounds (`HULL_SUBMERGED` = 20 % of hull height) once the GLB loads and on every resize.
- The lighthouse X and the moon azimuth are derived from the camera frustum (`computeLayout`) so both stay in frame from phones to ultrawide.
- Lighthouse model: **`src/assets/lighthouse_home.glb` is not used by default.** Inspection shows it holds a single mesh made of two small disconnected fixtures (a square plate on a cylinder and a round dish on a cylinder, about 1.9 units apart along Z) and no tower, gallery or lantern room, so it renders as a floating black cube. `Lighthouse.ts` therefore builds a procedural tower (plinth, banded tapered shaft, gallery and rail, glazed lantern with a glowing lamp, roof). To use a complete GLB later, set `LIGHTHOUSE_MODEL = "glb"` in `constants.ts`: the loader stands the Z-up model upright, scales it to `LIGHTHOUSE_HEIGHT` and takes the lamp from the centroid of the top-fifth vertices (flip `MODEL_UPSIDE_DOWN` in `Lighthouse.ts` if it renders inverted).

## Performance and accessibility
- Sky, sea and mist are single procedural shader meshes. No particle systems and no textures except the 128 px lamp glow. The sky is drawn last so the GPU skips pixels already covered by sea or ship.
- Pixel ratio is capped at 1.5 (the plain ship uses 2). If frame time stays above ~29 fps-equivalent for ~90 frames the renderer drops once to ratio 1.
- Rendering stops while the tab is hidden and resumes without a time jump (`visibilitychange` in HomeShip).
- `prefers-reduced-motion`: the beam stops rotating and rests just off the ship so it is lit; waves, clouds and mist run at 12 % speed; stars do not twinkle; the ship bobs at 12 % speed.
- The canvas, vignette and welcome panel never take pointer events, so clicks, scrolling and keyboard navigation reach the UI and the stage still receives pointer-move for cursor-follow.

## Dependencies
`three` (core, `GLTFLoader` for the optional GLB path), `@/modules/3d-model` (HomeShip + hook types), `@/assets/lighthouse_home.glb` (imported through the existing webpack `asset/resource` rule, typed by `src/types/glb.d.ts`; only fetched when `LIGHTHOUSE_MODEL` is `"glb"`). No new npm packages. No portal state or API.

## Safe modification
- Mount only through `next/dynamic` with `ssr: false` (already done in `HomePage.tsx`).
- Every geometry, material and texture created here is released in `dispose()`; keep that in sync when adding parts.
- Keep one render loop: add per-frame work inside `createOceanEnvironment().update`, never a second `requestAnimationFrame`.
- Tune look in `constants.ts` (beam period/angles, camera framing, palette) and the colour constants at the top of each shader.
- UI styling that belongs to this theme is scoped to `.night-home` / `.glass-panel` / `.night-backdrop` / `.night-vignette` / `.ocean-rise` in `src/app/globals.css`.
