import type { ShipSceneContext, ShipSceneEnvironment } from "@/modules/3d-model/types";
import type { BeamState } from "./constants";
import { AtmosphericEffects } from "./AtmosphericEffects";
import { CAMERA_FAR, CAMERA_FOV, CAMERA_LOOK_AT, computeLayout, createBeamState } from "./constants";
import { Lighthouse } from "./Lighthouse";
import { NightSky } from "./NightSky";
import { OceanWaves } from "./OceanWaves";
import { ShipLighting } from "./ShipLighting";

/** Fraction of the hull height that sits below the waterline. */
const HULL_SUBMERGED = 0.2;
/** Slow-motion factor for ambient motion when the user prefers reduced motion. */
const REDUCED_TIME_SCALE = 0.12;
const DAY_BLEND_SPEED = 1.67;

/**
 * OceanScene composition root: builds the night sky, sea, lighthouse, atmosphere and ship
 * lighting, and plugs them into HomeShip's scene through the ShipSceneEnvironment hook.
 */
export function createOceanEnvironment({ scene, camera, renderer, lights, reducedMotion }: ShipSceneContext): ShipSceneEnvironment {
  // Re-frame the camera so the horizon, moon and lighthouse fit above the ship (position is unchanged).
  camera.fov = CAMERA_FOV;
  camera.far = CAMERA_FAR;
  camera.lookAt(CAMERA_LOOK_AT);
  camera.updateProjectionMatrix();

  const beam = createBeamState();
  const sky = new NightSky(reducedMotion);
  const waves = new OceanWaves();
  const lighthouse = new Lighthouse(beam, reducedMotion, renderer);
  const atmosphere = new AtmosphericEffects(reducedMotion);
  const shipLighting = new ShipLighting(scene, lights, beam, reducedMotion);
  scene.add(sky.mesh, waves.mesh, lighthouse.group, atmosphere.group);

  let elapsed = 0;
  let aspect = 16 / 9;
  let lighthouseX = computeLayout(camera, aspect).lighthouseX;
  let dayTarget = 0;
  let dayBlend = 0;

  const beamForFrame = (): BeamState => {
    if (dayBlend < 0.92) return beam;
    return { ...beam, intro: 0, shipAlign: 0 };
  };

  /** Fit the sea surface, foam footprint and beam target to the ship's current bounds. */
  const fitToShip = () => {
    const bounds = shipLighting.measure();
    if (!bounds) return;
    const { box, size, center } = bounds;
    const level = box.min.y + size.y * HULL_SUBMERGED;
    waves.setLevel(level);
    waves.setShipFootprint(center.x, center.z, size.x * 0.36, size.z * 0.36);
    atmosphere.setWaterLevel(level);
    lighthouse.place(lighthouseX, level);
    lighthouse.setShipCenter(center);
  };

  return {
    onShipReady(holder) {
      shipLighting.onShipReady(holder);
      fitToShip();
    },
    onResize(width, height) {
      aspect = width / Math.max(1, height);
      const layout = computeLayout(camera, aspect);
      lighthouseX = layout.lighthouseX;
      sky.setMoonDirection(layout.moonDir);
      waves.setMoonDirection(layout.moonDir);
      lighthouse.place(lighthouseX);
      fitToShip();
    },
    setDayMode(day) {
      dayTarget = day ? 1 : 0;
    },
    update(dt) {
      dayBlend += (dayTarget - dayBlend) * Math.min(1, dt * DAY_BLEND_SPEED);
      sky.setDayBlend(dayBlend);
      waves.setDayBlend(dayBlend);
      shipLighting.setDayBlend(dayBlend);
      lighthouse.setDayMode(dayBlend > 0.92);

      elapsed += dt * (reducedMotion ? REDUCED_TIME_SCALE : 1);
      lighthouse.update(dt);
      sky.update(elapsed, camera.position);
      const activeBeam = beamForFrame();
      waves.update(elapsed, activeBeam);
      atmosphere.update(elapsed, activeBeam, camera);
      shipLighting.update(dt);
    },
    dispose() {
      scene.remove(sky.mesh, waves.mesh, lighthouse.group, atmosphere.group);
      shipLighting.dispose();
      sky.dispose();
      waves.dispose();
      lighthouse.dispose();
      atmosphere.dispose();
    },
  };
}
