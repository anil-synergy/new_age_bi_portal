import * as THREE from "three";

/** Seconds for the lighthouse beam to complete one full 360-degree rotation. */
export const BEAM_PERIOD_S = 22;
/** Half-angle (rad) of the visible beam shaft. */
export const BEAM_VISIBLE_HALF_ANGLE = 0.15;
/** Half-angle (rad) of the SpotLight that lights the ship; wider than the shaft to mimic scattered spill. */
export const BEAM_LIGHT_HALF_ANGLE = 0.24;

/** Camera framing used when the night scene is active (position is HomeShip's own). */
export const CAMERA_FOV = 33;
export const CAMERA_FAR = 500;
export const CAMERA_LOOK_AT = new THREE.Vector3(0.1, 0.5, 0);

/** World placement. The ship sits at the origin; the sea surface is re-fitted to its hull. */
export const DEFAULT_WATER_LEVEL = -0.55;
/**
 * "procedural": built-in tower (default). "glb": load src/assets/lighthouse_home.glb instead.
 * The supplied GLB currently contains only two small disconnected fixtures (a square plate and a
 * round dish) and no tower, so it is not used by default. Switch once a complete export exists.
 */
export const LIGHTHOUSE_MODEL: "procedural" | "glb" = "procedural";
export const LIGHTHOUSE_Z = -16;
export const LIGHTHOUSE_HEIGHT = 2.7;
export const HEADLAND_RADIUS = 4.4;
export const SHORELINE_Z = -125;

/** Linear-space colours shared by the sky and the sea so the horizon blends seamlessly. */
export const HORIZON_GLSL = "vec3(0.0125, 0.034, 0.058)";
export const MID_GLSL = "vec3(0.0045, 0.013, 0.034)";
export const ZENITH_GLSL = "vec3(0.0016, 0.0045, 0.015)";

/** State shared by every environment part. Lighthouse owns it; the others read it. */
export interface BeamState {
  /** World position of the lamp. */
  lamp: THREE.Vector3;
  /** Horizontal heading of the main beam, radians, direction = (cos yaw, 0, sin yaw). */
  yaw: number;
  /** Downward tilt of the beams so they skim the sea at the ship. */
  pitch: number;
  /** Unit 3D direction of the main beam. */
  direction: THREE.Vector3;
  /** Heading from the lamp to the ship. */
  yawToShip: number;
  /** 0..1 eased: how squarely the main beam is on the ship right now. */
  shipAlign: number;
  /** 0..1 fade-in once the lighthouse has loaded. */
  intro: number;
  /** Ship centre in world space. */
  shipCenter: THREE.Vector3;
}

export function createBeamState(): BeamState {
  return {
    lamp: new THREE.Vector3(9.5, 2.1, LIGHTHOUSE_Z),
    yaw: 0,
    pitch: -0.05,
    direction: new THREE.Vector3(1, 0, 0),
    yawToShip: 0,
    shipAlign: 0,
    intro: 0,
    shipCenter: new THREE.Vector3(0, 0, 0),
  };
}

export interface WorldLayout {
  lighthouseX: number;
  moonDir: THREE.Vector3;
}

/** Keeps the lighthouse and moon inside the frame on any aspect ratio. */
export function computeLayout(camera: THREE.PerspectiveCamera, aspect: number): WorldLayout {
  const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  // The camera looks slightly left of -Z; angles below are measured from that view axis.
  const viewYaw = Math.atan2(CAMERA_LOOK_AT.x - camera.position.x, camera.position.z - CAMERA_LOOK_AT.z);
  const depth = camera.position.z - LIGHTHOUSE_Z;
  const lighthouseX = camera.position.x + depth * Math.tan(viewYaw + halfH * 0.6);
  const azimuth = viewYaw - halfH * 0.55;
  const elevation = 0.075;
  const moonDir = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
  ).normalize();
  return { lighthouseX, moonDir };
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of list) {
      for (const value of Object.values(item)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      item.dispose();
    }
  });
}

