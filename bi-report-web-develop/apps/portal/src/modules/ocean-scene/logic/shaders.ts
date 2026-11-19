import { HORIZON_GLSL, MID_GLSL, ZENITH_GLSL } from "./constants";

/** Small hash / value-noise toolkit shared by the sky, sea and mist shaders. */
export const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}
`;

/** Night-sky gradient for a view direction; also used by the sea for its reflection. */
export const SKY_GRADIENT_GLSL = /* glsl */ `
vec3 skyGradient(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(${HORIZON_GLSL}, ${MID_GLSL}, smoothstep(0.0, 0.2, h));
  return mix(c, ${ZENITH_GLSL}, smoothstep(0.12, 0.85, h));
}
`;

/** Shared tail: tone mapping, sRGB output and 1-LSB dither so dark gradients do not band. */
export const OUTPUT_GLSL = /* glsl */ `
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  gl_FragColor.rgb += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  #include <colorspace_fragment>
`;
