/**
 * The sky: a gradient from the horizon up and down, the sun's disc and glow (where the scene's Sun shines from),
 * drifting clouds lit from the sun's side, and stars where it's dark. One material, used by the game, the editor
 * and the Sky workspace's preview.
 */
import { skyOf, type SkySettings } from '@cocoaworlds/core';
import * as THREE from 'three';

/** The clouds' clock (seconds). */
const SKY_TIME = { value: 0 };

/** Where the sun shines from when the scene has no Sun (it then has no disc). */
export const DEFAULT_SUN_DIR = new THREE.Vector3(0.35, 0.6, 0.45).normalize();

export function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
      haze: { value: 0.4 },
      sunDir: { value: DEFAULT_SUN_DIR.clone() },
      sunColour: { value: new THREE.Color(1, 1, 1) },
      sunSize: { value: 1.6 },
      sunGlow: { value: 0.5 },
      clouds: { value: 0 },
      cloudSoft: { value: 0.5 },
      cloudSize: { value: 1 },
      cloudSpeed: { value: 0.5 },
      cloudColour: { value: new THREE.Color() },
      cloudShade: { value: new THREE.Color() },
      stars: { value: 0 },
      time: SKY_TIME,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane: always behind everything
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
      uniform float haze;
      uniform vec3 sunDir; uniform vec3 sunColour; uniform float sunSize; uniform float sunGlow;
      uniform float clouds; uniform float cloudSoft; uniform float cloudSize; uniform float cloudSpeed;
      uniform vec3 cloudColour; uniform vec3 cloudShade;
      uniform float stars; uniform float time;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        // Gradient: haze lifts the horizon's colour higher up the sky.
        vec3 c = y >= 0.0 ? mix(horizon, top, pow(y, mix(0.9, 0.25, haze))) : mix(horizon, ground, pow(-y, 0.4));
        float s = dot(d, sunDir);
        float above = smoothstep(-0.02, 0.02, y);
        // Glow round the sun, wider low down where the light crosses more air.
        c += sunColour * sunGlow * (pow(max(s, 0.0), 6.0) * 0.25 + pow(max(s, 0.0), 48.0) * 0.6) * mix(1.0, 0.6, above * y);
        // The disc.
        if (sunSize > 0.0) {
          float r = cos(radians(sunSize * 0.5));
          float disc = smoothstep(r - (1.0 - r) * 0.25, r + (1.0 - r) * 0.1, s) * above;
          c = mix(c, sunColour * 1.4 + 0.25, disc);
        }
        // Stars where the sky is dark.
        if (stars > 0.0 && y > 0.0) {
          vec3 p = d * 260.0;
          float n = hash3(floor(p));
          float dark = 1.0 - smoothstep(0.05, 0.35, dot(c, vec3(0.299, 0.587, 0.114)));
          float tw = 0.7 + 0.3 * sin(time * 2.0 + n * 40.0);
          c += vec3(smoothstep(1.0 - 0.004 * stars, 1.0, n)) * dark * tw * smoothstep(0.0, 0.25, y) * 1.5;
        }
        // Clouds: on a high, flat layer, drifting, lit on the side towards the sun.
        if (clouds > 0.0 && y > 0.0) {
          vec2 uv = d.xz / (y + 0.12) / (1.6 * cloudSize) + vec2(time * 0.012, time * 0.004) * cloudSpeed;
          float n = fbm(uv);
          float edge = 1.0 - clouds;
          float soft = 0.04 + 0.35 * cloudSoft;
          float density = smoothstep(edge - soft * 0.5, edge + soft * 0.5, n) * smoothstep(0.0, 0.18, y);
          float lit = clamp(0.55 + 0.45 * s + 0.3 * (n - edge), 0.0, 1.0);
          vec3 col = mix(cloudShade, cloudColour, lit);
          // A bright lining round clouds near the sun.
          col += sunColour * pow(max(s, 0.0), 10.0) * (1.0 - density) * 0.8;
          c = mix(c, col, density * 0.96);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/** Set a sky material from settings and the sun (toward it, world; null: no sun). */
export function applySky(m: THREE.ShaderMaterial, settings: SkySettings | undefined, sun: { dir: THREE.Vector3; colour: THREE.Color } | null): void {
  const s = skyOf(settings);
  const u = m.uniforms;
  u.top!.value.set(s.top);
  u.horizon!.value.set(s.horizon);
  u.ground!.value.set(s.ground);
  u.haze!.value = s.haze;
  u.sunDir!.value.copy(sun?.dir ?? DEFAULT_SUN_DIR);
  u.sunColour!.value.copy(sun?.colour ?? new THREE.Color(0, 0, 0));
  u.sunSize!.value = sun ? s.sunSize : 0;
  u.sunGlow!.value = s.sunGlow;
  u.clouds!.value = s.clouds;
  u.cloudSoft!.value = s.cloudSoftness;
  u.cloudSize!.value = s.cloudSize;
  u.cloudSpeed!.value = s.cloudSpeed;
  u.cloudColour!.value.set(s.cloudColour);
  u.cloudShade!.value.set(s.cloudShade);
  u.stars!.value = s.stars;
}

/** A sky dome that follows the camera (so it never gets nearer). */
export function skyMesh(m: THREE.ShaderMaterial): THREE.Mesh {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), m);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  sky.onBeforeRender = (_r, _s, cam) => {
    SKY_TIME.value = performance.now() / 1000;
    // (World position: a reflection probe's cameras sit inside a moved group.)
    cam.getWorldPosition(sky.position);
    sky.scale.setScalar(1000);
    sky.updateMatrixWorld();
  };
  return sky;
}

