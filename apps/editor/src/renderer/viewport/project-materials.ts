/**
 * Project materials on screen (the Materials workspace): the Three.js material for a `mat/…` id, kept in step
 * with the project's material list. Editing a material changes every face that uses it at once, in the 3D
 * view, in Play and in the preview, without rebuilding the level. Scrolling materials move on each frame.
 */
import { MAP_FIELDS, type MaterialDef } from '@cocoaworlds/core';
import * as THREE from 'three';
import { withProbes } from './probe-shader';
import { DEV_TEXTURE_SIZE, devMaterial } from '../brush/materials';
import type { Lang } from '../i18n';
import { assetUrl } from '../assets';
import { setShading, setWearTexture, wearTextures, type WearRole } from './triplanar';

const TEX_SIZE = DEV_TEXTURE_SIZE;
/** Face coordinates are in texels at 0.25 units each (the usual face scale): 64 units across one dev tile. */
const UNITS_PER_TILE = TEX_SIZE * 0.25;

let defs = new Map<string, MaterialDef>();

interface Live {
  id: string;
  m: THREE.MeshStandardMaterial;
  onUpdate: () => void;
  /** Bumped on every change, so an image that arrives late for an older version is dropped. */
  version: number;
  /** Texture repeats per dev tile (for scrolling at a speed in units). */
  repeat: [number, number];
  /** On a model: its images cover the model's own texture coordinates once (no face scale). */
  modelUv: boolean;
}
const live = new Map<THREE.Material, Live>();
const listeners = new Set<() => void>();

/** Called when the material list changes (swatches, labels). */
export function onMaterialsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The project's materials changed: restyle every material in use. */
export function setProjectMaterials(list: readonly MaterialDef[]): void {
  const next = new Map(list.map((d) => [d.id, d]));
  const changed = new Set<string>();
  for (const [id, d] of next) if (defs.get(id) !== d) changed.add(id);
  for (const id of defs.keys()) if (!next.has(id)) changed.add(id);
  defs = next;
  if (!changed.size) return;
  for (const l of live.values()) if (changed.has(l.id)) restyle(l);
  for (const fn of listeners) fn();
}

export const projectMaterialDef = (id: string): MaterialDef | undefined => defs.get(id);

/** How many texels one repeat of a face material's texture spans (as its image and scale make it; 256 without one). */
export function materialSheet(id: string): [number, number] {
  for (const l of live.values()) if (l.id === id && !l.modelUv) return [TEX_SIZE / (l.repeat[0] || 1), TEX_SIZE / (l.repeat[1] || 1)];
  return [TEX_SIZE, TEX_SIZE];
}
export const projectMaterialList = (): MaterialDef[] => [...defs.values()];

/** A face material's name for people: built-in, project material, or the image's file name. */
export function materialLabel(id: string, lang: Lang): string {
  return devMaterial(id)?.label[lang] ?? defs.get(id)?.name ?? (id.startsWith('mat/') ? `${id} (missing)` : id);
}

/** A new Three.js material showing project material `id` (it follows later edits of it). */
export function projectMaterial(id: string, onUpdate: () => void, opts: { modelUv?: boolean } = {}): THREE.MeshStandardMaterial {
  // (Physical: so a material can be glass. Without refraction it draws as a standard one.)
  const m = new THREE.MeshPhysicalMaterial();
  m.name = id;
  const l: Live = { id, m, onUpdate, version: 0, repeat: [1, 1], modelUv: !!opts.modelUv };
  live.set(m, l);
  restyle(l);
  return m;
}

/** The texture slots a material's maps go into. */
const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap'] as const;
type Slot = (typeof SLOTS)[number];

/** Stop following edits (the material was thrown away). */
export function releaseMaterial(m: THREE.Material): void {
  const l = live.get(m);
  if (!l) return;
  live.delete(m);
  for (const k of SLOTS) drop(l.m[k]);
  for (const t of wearTextures(l.m)) drop(t);
}

