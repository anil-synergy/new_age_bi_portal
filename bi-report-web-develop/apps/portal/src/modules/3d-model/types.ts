import type * as THREE from "three";

/** Lights HomeShip creates; an environment may re-tune them (e.g. for a night scene). */
export interface ShipSceneLights {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
}

export interface ShipSceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  lights: ShipSceneLights;
  reducedMotion: boolean;
}

/**
 * Optional hook that lets another module decorate the ship's scene (sky, sea, lighthouse...)
 * while HomeShip keeps owning the renderer, the ship model and the cursor-follow loop.
 */
export interface ShipSceneEnvironment {
  /** Called once the ship GLB is loaded, scaled and added to the pivot. */
  onShipReady(holder: THREE.Group): void;
  /** Called after every HomeShip layout pass with the stage size in CSS pixels. */
  onResize(width: number, height: number): void;
  /** Called every rendered frame with a clamped delta time in seconds. */
  update(dt: number): void;
  /** Toggles day vs night ocean styling without remounting the ship. */
  setDayMode?(day: boolean): void;
  dispose(): void;
}

export type ShipSceneEnvironmentFactory = (context: ShipSceneContext) => ShipSceneEnvironment;
