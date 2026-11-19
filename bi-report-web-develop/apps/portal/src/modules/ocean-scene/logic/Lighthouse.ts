import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// Served from public/ so no bundler loader is needed (Turbopack ignores webpack rules).
const lighthouseUrl = "/models/lighthouse_home.glb";
import {
  BEAM_LIGHT_HALF_ANGLE,
  BEAM_PERIOD_S,
  DEFAULT_WATER_LEVEL,
  HEADLAND_RADIUS,
  HORIZON_GLSL,
  LIGHTHOUSE_HEIGHT,
  LIGHTHOUSE_MODEL,
  LIGHTHOUSE_Z,
  SHORELINE_Z,
  disposeObject,
  type BeamState,
} from "./constants";
import { NOISE_GLSL, OUTPUT_GLSL } from "./shaders";

/**
 * The GLB is exported Z-up (its long axis is Z). Flip this to true if the tower ever
 * renders upside down after the asset is replaced.
 */
const MODEL_UPSIDE_DOWN = false;
/** The beam starts its first pass over the ship this many seconds after the scene starts. */
const FIRST_PASS_S = 5;

const shorelineVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A low, distant coast: silhouette from fbm, fading into the horizon haze at its foot.
const shorelineFragment = /* glsl */ `
uniform float uHeight;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  float x = vUv.x * 500.0;
  float profile = 1.15 + 1.9 * fbm(vec2(x * 0.021, 3.7)) + 0.9 * fbm(vec2(x * 0.08, 8.1));
  float y = vUv.y * uHeight;
  if (y > profile) discard;
  vec3 col = mix(vec3(0.006, 0.016, 0.032), ${HORIZON_GLSL} * 0.85, smoothstep(0.9, 0.0, y - 0.15));
  col = mix(col, ${HORIZON_GLSL}, 0.18);
${OUTPUT_GLSL}
}
`;

