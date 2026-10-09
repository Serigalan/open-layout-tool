import * as THREE from 'three'

/**
 * The shaders of the 3D view (AP 13.8): points coloured by RGB, intensity,
 * height or cloud, sized by their distance — a point covers its voxel — and,
 * for picking (AP 13.11), the same points drawn as their own ids; then the
 * eye-dome lighting pass that gives a cloud without normals its edges.
 */

export const COLORINGS = ['rgb', 'intensity', 'height', 'cloud']
const MODE = { rgb: 0, intensity: 1, height: 2, cloud: 3 }

/** Colours of the clouds when coloured by cloud. */
export const CLOUD_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4']

const vertex = /* glsl */`
  attribute vec3 color;
  attribute float intensity;
  uniform int uMode;
  uniform bool uHasColor;
  uniform vec3 uCloudColor;
  uniform vec2 uZRange;
  uniform float uSize;
  uniform float uScale;
  uniform float uMinPx;
  uniform float uMaxPx;
  uniform int uPickId;
  varying vec3 vColor;

  vec3 ramp(float t) {
    // blue – cyan – green – yellow – red
    t = clamp(t, 0.0, 1.0);
    return clamp(vec3(1.5 - abs(4.0 * t - 3.0), 1.5 - abs(4.0 * t - 2.0), 1.5 - abs(4.0 * t - 1.0)), 0.0, 1.0);
  }

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uScale / max(-mv.z, 0.01), uMinPx, uMaxPx);
    if (uPickId > 0) {
      // The id of the tile (12 bits) and of the point in it, but for its
      // lowest byte (bits 8–19); that byte is a second pass of its own.
      int v = gl_VertexID;
      vColor = vec3(float(uPickId >> 4), float(((uPickId & 15) << 4) | ((v >> 16) & 15)), float((v >> 8) & 255)) / 255.0;
      return;
    }
    if (uMode == 0 && uHasColor) vColor = color;
    else if (uMode == 2) vColor = ramp((position.z - uZRange.x) / max(uZRange.y - uZRange.x, 0.01));
    else if (uMode == 3) vColor = uCloudColor * (0.55 + 0.45 * intensity);
    else vColor = vec3(0.15 + 0.85 * intensity);
  }
`

const fragment = /* glsl */`
  varying vec3 vColor;
  uniform int uPickId;
  void main() {
    if (uPickId > 0) {
      gl_FragColor = vec4(vColor, 1.0);
      return;
    }
    gl_FragColor = vec4(vColor, 1.0);
  }
`

// Picking needs the lowest byte of the point's index: a second pass draws it
// in red alone. Simpler than packing it in alpha, which blending and
// premultiplication touch on some drivers.
const pickLowFragment = /* glsl */`
  flat varying int vLow;
  void main() { gl_FragColor = vec4(float(vLow) / 255.0, 0.0, 0.0, 1.0); }
`
const pickLowVertex = /* glsl */`
  uniform float uSize;
  uniform float uScale;
  uniform float uMinPx;
  uniform float uMaxPx;
  flat varying int vLow;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uScale / max(-mv.z, 0.01), uMinPx, uMaxPx);
    vLow = gl_VertexID & 255;
  }
`

const pointUniforms = () => ({
  uMode: { value: 0 }, uHasColor: { value: false }, uCloudColor: { value: new THREE.Color('#e6194b') },
  uZRange: { value: new THREE.Vector2(0, 10) }, uSize: { value: 0.02 }, uScale: { value: 800 },
  uMinPx: { value: 1.5 }, uMaxPx: { value: 24 }, uPickId: { value: 0 },
})

/** The material of one tile's points. */
export function pointMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, uniforms: pointUniforms(),
  })
}

/** The material the low byte of each point's index is drawn with, for picking. */
export function pickLowMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: pickLowVertex, fragmentShader: pickLowFragment,
    uniforms: { uSize: { value: 0.02 }, uScale: { value: 800 }, uMinPx: { value: 1.5 }, uMaxPx: { value: 24 } },
  })
}

/** Set a point material's look: `coloring`, the tile's voxel [m], colour, height range. */
export function setLook(material, { coloring, hasColor, cloudColor, zRange, size, scale, sizeFactor = 1 }) {
  const u = material.uniforms
  u.uMode.value = MODE[coloring] ?? 1
  u.uHasColor.value = hasColor
  if (cloudColor) u.uCloudColor.value.set(cloudColor)
  if (zRange) u.uZRange.value.set(zRange[0], zRange[1])
  u.uSize.value = size * sizeFactor
  u.uScale.value = scale
}

// ── eye-dome lighting ───────────────────────────────────────────────────────

const edlVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const edlFragment = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  uniform vec3 uBackground;

  float logDepth(float d) {
    if (d >= 1.0) return log2(uFar);
    float z = d * 2.0 - 1.0;
    return log2(2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)));
  }

  void main() {
    float d = texture(tDepth, vUv).r;
    vec4 c = texture(tColor, vUv);
    // The points' depth handed on, so what is drawn over them afterwards
    // (the overlays, unshaded) still hides behind them.
    gl_FragDepth = d;
    if (d >= 1.0) { gl_FragColor = vec4(uBackground, 1.0); return; }
    float here = logDepth(d);
    float sum = 0.0;
    vec2 dirs[8] = vec2[](vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1),
                          vec2(0.707, 0.707), vec2(-0.707, 0.707), vec2(0.707, -0.707), vec2(-0.707, -0.707));
    for (int i = 0; i < 8; i++) {
      float n = logDepth(texture(tDepth, vUv + dirs[i] * uTexel * 1.4).r);
      sum += max(0.0, here - n);
    }
    float shade = exp(-sum / 8.0 * 300.0 * uStrength);
    gl_FragColor = vec4(c.rgb * shade, 1.0);
  }
`

/**
 * The full-screen pass that shades the rendered points by the depth around
 * them, and writes their depth into the screen's for the overlays drawn after.
 */
export function edlPass() {
  const material = new THREE.ShaderMaterial({
    vertexShader: edlVertex, fragmentShader: edlFragment, depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true,
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.1 }, uFar: { value: 10000 }, uStrength: { value: 0.6 }, uBackground: { value: new THREE.Color('#1d1f27') },
    },
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  return { scene, material, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }
}
