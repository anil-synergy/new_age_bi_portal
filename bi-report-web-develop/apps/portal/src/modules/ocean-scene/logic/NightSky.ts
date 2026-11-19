import * as THREE from "three";
import { disposeObject } from "./constants";
import { NOISE_GLSL, OUTPUT_GLSL, SKY_GRADIENT_GLSL } from "./shaders";

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uTwinkle;
uniform float uDrift;
uniform vec3 uMoonDir;
uniform float uDay;
varying vec3 vDir;
${NOISE_GLSL}
${SKY_GRADIENT_GLSL}

// One layer of stars on a cell grid in (azimuth, elevation). Only some stars twinkle, and only gently.
float starLayer(vec3 d, float scale, float threshold, float size) {
  float elev = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(atan(d.x, -d.z) * cos(elev), elev) * scale;
  vec2 id = floor(uv);
  vec2 f = fract(uv) - 0.5;
  float r = hash21(id);
  if (r < threshold) return 0.0;
  vec2 offset = (vec2(hash21(id + 7.1), hash21(id + 13.7)) - 0.5) * 0.6;
  float mag = hash21(id + 3.3);
  float s = smoothstep(size * (0.45 + 0.55 * mag), 0.0, length(f - offset));
  float shimmer = 0.62 + 0.38 * sin(uTime * (1.1 + 2.6 * hash21(id + 9.0)) + r * 40.0);
  float twinkle = mix(1.0, shimmer, step(0.7, hash21(id + 21.0)) * uTwinkle);
  return s * (0.3 + 0.7 * mag) * twinkle;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyGradient(d);
  vec3 daySky = mix(vec3(0.38, 0.58, 0.88), vec3(0.72, 0.86, 0.98), smoothstep(0.02, 0.42, d.y));
  col = mix(col, daySky, uDay);

  // Moon: disc with soft maria, limb darkening, layered halo and a faint 22-degree ring.
  float cosM = clamp(dot(d, uMoonDir), -1.0, 1.0);
  float ang = acos(cosM);
  float radius = 0.026;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
  vec3 upv = cross(uMoonDir, right);
  vec2 muv = vec2(dot(d, right), dot(d, upv)) / radius;
  float disc = 1.0 - smoothstep(radius * 0.93, radius * 1.0, ang);
  float maria = mix(0.74, 1.0, smoothstep(0.32, 0.68, fbm(muv * 2.1 + 4.0)));
  float limb = 0.82 + 0.18 * sqrt(max(1.0 - dot(muv, muv), 0.0));
  vec3 moonCol = vec3(0.92, 0.96, 1.0) * 1.9 * maria * limb;
  vec3 sunCore = vec3(1.0, 0.38, 0.08);
  vec3 sunLimb = vec3(1.0, 0.55, 0.12);
  vec3 sunCol = mix(sunLimb, sunCore, smoothstep(0.0, radius * 0.85, ang)) * 2.85 * disc;
  vec3 discCol = mix(moonCol, sunCol, uDay);
  float halo = exp(-ang * 15.0) * 0.55 + exp(-ang * 4.6) * 0.17 + exp(-ang * 1.5) * 0.045;
  halo += exp(-pow((ang - 0.38) / 0.035, 2.0)) * 0.018;
  vec3 haloCol = mix(vec3(0.30, 0.50, 0.72), vec3(1.0, 0.42, 0.10), uDay);

  // Clouds: drifting fbm on a plane, lit along their moon-facing edges.
  float above = smoothstep(0.015, 0.14, d.y);
  vec2 cp = d.xz / (max(d.y, 0.0) + 0.2) * 1.15;
  cp += vec2(uTime * 0.0055, uTime * 0.0021) * uDrift;
  vec2 toMoon = normalize(uMoonDir.xz / (uMoonDir.y + 0.2) + 1e-4) * 0.11;
  float f1 = fbm(cp * 1.35);
  float f2 = fbm((cp + toMoon) * 1.35);
  float cover = smoothstep(0.28, 0.66, fbm(cp * 0.36 + 3.1));
  float dens = smoothstep(0.42, 0.74, f1) * cover * above;
  float edge = clamp((f1 - f2) * 3.4, 0.0, 1.0);
  vec3 cloudCol = vec3(0.016, 0.030, 0.060) + vec3(0.32, 0.46, 0.60) * (edge * 0.75 + halo * 1.4);

  // Stars fade out in haze, behind clouds and inside the moon's glow.
  float visible = above * (1.0 - dens) * clamp(1.0 - halo * 2.4, 0.0, 1.0) * (1.0 - uDay);
  float stars = starLayer(d, 150.0, 0.962, 0.2) + 1.5 * starLayer(d, 58.0, 0.985, 0.17);
  col += vec3(0.78, 0.88, 1.0) * stars * visible * 1.6;
  vec3 dayCloud = vec3(0.85, 0.90, 0.96) * dens * uDay;
  col += dayCloud;

  col += haloCol * halo * (1.0 - uDay * 0.85);
  col = mix(col, cloudCol, dens * 0.88 * (1.0 - uDay * 0.65));
  col = mix(col, discCol, disc);
${OUTPUT_GLSL}
}
`;

export class NightSky {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uTime: { value: 0 },
    uTwinkle: { value: 1 },
    uDrift: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(-0.2, 0.07, -0.97) },
    uDay: { value: 0 },
  };

  constructor(reducedMotion: boolean) {
    this.uniforms.uTwinkle.value = reducedMotion ? 0 : 1;
    this.uniforms.uDrift.value = reducedMotion ? 0.1 : 1;
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
    // Drawn after the opaque scene so the GPU can skip every pixel the sea, ship or land already covers.
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
  }

  setMoonDirection(direction: THREE.Vector3) {
    this.uniforms.uMoonDir.value.copy(direction);
  }

  setDayBlend(blend: number) {
    this.uniforms.uDay.value = THREE.MathUtils.clamp(blend, 0, 1);
  }

  update(time: number, cameraPosition: THREE.Vector3) {
    this.uniforms.uTime.value = time;
    this.mesh.position.copy(cameraPosition);
  }

  dispose() {
    disposeObject(this.mesh);
  }
}
