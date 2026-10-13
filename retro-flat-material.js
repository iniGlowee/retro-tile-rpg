/**
 * retro-flat-material — the classic low-poly RPG look as a three.js material.
 *
 * The defining trick of the old tile-based 3D RPGs: a face stores only HUE and
 * SATURATION; its brightness (luminance) is computed from a single fixed key light
 * every frame, the result is gamma-shaped, and faces are flat-facetted. No PBR, no
 * specular, no shadows — just hue/sat × luminance, which is most of the look.
 *
 * This builds a `THREE.ShaderMaterial` that does exactly that. Feed each vertex a
 * `hs` attribute (vec2: hue 0..1, saturation 0..1) and the material computes
 * luminance from the vertex normal against a fixed light direction, converts HSL→RGB,
 * and applies a brightness gamma. Give it non-indexed geometry with face normals and
 * you get hard facets (flat shading); give it smooth normals and you get the Gouraud
 * variant — the originals mixed both.
 *
 *   import * as THREE from 'three';
 *   import { createRetroFlatMaterial, setFlatColor } from './retro-flat-material.js';
 *
 *   const geo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(); // facets
 *   geo.computeVertexNormals();
 *   setFlatColor(THREE, geo, 0.33, 0.6);          // hue/sat per vertex (green)
 *   const mat = createRetroFlatMaterial(THREE, { ambient: 0.5, diffuse: 0.5 });
 *   scene.add(new THREE.Mesh(geo, mat));
 *
 * For a static scene, you can instead BAKE the lit colours into a vertex-colour
 * attribute once and use a plain `MeshBasicMaterial({ vertexColors:true,
 * flatShading:true })` — see `bakeVertexColors` below. That's free at runtime; use
 * this shader only when the light must move.
 *
 * No dependencies beyond three.js (passed in). MIT. No game assets or data — this is
 * the technique, applied to your own meshes.
 */

const DEFAULTS = {
  // the single fixed key light direction (normalized inside). The classic value is a
  // low side-light; tweak freely.
  lightDir: [-0.69, -0.14, -0.69],
  ambient: 0.5,   // flat ambient floor (0..1)
  diffuse: 0.5,   // key-light contribution (0..1)
  gamma: 0.8,     // brightness curve applied to the final RGB (the originals ship ~0.8)
};

const HSL2RGB = /* glsl */`
vec3 hsl2rgb(float h, float s, float l){
  if (s <= 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  vec3 t = fract(vec3(h + 1.0/3.0, h, h - 1.0/3.0));
  vec3 c;
  for (int i = 0; i < 3; i++){
    float tc = t[i];
    c[i] = 6.0*tc < 1.0 ? p + (q - p) * 6.0 * tc
         : 2.0*tc < 1.0 ? q
         : 3.0*tc < 2.0 ? p + (q - p) * (2.0/3.0 - tc) * 6.0
         : p;
  }
  return c;
}`;

/**
 * @param {object} THREE  the three.js module
 * @param {object} [opts] see DEFAULTS; plus `map` (a THREE.Texture) to use a tiled
 *                 albedo texture modulated by the same luminance instead of HSL,
 *                 and `fog` (boolean) to respect the scene's THREE.Fog.
 * @returns {THREE.ShaderMaterial}
 */