function wrapPi(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class Lighthouse {
  readonly group = new THREE.Group();
  private readonly headland: THREE.Mesh;
  private readonly shoreline: THREE.Mesh;
  private readonly tower = new THREE.Group();
  private readonly lampMarker = new THREE.Object3D();
  private loaded = false;
  private disposed = false;
  private x = 9.5;
  private waterLevel = DEFAULT_WATER_LEVEL;
  private headlandTop = DEFAULT_WATER_LEVEL + 0.9;
  private beamClock = 0;
  private dayMode = false;

  constructor(
    private readonly beam: BeamState,
    private readonly reducedMotion: boolean,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.headland = this.buildHeadland();
    this.shoreline = this.buildShoreline();
    this.tower.visible = false;
    this.group.add(this.headland, this.tower, this.shoreline);
    this.place();
    if (LIGHTHOUSE_MODEL === "glb") this.loadGlb();
    else this.buildProceduralTower();
  }

  /**
   * Classic tapered tower: stone plinth, banded shaft, gallery with rail, glazed lantern room with a
   * glowing lamp, and a dark roof. Dimensions are in tower units (LIGHTHOUSE_HEIGHT tall).
   */
  private buildProceduralTower() {
    const h = LIGHTHOUSE_HEIGHT / 2.7;
    const stone = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.95, metalness: 0 });
    const white = new THREE.MeshStandardMaterial({ color: 0xc9d3de, roughness: 0.82, metalness: 0 });
    const band = new THREE.MeshStandardMaterial({ color: 0x6b2a30, roughness: 0.82, metalness: 0 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x0f1620, roughness: 0.6, metalness: 0.5 });
    for (const material of [stone, white, band, iron]) material.envMapIntensity = 0.3;
    // The lamp is deliberately over-bright (tone mapping turns it into a warm-white glow).
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.6, 2.8) });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x9fc4e4,
      roughness: 0.15,
      metalness: 0.2,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });

    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = y * h;
      this.tower.add(mesh);
      return mesh;
    };
    const cyl = (top: number, bottom: number, height: number, segments = 40) =>
      new THREE.CylinderGeometry(top * h, bottom * h, height * h, segments);

    // Plinth and tapered shaft in three bands (white, dark red, white).
    add(cyl(0.3, 0.34, 0.2), stone, 0.1);
    const shaftBottom = 0.2;
    const shaftTop = 2.0;
    const radiusAt = (y: number) => 0.285 - ((y - shaftBottom) / (shaftTop - shaftBottom)) * 0.125;
    const bands: [number, number, THREE.Material][] = [
      [shaftBottom, 0.85, white],
      [0.85, 1.35, band],
      [1.35, shaftTop, white],
    ];
    for (const [from, to, material] of bands) add(cyl(radiusAt(to), radiusAt(from), to - from), material, (from + to) / 2);

    // Gallery deck, rail and a corbel ring under it.
    add(cyl(0.2, 0.17, 0.08), iron, 2.04);
    add(cyl(0.3, 0.3, 0.035), iron, 2.1);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(0.285 * h, 0.012 * h, 8, 48), iron);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 2.2 * h;
    this.tower.add(rail);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * h, 0.008 * h, 0.1 * h, 5), iron);
      post.position.set(Math.cos(a) * 0.285 * h, 2.15 * h, Math.sin(a) * 0.285 * h);
      this.tower.add(post);
    }

    // Lantern room: glowing lamp inside a glass drum, iron mullions, then roof and finial.
    add(cyl(0.085, 0.085, 0.3, 24), lamp, 2.3);
    add(cyl(0.13, 0.13, 0.34, 32), glass, 2.3);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.006 * h, 0.006 * h, 0.34 * h, 4), iron);
      bar.position.set(Math.cos(a) * 0.13 * h, 2.3 * h, Math.sin(a) * 0.13 * h);
      this.tower.add(bar);
    }
    add(cyl(0.14, 0.14, 0.04), iron, 2.49);
    add(new THREE.ConeGeometry(0.17 * h, 0.2 * h, 32), iron, 2.61);
    add(new THREE.SphereGeometry(0.025 * h, 12, 8), iron, 2.72);

    this.lampMarker.position.set(0, 2.3 * h, 0);
    this.tower.add(this.lampMarker);
    this.tower.visible = true;
    this.loaded = true;
    this.place();
  }

  private buildHeadland() {
    const geometry = new THREE.IcosahedronGeometry(1, 4);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const a = Math.atan2(v.z, v.x);
      const rough = 1 + 0.1 * Math.sin(a * 5 + v.y * 4) + 0.06 * Math.sin(a * 11 - v.y * 7) + 0.04 * Math.sin(v.x * 17 + v.z * 13);
      // Broad, low dome that keeps a flat-ish crown for the tower to stand on.
      v.set(v.x * HEADLAND_RADIUS * rough, Math.max(v.y, -0.25) * 1.5 * (v.y > 0 ? 1 - 0.35 * v.y * v.y : 1), v.z * HEADLAND_RADIUS * 0.78 * rough);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0x0b141f, roughness: 0.95, metalness: 0, flatShading: true });
    material.envMapIntensity = 0.12;
    return new THREE.Mesh(geometry, material);
  }

  private buildShoreline() {
    const height = 8;
    const geometry = new THREE.PlaneGeometry(500, height);
    geometry.translate(0, height / 2, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: { uHeight: { value: height } },
      vertexShader: shorelineVertex,
      fragmentShader: shorelineFragment,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, DEFAULT_WATER_LEVEL, SHORELINE_Z);
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Optional path (see LIGHTHOUSE_MODEL): stand a Z-up GLB upright and find its lamp room. */
  private loadGlb() {
    new GLTFLoader().load(
      lighthouseUrl,
      (gltf) => {
        if (this.disposed) {
          disposeObject(gltf.scene);
          return;
        }
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const range = box.max.z - box.min.z || 1;
        const sign = MODEL_UPSIDE_DOWN ? -1 : 1;

        // Lamp room: centroid of the vertices in the upper fifth of the (Z-up) model.
        const topZ = sign > 0 ? box.max.z : box.min.z;
        const baseZ = sign > 0 ? box.min.z : box.max.z;
        const centroid = new THREE.Vector3();
        let count = 0;
        const p = new THREE.Vector3();
        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          const attr = mesh.geometry.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < attr.count; i++) {
            p.fromBufferAttribute(attr, i);
            if (Math.abs(p.z - topZ) < range * 0.2) {
              centroid.add(p);
              count += 1;
            }
          }
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of materials) {
            const shaded = material as THREE.MeshStandardMaterial;
            if (shaded.isMeshStandardMaterial) {
              shaded.envMapIntensity = 0.42;
              shaded.metalness = Math.min(shaded.metalness, 0.55);
              if (shaded.map) shaded.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            }
          }
        });
        if (count) centroid.divideScalar(count);
        const cx = (box.min.x + box.max.x) / 2;
        const cy = (box.min.y + box.max.y) / 2;

        this.lampMarker.position.set(centroid.x, centroid.y, topZ - sign * range * 0.15);
        model.add(this.lampMarker);

        // Stand the tower upright (Z-up -> Y-up), base at the origin, then scale to the target height.
        const upright = new THREE.Group();
        upright.rotation.x = (-Math.PI / 2) * sign;
        upright.add(model);
        // The rotation maps (x, y, z) to (x, sign*z, -sign*y); this offset puts the base centre at the origin.
        upright.position.set(-cx, -sign * baseZ, sign * cy);
        const frame = new THREE.Group();
        frame.add(upright);
        frame.scale.setScalar(LIGHTHOUSE_HEIGHT / range);
        this.tower.add(frame);
        this.tower.visible = true;
        this.loaded = true;
        this.place();
      },
      undefined,
      () => {
        // Missing or corrupt asset: keep the headland and shoreline, skip the tower and its beam.
      },
    );
  }

  /** Re-position everything that depends on the viewport or the fitted sea level. */
  place(lighthouseX = this.x, waterLevel = this.waterLevel) {
    this.x = lighthouseX;
    this.waterLevel = waterLevel;
    this.headland.position.set(lighthouseX, waterLevel - 0.12, LIGHTHOUSE_Z);
    this.headlandTop = this.headland.position.y + 0.95;
    this.tower.position.set(lighthouseX + 0.1, this.headlandTop - 0.1, LIGHTHOUSE_Z);
    this.shoreline.position.y = waterLevel;
    this.beam.lamp.set(lighthouseX + 0.1, this.headlandTop + LIGHTHOUSE_HEIGHT * 0.84, LIGHTHOUSE_Z);
    if (this.loaded) {
      this.tower.updateMatrixWorld(true);
      this.lampMarker.getWorldPosition(this.beam.lamp);
    }
    this.aimAtShip();
  }

  setShipCenter(center: THREE.Vector3) {
    this.beam.shipCenter.copy(center);
    this.aimAtShip();
  }

  private aimAtShip() {
    const dx = this.beam.shipCenter.x - this.beam.lamp.x;
    const dz = this.beam.shipCenter.z - this.beam.lamp.z;
    this.beam.yawToShip = Math.atan2(dz, dx);
    this.beam.pitch = Math.atan2(this.beam.shipCenter.y + 0.15 - this.beam.lamp.y, Math.hypot(dx, dz));
  }

  setDayMode(day: boolean) {
    this.dayMode = day;
    if (day) {
      this.beam.intro = 0;
      this.beam.shipAlign = 0;
    }
  }

  /** Advances the beam. `dt` is the (clamped) frame delta in seconds. */
  update(dt: number) {
    const beam = this.beam;
    if (this.dayMode) {
      beam.intro = 0;
      beam.shipAlign = 0;
      return;
    }
    if (this.loaded) beam.intro = Math.min(1, beam.intro + dt / 2.2);
    this.beamClock += dt;

    if (this.reducedMotion) {
      // No rotation: rest the beam just off the ship so the lit hull is still showcased.
      beam.yaw = beam.yawToShip - 0.07;
    } else {
      beam.yaw = beam.yawToShip + ((this.beamClock - FIRST_PASS_S) / BEAM_PERIOD_S) * Math.PI * 2;
    }
    const cp = Math.cos(beam.pitch);
    beam.direction.set(Math.cos(beam.yaw) * cp, Math.sin(beam.pitch), Math.sin(beam.yaw) * cp);

    // Eased 0..1 as the beam crosses the ship; the same value later drives light, foam and glow.
    const offAxis = Math.abs(wrapPi(beam.yaw - beam.yawToShip)) / (BEAM_LIGHT_HALF_ANGLE * 1.05);
    const t = 1 - THREE.MathUtils.smoothstep(offAxis, 0, 1);
    beam.shipAlign = t * t * (3 - 2 * t) * beam.intro;
  }

  dispose() {
    this.disposed = true;
    disposeObject(this.group);
  }
}

