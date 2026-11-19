import * as THREE from "three";
import type { ShipSceneLights } from "@/modules/3d-model/types";
import { BEAM_LIGHT_HALF_ANGLE, type BeamState } from "./constants";

/** Night-time base levels for the lights HomeShip creates. */
const BASE = { hemi: 0.26, fill: 0.12, rim: 0.95 };
/** How much the moonlit fill and the spot add at full beam alignment. */
const BOOST = { fill: 2.5, spot: 14, hemi: 0.4 };

/**
 * Couples the lighthouse beam to the real ship: a SpotLight rides the beam, the moonlit
 * fill swells as the beam crosses the hull, and the ship bobs gently on the swells.
 */
export class ShipLighting {
  readonly spot: THREE.SpotLight;
  private holder: THREE.Group | null = null;
  private readonly box = new THREE.Box3();
  private readonly size = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private baseY = 0;
  private bobClock = 0;
  private dayBlend = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lights: ShipSceneLights,
    private readonly beam: BeamState,
    private readonly reducedMotion: boolean,
  ) {
    // decay 0 keeps the beam's strength constant over the long lamp-to-ship distance.
    this.spot = new THREE.SpotLight(0xe4f2ff, 0, 0, BEAM_LIGHT_HALF_ANGLE, 1, 0);
    scene.add(this.spot, this.spot.target);

    const { hemi, sun, rim } = lights;
    hemi.color.set(0x5f82b5);
    hemi.groundColor.set(0x08121f);
    hemi.intensity = BASE.hemi;
    // The "sun" becomes a cool moonlit fill from the camera side; the beam boosts it.
    sun.color.set(0xa9c6ee);
    sun.position.set(-3.4, 4.2, 5.5);
    sun.intensity = BASE.fill;
    // The rim light becomes moonlight skimming the hull from behind.
    rim.color.set(0xa7c9f5);
    rim.position.set(-4, 3, -7);
    rim.intensity = BASE.rim;
  }

  onShipReady(holder: THREE.Group) {
    this.holder = holder;
    this.baseY = holder.position.y;
    holder.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const shaded = material as THREE.MeshStandardMaterial;
        // The studio environment map is far too bright for night; keep just enough for readable reflections.
        if ("envMapIntensity" in shaded) shaded.envMapIntensity = 0.09;
      }
    });
    this.measure();
  }

  /** World-space bounds of the ship at rest. Returns null before the model has loaded. */
  setDayBlend(blend: number) {
    this.dayBlend = THREE.MathUtils.clamp(blend, 0, 1);
  }

  measure() {
    if (!this.holder) return null;
    this.holder.parent?.updateMatrixWorld(true);
    this.box.setFromObject(this.holder);
    this.box.getSize(this.size);
    this.box.getCenter(this.center);
    return { box: this.box, size: this.size, center: this.center };
  }

  update(dt: number) {
    const beam = this.beam;
    const night = 1 - this.dayBlend;
    this.spot.position.copy(beam.lamp);
    this.spot.target.position.copy(beam.lamp).addScaledVector(beam.direction, 40);
    this.spot.intensity = BOOST.spot * beam.intro * night;
    const moonFill = BASE.fill + BOOST.fill * beam.shipAlign;
    const dayFill = 2.6;
    this.lights.sun.intensity = THREE.MathUtils.lerp(moonFill, dayFill, this.dayBlend);
    this.lights.sun.color.setRGB(
      THREE.MathUtils.lerp(0.66, 1.0, this.dayBlend),
      THREE.MathUtils.lerp(0.78, 0.94, this.dayBlend),
      THREE.MathUtils.lerp(0.93, 0.82, this.dayBlend),
    );
    this.lights.hemi.intensity = THREE.MathUtils.lerp(BASE.hemi + BOOST.hemi * beam.shipAlign, 0.55, this.dayBlend);
    this.lights.hemi.color.setRGB(
      THREE.MathUtils.lerp(0.37, 0.75, this.dayBlend),
      THREE.MathUtils.lerp(0.51, 0.85, this.dayBlend),
      THREE.MathUtils.lerp(0.71, 0.95, this.dayBlend),
    );
    this.lights.rim.intensity = THREE.MathUtils.lerp(BASE.rim, 0.7, this.dayBlend);

    if (this.holder) {
      this.bobClock += dt * (this.reducedMotion ? 0.12 : 1);
      const t = this.bobClock;
      this.holder.position.y = this.baseY + Math.sin(t * 0.8) * 0.028 + Math.sin(t * 1.37 + 1.3) * 0.012;
      this.holder.rotation.x = Math.sin(t * 0.62 + 0.4) * 0.011;
      this.holder.rotation.z = Math.sin(t * 0.91 + 2.1) * 0.014;
    }
  }

  dispose() {
    this.scene.remove(this.spot, this.spot.target);
    this.spot.dispose();
  }
}