export function createRetroFlatMaterial(THREE, opts = {}) {
  if (!THREE) throw new Error('[retro-flat-material] pass the three.js module');
  const o = { ...DEFAULTS, ...opts };
  const ld = o.lightDir;
  const len = Math.hypot(ld[0], ld[1], ld[2]) || 1;

  const useMap = !!o.map;
  const useFog = !!o.fog;

  const uniforms = {
    uLightDir: { value: new THREE.Vector3(ld[0] / len, ld[1] / len, ld[2] / len) },
    uAmbient: { value: o.ambient },
    uDiffuse: { value: o.diffuse },
    uGamma: { value: o.gamma },
  };
  if (useMap) uniforms.map = { value: o.map };
  if (useFog) {
    uniforms.fogColor = { value: new THREE.Color(0xffffff) };
    uniforms.fogNear = { value: 1 };
    uniforms.fogFar = { value: 100 };
  }

  const vertex = /* glsl */`
    attribute vec2 hs;              // hue (x), saturation (y), each 0..1
    varying vec2 vHS;
    varying float vLum;
    ${useMap ? 'varying vec2 vUv;' : ''}
    ${useFog ? 'varying vec3 vViewPos;' : ''}
    uniform vec3 uLightDir;
    uniform float uAmbient;
    uniform float uDiffuse;
    void main(){
      // luminance from the one fixed key light. Feed non-indexed geometry with face
      // normals for hard facets; smooth normals give the Gouraud variant.
      vec3 n = normalize(normalMatrix * normal);
      float d = max(dot(n, uLightDir), 0.0);
      vLum = clamp(uAmbient + uDiffuse * d, 0.0, 1.0);
      vHS = hs;
      ${useMap ? 'vUv = uv;' : ''}
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      ${useFog ? 'vViewPos = mv.xyz;' : ''}
      gl_Position = projectionMatrix * mv;
    }`;

  const fragment = /* glsl */`
    precision highp float;
    varying vec2 vHS;
    varying float vLum;
    ${useMap ? 'varying vec2 vUv; uniform sampler2D map;' : ''}
    ${useFog ? 'varying vec3 vViewPos; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;' : ''}
    uniform float uGamma;
    ${HSL2RGB}
    void main(){
      vec3 base;
      ${useMap
        ? 'base = texture2D(map, vUv).rgb * vLum;'   // texture as albedo, same luminance
        : 'base = hsl2rgb(vHS.x, vHS.y, vLum);'}
      vec3 rgb = pow(base, vec3(uGamma));             // brightness curve (the originals ~0.8)
      ${useFog ? `
      float depth = length(vViewPos);
      float f = smoothstep(fogNear, fogFar, depth);
      rgb = mix(rgb, fogColor, f);` : ''}
      gl_FragColor = vec4(rgb, 1.0);
    }`;

  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: fragment });
  mat.fog = useFog;
  return mat;
}

/**
 * Fill a geometry's `hs` attribute (hue/sat per vertex) so a retro-flat material can
 * colour it. Pass numbers for a uniform colour, or functions `(faceIndex, vertexIndex)
 * => value` for per-face variety (e.g. a little random hue jitter per facet).
 *
 * @param {object} THREE     the three.js module
 * @param {THREE.BufferGeometry} geometry
 * @param {number|Function} hue  0..1
 * @param {number|Function} sat  0..1
 */
export function setFlatColor(THREE, geometry, hue, sat) {
  const count = geometry.attributes.position.count;
  const arr = new Float32Array(count * 2);
  const hf = typeof hue === 'function' ? hue : () => hue;
  const sf = typeof sat === 'function' ? sat : () => sat;
  for (let i = 0; i < count; i++) {
    const face = Math.floor(i / 3);
    arr[i * 2] = hf(face, i);
    arr[i * 2 + 1] = sf(face, i);
  }
  geometry.setAttribute('hs', new THREE.BufferAttribute(arr, 2));
  return geometry;
}

/**
 * STATIC PATH — bake the lit colours into a `color` vertex attribute once, so the
 * scene can use a plain `MeshBasicMaterial({ vertexColors:true, flatShading:true })`
 * with zero shader cost at runtime. Only re-bake if the light changes. Returns the
 * geometry (now carrying a `color` attribute).
 */
export function bakeVertexColors(THREE, geometry, hue, sat, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const ld = o.lightDir; const len = Math.hypot(ld[0], ld[1], ld[2]) || 1;
  const L = new THREE.Vector3(ld[0] / len, ld[1] / len, ld[2] / len);
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const hf = typeof hue === 'function' ? hue : () => hue;
  const sf = typeof sat === 'function' ? sat : () => sat;
  const col = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const lum = Math.max(0, Math.min(1, o.ambient + o.diffuse * Math.max(0, n.dot(L))));
    const face = Math.floor(i / 3);
    hslToRgb(hf(face, i), sf(face, i), lum, c);
    col[i * 3] = Math.pow(c.r, o.gamma);
    col[i * 3 + 1] = Math.pow(c.g, o.gamma);
    col[i * 3 + 2] = Math.pow(c.b, o.gamma);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// CPU HSL->RGB matching the shader (writes into a THREE.Color-like {r,g,b}).
function hslToRgb(h, s, l, out) {
  if (s <= 0) { out.r = out.g = out.b = l; return out; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = [h + 1 / 3, h, h - 1 / 3].map((t) => {
    t -= Math.floor(t);
    if (6 * t < 1) return p + (q - p) * 6 * t;
    if (2 * t < 1) return q;
    if (3 * t < 2) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  });
  out.r = ch[0]; out.g = ch[1]; out.b = ch[2];
  return out;
}

export default createRetroFlatMaterial;
