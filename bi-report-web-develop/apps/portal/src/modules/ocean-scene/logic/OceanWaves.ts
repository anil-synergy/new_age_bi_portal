import * as THREE from "three";
import { BEAM_VISIBLE_HALF_ANGLE, DEFAULT_WATER_LEVEL, HORIZON_GLSL, disposeObject, type BeamState } from "./constants";
import { NOISE_GLSL, OUTPUT_GLSL, SKY_GRADIENT_GLSL } from "./shaders";

// Four large, slow swells displace the mesh; two finer ripples only perturb the normal.
// Each swell: direction (xz), wave number, speed, amplitude.
const WAVES_GLSL = /* glsl */ `
vec3 swell(vec2 p, vec2 dir, float k, float speed, float amp, float t) {
  float phase = dot(p, normalize(dir)) * k + t * speed;
  float c = cos(phase);
  vec2 d = normalize(dir);
  // x: height, yz: slope in world x / z
  return vec3(amp * sin(phase), amp * k * c * d.x, amp * k * c * d.y);
}
vec3 largeSwells(vec2 p, float t) {
  vec3 w = swell(p, vec2(0.80, 0.60), 0.55, 0.55, 0.070, t);
  w += swell(p, vec2(-0.60, 0.80), 0.90, 0.80, 0.045, t);
  w += swell(p, vec2(0.20, -0.98), 1.60, 1.10, 0.026, t);
  w += swell(p, vec2(-0.95, -0.30), 2.40, 1.40, 0.014, t);
  return w;
}
`;

const vertexShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vHeight;
${WAVES_GLSL}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 w = largeSwells(world.xz, uTime);
  world.y += w.x;
  vWorld = world.xyz;
  vHeight = w.x;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uLamp;
uniform vec2 uBeamA;
uniform vec2 uBeamB;
uniform float uBeamCos;
uniform float uBeamGain;
uniform vec4 uShip;
uniform float uShipAlign;
uniform float uDay;
varying vec3 vWorld;
varying float vHeight;
${NOISE_GLSL}
${SKY_GRADIENT_GLSL}
${WAVES_GLSL}