function drop(t: THREE.Texture | null): void {
  if (t && t !== missing && !liveTextures.has(t)) t.dispose();
}

// ── Pictures while a graph is being edited ──
// The graph editor hands over canvases with each map as it is now; faces show them at once, before the maps
// are baked to files.
type MapRole = keyof typeof MAP_FIELDS;
const liveMaps = new Map<string, Partial<Record<MapRole, THREE.CanvasTexture>>>();
const liveTextures = new Set<THREE.Texture>();

/** Show these canvases as material `id`'s maps (null: back to its files). */
export function setLiveMaps(id: string, maps: Partial<Record<MapRole, HTMLCanvasElement>> | null): void {
  const old = liveMaps.get(id);
  for (const t of Object.values(old ?? {})) {
    liveTextures.delete(t);
    t.dispose();
  }
  liveMaps.delete(id);
  if (maps) {
    const texs: Partial<Record<MapRole, THREE.CanvasTexture>> = {};
    for (const [role, c] of Object.entries(maps) as [MapRole, HTMLCanvasElement][]) {
      const t = new THREE.CanvasTexture(c);
      liveTextures.add(t);
      texs[role] = t;
    }
    liveMaps.set(id, texs);
  }
  for (const l of live.values()) if (l.id === id) restyle(l);
}

/** The live canvases were drawn again. */
export function refreshLiveMaps(id: string): void {
  for (const t of Object.values(liveMaps.get(id) ?? {})) t.needsUpdate = true;
  for (const l of live.values()) if (l.id === id) l.onUpdate();
}

const loader = new THREE.TextureLoader();
const images = new Map<string, Promise<THREE.Texture>>();

/** A project image, loaded once; each material gets its own copy (its own repeat and scroll). */
function loadImage(path: string): Promise<THREE.Texture> {
  let p = images.get(path);
  if (!p) {
    p = assetUrl(path).then((url) => loader.loadAsync(url));
    p.catch(() => images.delete(path));
    images.set(path, p);
  }
  return p;
}

/** Forget a loaded image (it changed on disk). */
export function forgetMaterialImage(path: string): void {
  images.delete(path);
}

// ── Reflections ──
// Metal and polished materials reflect a picture of the sky (Three.js turns it into blurred reflections by
// roughness). Matte materials leave it almost alone, so they look as they do without one.
let reflection: THREE.CanvasTexture | null = null;
let skyColors: [string, string, string] = ['#4a7fc1', '#c9dcef', '#3b3a36'];

function reflectionMap(): THREE.CanvasTexture {
  if (!reflection) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    reflection = new THREE.CanvasTexture(c);
    reflection.mapping = THREE.EquirectangularReflectionMapping;
    reflection.colorSpace = THREE.SRGBColorSpace;
    paintReflection();
  }
  return reflection;
}

function paintReflection(): void {
  if (!reflection) return;
  const c = reflection.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  const [top, horizon, ground] = skyColors;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, top);
  grad.addColorStop(0.48, horizon);
  grad.addColorStop(0.52, ground);
  grad.addColorStop(1, ground);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  reflection.needsUpdate = true;
}

/** The sky's colours (top, horizon, ground), for what shiny materials reflect. */
/** The captured scene (reflection probe), when there is one: reflected instead of the sky gradient. */
let sceneEnv: THREE.Texture | null = null;

/** Reflect the captured scene (null: the sky gradient again). */
export function setSceneReflection(tex: THREE.Texture | null): void {
  const kindChanged = !!sceneEnv !== !!tex;
  sceneEnv = tex;
  for (const l of live.values()) {
    if (!l.m.envMap) continue;
    l.m.envMap = tex ?? reflectionMap();
    // (Switching between the gradient and a captured cube is a different shader.)
    if (kindChanged) l.m.needsUpdate = true;
  }
}

export function setReflection(top: string, horizon: string, ground: string): void {
  if (skyColors[0] === top && skyColors[1] === horizon && skyColors[2] === ground) return;
  skyColors = [top, horizon, ground];
  // (Drawn when a material first needs it.)
  paintReflection();
}

