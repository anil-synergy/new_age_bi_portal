import * as THREE from "three";
import { BEAM_VISIBLE_HALF_ANGLE, DEFAULT_WATER_LEVEL, disposeObject, type BeamState } from "./constants";
import { NOISE_GLSL } from "./shaders";

const BEAM_LENGTH = 85;

const beamVertex = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying float vT;
varying float vWorldY;
uniform float uLength;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vT = position.x / uLength;
  vWorldY = (modelMatrix * vec4(position, 1.0)).y;
  gl_Position = projectionMatrix * mv;
}
`;

// Soft shaft: bright core, edges fade by facing ratio, intensity falls off along the length.
const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uWater;
varying vec3 vNormal;
varying vec3 vView;
varying float vT;
varying float vWorldY;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(-vView)));
  float core = pow(facing, 1.7);
  float along = pow(max(1.0 - vT, 0.0), 1.35) * smoothstep(0.0, 0.035, vT);
  // Dissolve into the sea surface instead of being sliced by it.
  float aboveSea = smoothstep(uWater - 0.1, uWater + 1.6, vWorldY);
  float a = core * along * aboveSea * uIntensity;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const mistVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const mistFragment = /* glsl */ `
uniform float uTime;
uniform float uDrift;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  float band = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.25, 1.0, vUv.y));
  float n = fbm(vec2(vUv.x * 9.0 + uTime * 0.012 * uDrift, vUv.y * 2.5));
  float a = band * smoothstep(0.28, 0.8, n) * 0.30;
  vec3 col = vec3(0.045, 0.11, 0.155);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function createBeam(intensity: number, halfAngle: number, length: number) {
  const radius = Math.tan(halfAngle) * length;
  // Cylinder axis is Y; rotate it onto +X and slide the apex to the origin.
  const geometry = new THREE.CylinderGeometry(radius, 0.03, length, 40, 1, true);
  geometry.rotateZ(-Math.PI / 2);
  geometry.translate(length / 2, 0, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0.55, 0.82, 0.95) },
      uIntensity: { value: intensity },
      uLength: { value: length },
      uWater: { value: DEFAULT_WATER_LEVEL },
    },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.12, "rgba(200,235,255,0.7)");
    gradient.addColorStop(0.4, "rgba(110,180,230,0.18)");
    gradient.addColorStop(1, "rgba(60,120,190,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class AtmosphericEffects {
  readonly group = new THREE.Group();
  private readonly mainYaw = new THREE.Group();
  private readonly counterYaw = new THREE.Group();
  private readonly mainBeam = createBeam(0.62, BEAM_VISIBLE_HALF_ANGLE, BEAM_LENGTH);
  private readonly counterBeam = createBeam(0.26, BEAM_VISIBLE_HALF_ANGLE * 0.9, BEAM_LENGTH * 0.6);
  private readonly glow: THREE.Sprite;
  private readonly mist: THREE.Mesh;
  private readonly mistUniforms = { uTime: { value: 0 }, uDrift: { value: 1 } };
  private readonly toCamera = new THREE.Vector3();

  constructor(reducedMotion: boolean) {
    this.mistUniforms.uDrift.value = reducedMotion ? 0.1 : 1;
    this.mainYaw.add(this.mainBeam);
    this.counterYaw.add(this.counterBeam);

    const glowMaterial = new THREE.SpriteMaterial({
      map: createGlowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Sprite(glowMaterial);
    this.glow.renderOrder = 6;

    const mistGeometry = new THREE.PlaneGeometry(260, 9);
    mistGeometry.translate(0, 4.5, 0);
    this.mist = new THREE.Mesh(
      mistGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.mistUniforms,
        vertexShader: mistVertex,
        fragmentShader: mistFragment,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.mist.position.set(0, DEFAULT_WATER_LEVEL - 0.2, -68);
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 4;

    this.group.add(this.mainYaw, this.counterYaw, this.glow, this.mist);
  }

  setWaterLevel(y: number) {
    this.mist.position.y = y - 0.2;
    (this.mainBeam.material as THREE.ShaderMaterial).uniforms.uWater.value = y;
    (this.counterBeam.material as THREE.ShaderMaterial).uniforms.uWater.value = y;
  }

  update(time: number, beam: BeamState, camera: THREE.Camera) {
    this.mistUniforms.uTime.value = time;
    const on = beam.intro;
    this.mainYaw.visible = this.counterYaw.visible = this.glow.visible = on > 0.001;
    if (!this.glow.visible) return;

    // Heading/pitch for the shafts: yaw about Y, then tilt about the local Z axis.
    this.mainYaw.position.copy(beam.lamp);
    this.counterYaw.position.copy(beam.lamp);
    this.mainYaw.rotation.y = -beam.yaw;
    this.counterYaw.rotation.y = -(beam.yaw + Math.PI);
    this.mainBeam.rotation.z = beam.pitch;
    this.counterBeam.rotation.z = beam.pitch;
    // The lamp blooms when a beam points down the lens and settles when it turns away.
    this.toCamera.copy(camera.position).sub(beam.lamp).normalize();
    const facing = Math.max(0, beam.direction.dot(this.toCamera));
    // Seen end-on the shaft stacks up into a bright wall, so thin it as it swings toward the viewer.
    (this.mainBeam.material as THREE.ShaderMaterial).uniforms.uIntensity.value = 0.5 * on * (1 - 0.6 * facing * facing);
    (this.counterBeam.material as THREE.ShaderMaterial).uniforms.uIntensity.value = 0.22 * on * (1 + 0.5 * facing * facing);
    const bloom = 0.35 + 0.65 * Math.pow(facing, 3);
    this.glow.position.copy(beam.lamp);
    this.glow.scale.setScalar(1.1 + 1.4 * bloom);
    this.glow.material.opacity = (0.5 + 0.5 * bloom) * on;
  }

  dispose() {
    this.glow.material.map?.dispose();
    disposeObject(this.group);
  }
}