float beamStreak(vec2 beamDir, vec2 fromLamp, float dist) {
  float a = dot(fromLamp / max(dist, 0.001), beamDir);
  float s = smoothstep(uBeamCos, 1.0, a);
  return s * s * smoothstep(1.5, 9.0, dist) * exp(-dist * 0.016);
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // Normal: large swells + fine ripples that fade with distance to avoid shimmer.
  vec3 w = largeSwells(vWorld.xz, uTime);
  float detail = 1.0 - smoothstep(22.0, 75.0, dist);
  vec3 r1 = swell(vWorld.xz, vec2(0.50, 0.86), 4.2, 1.9, 0.0085, uTime);
  vec3 r2 = swell(vWorld.xz, vec2(-0.70, 0.71), 7.0, 2.4, 0.0042, uTime);
  vec2 slope = w.yz + (r1.yz + r2.yz) * detail;
  slope *= 1.0 / (1.0 + dist * 0.012);
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  // Fresnel reflection of the night sky.
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = skyGradient(vec3(R.x, abs(R.y), R.z));

  // Body colour: deep navy, warming to teal on the crests.
  float crest = smoothstep(0.045, 0.15, vHeight + (r1.x + r2.x) * detail * 3.0);
  vec3 body = mix(vec3(0.0015, 0.0095, 0.024), vec3(0.004, 0.030, 0.046), smoothstep(-0.08, 0.12, vHeight));
  vec3 dayBody = mix(vec3(0.03, 0.14, 0.28), vec3(0.06, 0.24, 0.38), smoothstep(-0.08, 0.12, vHeight));
  body = mix(body, dayBody, uDay);
  vec3 col = mix(body, sky, fres);
  col += vec3(0.04, 0.30, 0.38) * crest * 0.15 * (0.45 + 0.55 * N.y);

  // Haze towards the horizon so sea and sky melt together.
  float haze = smoothstep(28.0, 125.0, dist);
  col = mix(col, ${HORIZON_GLSL}, haze);

  // Moon road: broken glitter around the mirror direction, brightest near the horizon.
  float m = max(dot(R, uMoonDir), 0.0);
  float glitter = pow(m, 700.0) * 2.4 + pow(m, 120.0) * 0.45 + pow(m, 18.0) * 0.07;
  float sparkle = 0.55 + 0.45 * vnoise(vWorld.xz * 2.7 + vec2(uTime * 0.7, -uTime * 0.4));
  col += vec3(0.62, 0.78, 0.95) * glitter * sparkle * (1.0 - haze * 0.4) * (1.0 - uDay * 0.85);
  col += vec3(0.95, 0.88, 0.65) * glitter * sparkle * uDay * 0.65;

  // Lighthouse beams skim the surface and glint on the swells.
  vec2 fromLamp = vWorld.xz - uLamp.xz;
  float lampDist = length(fromLamp);
  vec3 Lv = normalize(uLamp - vWorld);
  float glint = pow(max(dot(N, normalize(V + Lv)), 0.0), 90.0);
  float streak = beamStreak(uBeamA, fromLamp, lampDist) + 0.4 * beamStreak(uBeamB, fromLamp, lampDist);
  col += vec3(0.50, 0.80, 0.92) * streak * uBeamGain * (0.07 + 2.2 * glint) * (1.0 - uDay);

  // Wake foam and a soft contact shadow around the hull.
  vec2 e = (vWorld.xz - uShip.xy) / uShip.zw;
  float ring = length(e);
  float foamNoise = fbm(vWorld.xz * 3.2 + uTime * 0.12);
  float foam = smoothstep(0.7, 0.9, ring) * (1.0 - smoothstep(0.94, 1.12, ring)) * smoothstep(0.42, 0.78, foamNoise);
  col = mix(col, vec3(0.004, 0.012, 0.022), (1.0 - smoothstep(0.3, 0.95, ring)) * 0.5);
  col += vec3(0.10, 0.20, 0.25) * foam * (0.25 + uShipAlign * 0.9);
${OUTPUT_GLSL}
}
`;

export class OceanWaves {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uTime: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(-0.2, 0.07, -0.97) },
    uLamp: { value: new THREE.Vector3() },
    uBeamA: { value: new THREE.Vector2(1, 0) },
    uBeamB: { value: new THREE.Vector2(-1, 0) },
    uBeamCos: { value: Math.cos(BEAM_VISIBLE_HALF_ANGLE * 1.6) },
    uBeamGain: { value: 0 },
    uShip: { value: new THREE.Vector4(0, 0, 2.2, 1.2) },
    uShipAlign: { value: 0 },
    uDay: { value: 0 },
  };

  constructor() {
    const geometry = new THREE.PlaneGeometry(320, 175, 150, 100);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(0, DEFAULT_WATER_LEVEL, -55);
    this.mesh.frustumCulled = false;
  }

  get level() {
    return this.mesh.position.y;
  }

  setLevel(y: number) {
    this.mesh.position.y = y;
  }

  setMoonDirection(direction: THREE.Vector3) {
    this.uniforms.uMoonDir.value.copy(direction);
  }

  setDayBlend(blend: number) {
    this.uniforms.uDay.value = THREE.MathUtils.clamp(blend, 0, 1);
  }

  /** Footprint of the hull on the sea (centre x/z and half extents) for foam and contact shadow. */
  setShipFootprint(centerX: number, centerZ: number, halfX: number, halfZ: number) {
    this.uniforms.uShip.value.set(centerX, centerZ, Math.max(halfX, 0.5), Math.max(halfZ, 0.5));
  }

  update(time: number, beam: BeamState) {
    this.uniforms.uTime.value = time;
    this.uniforms.uLamp.value.copy(beam.lamp);
    this.uniforms.uBeamA.value.set(Math.cos(beam.yaw), Math.sin(beam.yaw));
    this.uniforms.uBeamB.value.set(-Math.cos(beam.yaw), -Math.sin(beam.yaw));
    this.uniforms.uBeamGain.value = beam.intro;
    this.uniforms.uShipAlign.value = beam.shipAlign;
  }

  dispose() {
    disposeObject(this.mesh);
  }
}