/** How much a material reflects: metals fully, polished ones a little, matte ones hardly. */
const reflects = (d: MaterialDef) => d.metalness + (1 - d.metalness) * (1 - d.roughness) * 0.35;

/** Which slot each map goes in, and whether it holds colours (sRGB) or plain values. */
const ROLE_SLOT: Record<MapRole, { slot: Slot | null; srgb: boolean }> = {
  color: { slot: 'map', srgb: true },
  normal: { slot: 'normalMap', srgb: false },
  roughness: { slot: 'roughnessMap', srgb: false },
  metalness: { slot: 'metalnessMap', srgb: false },
  occlusion: { slot: 'aoMap', srgb: false },
  glow: { slot: 'emissiveMap', srgb: true },
  height: { slot: 'bumpMap', srgb: false },
  opacity: { slot: 'alphaMap', srgb: false },
  // (The wear layer's images live in the shader, not in Three.js's own slots.)
  wearColor: { slot: null, srgb: true },
  wearRoughness: { slot: null, srgb: false },
  wearMetal: { slot: null, srgb: false },
  wearNoise: { slot: null, srgb: false },
};

function restyle(l: Live): void {
  const d = defs.get(l.id);
  const m = l.m;
  const version = ++l.version;
  for (const t of wearTextures(m)) drop(t);
  for (const r of ['wearColor', 'wearRoughness', 'wearMetal', 'wearNoise'] as WearRole[]) setWearTexture(m, r, null);
  for (const k of SLOTS) {
    drop(m[k]);
    m[k] = null;
  }
  if (!d) {
    // Deleted (or never made): the missing-texture checker, so the faces are easy to find.
    setShading(m, 'face', 128, null);
    m.color.set(0xffffff);
    m.map = missingTexture();
    m.envMap = null;
    m.roughness = 0.9;
    m.metalness = 0;
    m.emissive.set(0x000000);
    m.transparent = false;
    m.opacity = 1;
    m.alphaTest = 0;
    m.side = THREE.FrontSide;
    m.needsUpdate = true;
    l.onUpdate();
    return;
  }
  const livePics = liveMaps.get(d.id);
  const has = (role: MapRole) => !!(livePics?.[role] ?? d[MAP_FIELDS[role]]);
  m.color.set(d.color);
  setShading(m, d.mapping ?? 'face', d.tile ?? 128, d.wear ?? null, d.bevel ?? 0, d.blend ? { distance: d.blend, noise: d.blendNoise ?? 0.5, size: d.blendSize ?? 24 } : null);
  // (Rooms' reflection probes, when scene reflections are on.)
  withProbes(m);
  // A map replaces its slider (Three.js multiplies the two).
  m.roughness = has('roughness') ? 1 : d.roughness;
  m.metalness = has('metalness') ? 1 : d.metalness;
  m.envMap = sceneEnv ?? reflectionMap();
  // (Worn bare metal needs something to reflect, however matte the paint is.)
  m.envMapIntensity = Math.max(has('roughness') || has('metalness') ? 0.6 : reflects(d), d.wear ? 0.35 + 0.5 * d.wear.metalness : 0);
  const glowMap = has('glow');
  m.emissive.set(d.emissive ?? (glowMap ? '#ffffff' : '#000000'));
  m.emissiveIntensity = d.emissive || glowMap ? (d.emissiveStrength ?? 1) : 0;
  // Glass: what's behind shows through, bent by the surface's normals (its normal map too), tinted by its colour.
  if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    const pm = m as THREE.MeshPhysicalMaterial;
    pm.transmission = Math.max(0, Math.min(1, d.refraction ?? 0));
    pm.ior = d.ior ?? 1.5;
    pm.thickness = d.refraction ? (d.thickness ?? 8) : 0;
  }
  m.aoMapIntensity = 1;
  const k = d.normalStrength ?? 1;
  m.normalScale.set(k, k);
  m.bumpScale = k * 2;
  const opacity = d.opacity ?? 1;
  const cut = d.cutout !== false;
  m.transparent = opacity < 1 || (has('opacity') && !cut);
  m.opacity = opacity;
  m.depthWrite = !m.transparent;
  m.side = d.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  m.alphaTest = (d.map || has('opacity')) && cut ? 0.5 : 0;
  m.needsUpdate = true;
  l.onUpdate();
  const scale = d.scale ?? 1;
  /** Repeats per dev tile: from the world size of graph materials, else from the image's own size. */
  const repeatFor = (img: { width: number; height: number }): [number, number] =>
    l.modelUv ? [1, 1] : d.tile ? [UNITS_PER_TILE / d.tile, UNITS_PER_TILE / d.tile] : [TEX_SIZE / Math.max(1, img.width * scale), TEX_SIZE / Math.max(1, img.height * scale)];
  const setup = (tex: THREE.Texture, srgb: boolean) => {
    const img = tex.image as { width: number; height: number };
    tex.flipY = false;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    const [rx, ry] = repeatFor(img);
    tex.repeat.set(rx, ry);
    tex.needsUpdate = true;
    return tex;
  };
  const put = (role: MapRole, tex: THREE.Texture) => {
    const { slot } = ROLE_SLOT[role];
    if (!slot) {
      if (d.wear) setWearTexture(m, role as WearRole, tex);
      l.onUpdate();
      return;
    }
    // (Height only gives bumps when there is no normal map.)
    if (role === 'height' && has('normal')) return void (liveTextures.has(tex) || tex.dispose());
    m[slot] = tex;
    // A glowing colour image glows in its own pattern (lava's bright cracks), tinted by the glow colour.
    if (role === 'color' && d.emissive && !glowMap) m.emissiveMap = tex;
    if (role === 'color') l.repeat = [tex.repeat.x, tex.repeat.y];
    // Bumps line up with the image when there is one.
    if (role === 'normal' && !d.tile && d.map) tex.repeat.set(l.repeat[0], l.repeat[1]);
    m.needsUpdate = true;
    l.onUpdate();
  };
  for (const role of Object.keys(ROLE_SLOT) as MapRole[]) {
    const pic = livePics?.[role];
    if (pic) {
      put(role, setup(pic, ROLE_SLOT[role].srgb));
      continue;
    }
    const path = d[MAP_FIELDS[role]];
    if (!path) continue;
    void loadImage(path).then(
      (base) => {
        if (l.version !== version || !live.has(m)) return;
        put(role, setup(base.clone(), ROLE_SLOT[role].srgb));
      },
      () => {
        if (l.version === version && role === 'color') put(role, missingTexture().clone());
      },
    );
  }
}