/** The sun's colour as the sky shows it: its light colour, brighter for a brighter sun (within reason). */
export function sunSkyColour(colour: string, intensity: number): THREE.Color {
  return new THREE.Color(colour).multiplyScalar(Math.min(1.2, 0.35 + intensity * 0.3));
}

/** Ambient light colours taken from a sky: from above (between its top and horizon) and below. */
export function skyAmbient(settings: SkySettings | undefined): { above: THREE.Color; below: THREE.Color; fog: THREE.Color } {
  const s = skyOf(settings);
  const above = new THREE.Color(s.top).lerp(new THREE.Color(s.horizon), 0.45);
  return { above, below: new THREE.Color(s.ground).lerp(above, 0.25), fog: new THREE.Color(s.horizon) };
}

/** The sky as an equirectangular environment texture (PNG, 2:1), for reflections and lighting elsewhere. */
export async function skyEnvPng(settings: SkySettings | undefined, sun: { dir: THREE.Vector3; colour: THREE.Color } | null, width = 2048): Promise<Uint8Array> {
  const r = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  const mat = skyMaterial();
  const cube = new THREE.WebGLCubeRenderTarget(width / 2, { type: THREE.HalfFloatType });
  const quad = new THREE.ShaderMaterial({
    uniforms: { env: { value: cube.texture } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform samplerCube env; varying vec2 vUv;
      void main() {
        float lon = (vUv.x - 0.5) * 6.2831853, lat = (vUv.y - 0.5) * 3.1415927;
        gl_FragColor = vec4(textureCube(env, vec3(-sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat))).rgb, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  try {
    applySky(mat, settings, sun);
    const scene = new THREE.Scene();
    scene.add(skyMesh(mat));
    new THREE.CubeCamera(0.1, 5000, cube).update(r, scene);
    r.setSize(width, width / 2, false);
    const flat = new THREE.Scene();
    flat.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quad));
    r.render(flat, new THREE.Camera());
    const blob = await new Promise<Blob | null>((ok) => r.domElement.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('The sky could not be drawn.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    mat.dispose();
    quad.dispose();
    cube.dispose();
    r.dispose();
  }
}
