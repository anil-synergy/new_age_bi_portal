# Cursor Follow module (documentation only)

## Purpose
Describes the cursor-follow behaviour of the homepage ship: the ship yaws and pitches slightly toward the pointer with a smooth, non-overshooting ease.

## Where the code lives
`src/modules/3d-model/components/HomeShip.tsx`, inside the single `useEffect`:

| Piece | What it does |
| --- | --- |
| `target`, `look`, `velocity` objects | Desired pointer direction, current eased direction, and spring velocity per axis |
| `onPointer` | Maps the pointer position over the stage to `[-1, 1]` on x and y (y inverted), clamped |
| `onLeave` | Resets the target to centre when the pointer leaves the stage |
| `damp(current, goal, axis, dt)` | Critically damped spring (Unity-style `SmoothDamp`) with `smoothTime` 0.55 s, or 0.12 s when `prefers-reduced-motion` is set |
| `render` loop | Clamps `dt` to 1/30 s, damps `look` toward `target`, then sets `pivot.rotation = (-look.y * 0.07, look.x * 0.32, 0)` |
| Listeners | `pointermove` and `pointerleave` on the canvas's parent stage, removed on unmount |

## Why it was not extracted into its own folder
The spring state, the three.js `pivot`, the clock and the RAF loop share one closure. Pulling the logic into a hook or utility would mean restructuring the render loop, which the modularization brief forbids ("keep the 3D model rendering and cursor-follow behavior exactly as they are"; "if separating risks breaking functionality, leave it unchanged and document why"). It is therefore documented here and left untouched.

## Dependencies
Inherits `3d-model`'s dependencies (three.js). There is no shared state.

## Safe modification
- Turn strength: change the `0.07` (pitch) and `0.32` (yaw) multipliers.
- Feel: change `smoothTime`. Keep the reduced-motion branch for accessibility.
- Keep the `dt` clamp, or a background tab returning to focus makes the ship snap.
- Any overlay above the ship must be `pointer-events-none`, or pointer events never reach the stage.
- If you do extract this logic later, keep one RAF loop. Do not add a second `requestAnimationFrame` just for the spring.
