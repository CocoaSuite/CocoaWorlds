/**
 * Project materials on screen (the Materials workspace): the Three.js material for a `mat/…` id, kept in step
 * with the project's material list. Editing a material changes every face that uses it at once, in the 3D
 * view, in Play and in the preview, without rebuilding the level. Scrolling materials move on each frame.
 */
import type { MaterialDef } from '@cocoaworlds/core';
import * as THREE from 'three';
import { DEV_TEXTURE_SIZE, devMaterial } from '../brush/materials';
import type { Lang } from '../i18n';
import { assetUrl } from '../assets';

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
export const projectMaterialList = (): MaterialDef[] => [...defs.values()];

/** A face material's name for people: built-in, project material, or the image's file name. */
export function materialLabel(id: string, lang: Lang): string {
  return devMaterial(id)?.label[lang] ?? defs.get(id)?.name ?? (id.startsWith('mat/') ? `${id} (missing)` : id);
}

/** A new Three.js material showing project material `id` (it follows later edits of it). */
export function projectMaterial(id: string, onUpdate: () => void): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  m.name = id;
  const l: Live = { id, m, onUpdate, version: 0, repeat: [1, 1] };
  live.set(m, l);
  restyle(l);
  return m;
}

/** Stop following edits (the material was thrown away). */
export function releaseMaterial(m: THREE.Material): void {
  const l = live.get(m);
  if (!l) return;
  live.delete(m);
  drop(l.m.map);
  drop(l.m.normalMap);
}

function drop(t: THREE.Texture | null): void {
  if (t && t !== missing) t.dispose();
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
export function setReflection(top: string, horizon: string, ground: string): void {
  if (skyColors[0] === top && skyColors[1] === horizon && skyColors[2] === ground) return;
  skyColors = [top, horizon, ground];
  // (Drawn when a material first needs it.)
  paintReflection();
}

/** How much a material reflects: metals fully, polished ones a little, matte ones hardly. */
const reflects = (d: MaterialDef) => d.metalness + (1 - d.metalness) * (1 - d.roughness) * 0.35;

function restyle(l: Live): void {
  const d = defs.get(l.id);
  const m = l.m;
  const version = ++l.version;
  drop(m.map);
  drop(m.normalMap);
  m.map = null;
  m.normalMap = null;
  m.emissiveMap = null;
  if (!d) {
    // Deleted (or never made): the missing-texture checker, so the faces are easy to find.
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
  m.color.set(d.color);
  m.roughness = d.roughness;
  m.metalness = d.metalness;
  m.envMap = reflectionMap();
  m.envMapIntensity = reflects(d);
  m.emissive.set(d.emissive ?? '#000000');
  m.emissiveIntensity = d.emissive ? (d.emissiveStrength ?? 1) : 0;
  const opacity = d.opacity ?? 1;
  m.transparent = opacity < 1;
  m.opacity = opacity;
  m.depthWrite = opacity >= 1;
  m.side = d.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  m.alphaTest = d.map && d.cutout !== false ? 0.5 : 0;
  m.needsUpdate = true;
  l.onUpdate();
  const scale = d.scale ?? 1;
  const take = (path: string, normal: boolean) =>
    loadImage(path).then(
      (base) => {
        if (l.version !== version || !live.has(m)) return null;
        const tex = base.clone();
        const img = tex.image as { width: number; height: number };
        tex.flipY = false;
        tex.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        tex.repeat.set(TEX_SIZE / Math.max(1, img.width * scale), TEX_SIZE / Math.max(1, img.height * scale));
        tex.needsUpdate = true;
        return tex;
      },
      () => (l.version === version && !normal ? missingTexture().clone() : null),
    );
  if (d.map) {
    void take(d.map, false).then((tex) => {
      if (!tex || l.version !== version) return;
      m.map = tex;
      // A glowing image glows in its own pattern (lava's bright cracks), tinted by the glow colour.
      if (d.emissive) m.emissiveMap = tex;
      l.repeat = [tex.repeat.x, tex.repeat.y];
      m.needsUpdate = true;
      l.onUpdate();
    });
  }
  if (d.normalMap) {
    void take(d.normalMap, true).then((tex) => {
      if (!tex || l.version !== version) return;
      // Bumps line up with the image when there is one.
      if (d.map) tex.repeat.set(l.repeat[0], l.repeat[1]);
      m.normalMap = tex;
      const k = d.normalStrength ?? 1;
      m.normalScale.set(k, k);
      m.needsUpdate = true;
      l.onUpdate();
    });
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
    for (const tex of [l.m.map, l.m.normalMap]) {
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