/** Move scrolling materials to time `ms`. True when any moved (the view needs drawing again). */
export function tickMaterials(ms: number): boolean {
  let moved = false;
  const s = ms / 1000;
  for (const l of live.values()) {
    const d = defs.get(l.id);
    const sc = d?.scroll;
    if (!sc || (!sc[0] && !sc[1])) continue;
    for (const tex of SLOTS.map((k) => l.m[k])) {
      if (!tex) continue;
      const [rx, ry] = [tex.repeat.x, tex.repeat.y];
      // Units a second → texture repeats a second, wrapped to stay precise.
      tex.offset.set(-(((sc[0] / UNITS_PER_TILE) * rx * s) % 1), ((sc[1] / UNITS_PER_TILE) * ry * s) % 1);
      moved = true;
    }
  }
  return moved;
}

let missing: THREE.Texture | null = null;

/** Source's missing-texture checker, for images that can't be loaded and materials that don't exist. */
export function missingTexture(): THREE.Texture {
  if (missing) return missing;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ff00dc';
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  missing = new THREE.CanvasTexture(c);
  missing.wrapS = missing.wrapT = THREE.RepeatWrapping;
  missing.magFilter = THREE.NearestFilter;
  missing.repeat.set(TEX_SIZE / 64, TEX_SIZE / 64);
  return missing;
}
