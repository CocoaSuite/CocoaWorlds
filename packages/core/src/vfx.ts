/**
 * Visual effects made in the VFX workspace: dust puffs, sparks, drips, impact rings. An effect is a few layers
 * played on one timeline: emitters (many small particles that fly, fall and fade) and shape animations (one
 * shape keyed over time: a ring that grows, a flash, a flipbook). Plain JSON, kept in the project; the editor's
 * preview and the game play them the same way. Sizes in u (the player is 72 u tall), times in seconds.
 */

/** How a particle or shape is drawn: crisp flat vector shapes, soft-edged blobs, or a project image. */
export type VfxStyle = 'vector' | 'soft' | 'texture';
export type VfxShapeKind = 'circle' | 'square' | 'diamond' | 'triangle' | 'star' | 'ring' | 'line';
export type VfxBlend = 'normal' | 'add';
/** Faces the camera, or lies flat on the ground (rings, splashes). */
export type VfxFacing = 'camera' | 'flat';
/** Where an emitter's particles start, around its point. */
export type VfxArea = 'point' | 'disc' | 'sphere' | 'box';
export type VfxEase = 'linear' | 'in' | 'out' | 'inOut' | 'step';

/** A value over a particle's life: points (life 0…1, value), joined in order. */
export type VfxCurve = [t: number, v: number][];
/** Colours over a particle's life (t 0…1). */
export type VfxGradient = { t: number; colour: string }[];
export type VfxRange = [min: number, max: number];

/** A texture used as a flipbook: the image is cut into a grid of frames, played left to right, top to bottom. */
export interface VfxFlipbook {
  cols: number;
  rows: number;
  /** Frames per second (0: one pass over the particle's life). */
  fps: number;
}

/** What a layer looks like. */
export interface VfxLook {
  style: VfxStyle;
  shape: VfxShapeKind;
  /** The image for the texture style (a project asset, `assets/textures/…`; '' none). */
  texture: string;
  flipbook?: VfxFlipbook;
  blend: VfxBlend;
  facing: VfxFacing;
}

export interface VfxEmitter {
  kind: 'emitter';
  id: string;
  name: string;
  visible: boolean;
  /** When it starts emitting, and for how long (seconds on the effect's timeline). */
  start: number;
  duration: number;
  /** A steady stream (per second), or all at once at the start. */
  spawn: 'rate' | 'burst';
  rate: number;
  count: number;
  /** How long each particle lives (between min and max, picked at random). */
  life: VfxRange;
  area: VfxArea;
  /** The area's radius (or half its width for a box). */
  areaSize: number;
  /** How high above the effect's point the area is (u; rain starts up in the sky). */
  rise?: number;
  /** Particles fly up (+Y, turned with the object), spread around it by up to this many degrees (180: everywhere). */
  spread: number;
  speed: VfxRange;
  /** Pull downwards (u/s²; negative rises). */
  gravity: number;
  /** Speed lost each second (0–1+). */
  drag: number;
  size: VfxRange;
  /** Turning speed (degrees per second, picked between min and max; either way round). */
  spin: VfxRange;
  /** Lines point the way they fly, stretched with speed. */
  alignToMotion: boolean;
  look: VfxLook;
  /** Over each particle's life: size (× its size), speed (×), opacity (0–1) and colour. */
  sizeOverLife: VfxCurve;
  speedOverLife: VfxCurve;
  opacityOverLife: VfxCurve;
  colourOverLife: VfxGradient;
}

/** One keyframe of a shape animation (its time is from the layer's start). */
export interface VfxKey {
  t: number;
  size: number;
  colour: string;
  opacity: number;
  /** Degrees. */
  rotation: number;
  /** Height above the effect's point (u). */
  rise: number;
  /** How it moves from this key to the next. */
  ease: VfxEase;
}

export interface VfxShapeAnim {
  kind: 'shape';
  id: string;
  name: string;
  visible: boolean;
  start: number;
  duration: number;
  look: VfxLook;
  keys: VfxKey[];
}

export type VfxLayer = VfxEmitter | VfxShapeAnim;

export interface VfxEffect {
  id: string;
  name: string;
  /** How long one pass takes (seconds); a looping effect starts again after it. */
  duration: number;
  loop: boolean;
  layers: VfxLayer[];
  /** The preset it was made from. */
  preset?: string;
}

// ── Defaults ──

export const defaultLook = (patch: Partial<VfxLook> = {}): VfxLook => ({ style: 'vector', shape: 'circle', texture: '', blend: 'normal', facing: 'camera', ...patch });

let layerSeq = 0;
const layerId = () => `l${Date.now().toString(36)}${(layerSeq++).toString(36)}`;

export function newEmitter(patch: Partial<VfxEmitter> = {}): VfxEmitter {
  return {
    kind: 'emitter',
    id: layerId(),
    name: 'Emitter',
    visible: true,
    start: 0,
    duration: 1,
    spawn: 'rate',
    rate: 20,
    count: 20,
    life: [0.6, 1.2],
    area: 'point',
    areaSize: 8,
    rise: 0,
    spread: 25,
    speed: [40, 80],
    gravity: 0,
    drag: 0.5,
    size: [6, 10],
    spin: [0, 0],
    alignToMotion: false,
    look: defaultLook(),
    sizeOverLife: [[0, 1], [1, 1]],
    speedOverLife: [[0, 1], [1, 1]],
    opacityOverLife: [[0, 1], [0.7, 1], [1, 0]],
    colourOverLife: [{ t: 0, colour: '#ececec' }],
    ...patch,
  };
}

export function newShapeAnim(patch: Partial<VfxShapeAnim> = {}): VfxShapeAnim {
  return {
    kind: 'shape',
    id: layerId(),
    name: 'Shape',
    visible: true,
    start: 0,
    duration: 0.6,
    look: defaultLook({ shape: 'ring', facing: 'flat' }),
    keys: [
      { t: 0, size: 10, colour: '#ececec', opacity: 1, rotation: 0, rise: 1, ease: 'out' },
      { t: 0.6, size: 80, colour: '#ececec', opacity: 0, rotation: 0, rise: 1, ease: 'linear' },
    ],
    ...patch,
  };
}

/** A new effect (one emitter). */
export function newEffect(name: string, patch: Partial<VfxEffect> = {}): VfxEffect {
  return { id: `fx_${Date.now().toString(36)}${(layerSeq++).toString(36)}`, name, duration: 1.2, loop: false, layers: [newEmitter({ name: 'Particles' })], ...patch };
}

// ── Presets (vector, flat, no glow by default) ──

// A semi-realistic explosion: flash, shockwave, sparks, debris, a cooling fireball, a dust skirt and rising smoke.
const softLook = defaultLook({ style: 'soft' });
const explosion: Omit<VfxEffect, 'id' | 'name'> = {
  duration: 3,
  loop: false,
  layers: [
    newShapeAnim({ id: 'flash', name: 'Flash', duration: 0.18, look: defaultLook({ style: 'soft', shape: 'circle', facing: 'camera' }), keys: [
      { t: 0, size: 60, colour: '#fff6dc', opacity: 1, rotation: 0, rise: 30, ease: 'out' },
      { t: 0.18, size: 260, colour: '#ffd27a', opacity: 0, rotation: 0, rise: 40, ease: 'linear' } ] }),
    newEmitter({ id: 'smoke', name: 'Smoke', spawn: 'burst', count: 44, start: 0.08, duration: 0.12, rise: 45, life: [2.2, 3], area: 'sphere', areaSize: 34, spread: 180, speed: [40, 120], gravity: -60, drag: 1.4, size: [60, 95], spin: [10, 35], look: softLook,
      sizeOverLife: [[0, 0.5], [0.4, 1.8], [1, 2.6]], opacityOverLife: [[0, 0], [0.08, 1], [0.6, 0.8], [1, 0]],
      colourOverLife: [{ t: 0, colour: '#4a3a30' }, { t: 0.3, colour: '#302c2a' }, { t: 1, colour: '#1e1d1c' }] }),
    newEmitter({ id: 'dust', name: 'Dust skirt', spawn: 'burst', count: 26, start: 0.04, duration: 0.05, life: [1, 1.7], area: 'disc', areaSize: 40, spread: 85, speed: [120, 230], gravity: -8, drag: 2.6, size: [20, 34], look: softLook,
      sizeOverLife: [[0, 0.6], [1, 2]], opacityOverLife: [[0, 0.7], [1, 0]], colourOverLife: [{ t: 0, colour: '#6b6152' }, { t: 1, colour: '#4a443c' }] }),
    newEmitter({ id: 'fire', name: 'Fireball', spawn: 'burst', count: 60, duration: 0.05, rise: 35, life: [0.5, 1], area: 'sphere', areaSize: 26, spread: 180, speed: [70, 190], gravity: -70, drag: 3, size: [40, 66], spin: [0, 60], look: softLook,
      sizeOverLife: [[0, 0.6], [0.3, 1.3], [1, 1.7]], opacityOverLife: [[0, 1], [0.6, 0.9], [1, 0]],
      colourOverLife: [{ t: 0, colour: '#fff1b0' }, { t: 0.25, colour: '#ffb347' }, { t: 0.6, colour: '#e2541c' }, { t: 1, colour: '#4a3226' }] }),
    newEmitter({ id: 'debris', name: 'Debris', spawn: 'burst', count: 22, duration: 0.05, rise: 20, life: [0.9, 1.5], spread: 65, speed: [260, 520], gravity: 700, drag: 0.3, size: [3, 6], spin: [200, 600], look: defaultLook({ shape: 'square' }),
      opacityOverLife: [[0, 1], [0.85, 1], [1, 0]], colourOverLife: [{ t: 0, colour: '#2b2622' }] }),
    newEmitter({ id: 'sparks', name: 'Sparks', spawn: 'burst', count: 30, duration: 0.05, rise: 25, life: [0.3, 0.7], spread: 90, speed: [320, 620], gravity: 500, drag: 0.6, size: [6, 10], alignToMotion: true, look: defaultLook({ shape: 'line' }),
      sizeOverLife: [[0, 1], [1, 0.4]], opacityOverLife: [[0, 1], [0.8, 1], [1, 0]], colourOverLife: [{ t: 0, colour: '#fff2b8' }, { t: 1, colour: '#f08a2a' }] }),
    newShapeAnim({ id: 'shock', name: 'Shockwave', duration: 0.4, look: defaultLook({ shape: 'ring', facing: 'flat' }), keys: [
      { t: 0, size: 20, colour: '#d8d0c2', opacity: 0.7, rotation: 0, rise: 2, ease: 'out' },
      { t: 0.4, size: 420, colour: '#d8d0c2', opacity: 0, rotation: 0, rise: 2, ease: 'linear' } ] }),
  ],
};

type Preset = { key: string; name: { en: string; ru: string }; effect: Omit<VfxEffect, 'id' | 'name'> };

export const VFX_PRESETS: Preset[] = [
  {
    key: 'dust',
    name: { en: 'Dust puff', ru: 'Облачко пыли' },
    effect: {
      duration: 1.2,
      loop: false,
      layers: [
        newEmitter({ id: 'puffs', name: 'Puffs', spawn: 'burst', count: 18, duration: 0.1, life: [0.6, 1.1], area: 'disc', areaSize: 12, spread: 80, speed: [30, 70], gravity: -15, drag: 2.2, size: [8, 14], sizeOverLife: [[0, 0.6], [0.3, 1.2], [1, 1.6]], opacityOverLife: [[0, 0.9], [0.6, 0.7], [1, 0]], colourOverLife: [{ t: 0, colour: '#c6bca9' }, { t: 1, colour: '#8f8676' }] }),
        newShapeAnim({ id: 'ring', name: 'Ground ring', duration: 0.5, keys: [{ t: 0, size: 12, colour: '#d8d0c2', opacity: 0.8, rotation: 0, rise: 1, ease: 'out' }, { t: 0.5, size: 90, colour: '#d8d0c2', opacity: 0, rotation: 0, rise: 1, ease: 'linear' }] }),
      ],
    },
  },
  {
    key: 'sparks',
    name: { en: 'Sparks', ru: 'Искры' },
    effect: {
      duration: 0.8,
      loop: false,
      layers: [newEmitter({ id: 'sparks', name: 'Sparks', spawn: 'burst', count: 24, duration: 0.05, life: [0.3, 0.7], spread: 70, speed: [160, 320], gravity: 500, drag: 0.6, size: [5, 9], alignToMotion: true, look: defaultLook({ shape: 'line' }), sizeOverLife: [[0, 1], [1, 0.4]], opacityOverLife: [[0, 1], [0.8, 1], [1, 0]], colourOverLife: [{ t: 0, colour: '#fff2b8' }, { t: 1, colour: '#f0a442' }] })],
    },
  },
  {
    key: 'rain',
    name: { en: 'Rain', ru: 'Дождь' },
    effect: {
      duration: 2,
      loop: true,
      layers: [newEmitter({ id: 'drops', name: 'Drops', spawn: 'rate', rate: 120, duration: 2, life: [0.9, 1.1], area: 'box', areaSize: 300, rise: 420, spread: 180, speed: [0, 0], gravity: 900, drag: 0, size: [6, 8], alignToMotion: true, look: defaultLook({ shape: 'line' }), opacityOverLife: [[0, 0], [0.1, 0.7], [1, 0.7]], colourOverLife: [{ t: 0, colour: '#7fa7d6' }] })],
    },
  },
  {
    key: 'drip',
    name: { en: 'Drip', ru: 'Капля' },
    effect: {
      duration: 1.4,
      loop: true,
      layers: [
        newEmitter({ id: 'drop', name: 'Drop', spawn: 'burst', rise: 75, count: 1, duration: 0.05, life: [0.5, 0.5], spread: 0, speed: [0, 0], gravity: 600, drag: 0, size: [3, 3], look: defaultLook({ shape: 'circle' }), opacityOverLife: [[0, 1], [1, 1]], colourOverLife: [{ t: 0, colour: '#6a8d9e' }] }),
        newShapeAnim({ id: 'splash', name: 'Splash', start: 0.5, duration: 0.5, keys: [{ t: 0, size: 4, colour: '#6a8d9e', opacity: 1, rotation: 0, rise: 1, ease: 'out' }, { t: 0.5, size: 30, colour: '#6a8d9e', opacity: 0, rotation: 0, rise: 1, ease: 'linear' }] }),
      ],
    },
  },
  {
    key: 'impact',
    name: { en: 'Impact ring', ru: 'Кольцо удара' },
    effect: {
      duration: 0.5,
      loop: false,
      layers: [
        newShapeAnim({ id: 'ring', name: 'Ring', duration: 0.4, look: defaultLook({ shape: 'ring' }), keys: [{ t: 0, size: 8, colour: '#ececec', opacity: 1, rotation: 0, rise: 0, ease: 'out' }, { t: 0.4, size: 60, colour: '#ececec', opacity: 0, rotation: 0, rise: 0, ease: 'linear' }] }),
        newShapeAnim({ id: 'dot', name: 'Dot', duration: 0.2, look: defaultLook({ shape: 'circle' }), keys: [{ t: 0, size: 18, colour: '#ececec', opacity: 1, rotation: 0, rise: 0, ease: 'in' }, { t: 0.2, size: 0, colour: '#ececec', opacity: 1, rotation: 0, rise: 0, ease: 'linear' }] }),
      ],
    },
  },
  {
    key: 'smoke',
    name: { en: 'Smoke', ru: 'Дым' },
    effect: {
      duration: 2,
      loop: true,
      layers: [newEmitter({ id: 'smoke', name: 'Smoke', spawn: 'rate', rate: 14, duration: 2, life: [1.6, 2.4], area: 'disc', areaSize: 6, spread: 15, speed: [30, 50], gravity: -10, drag: 0.4, size: [10, 16], spin: [-30, 30], sizeOverLife: [[0, 0.5], [1, 2.4]], opacityOverLife: [[0, 0], [0.15, 0.8], [1, 0]], colourOverLife: [{ t: 0, colour: '#5e6b55' }, { t: 1, colour: '#3c4238' }] })],
    },
  },
  { key: 'explosion', name: { en: 'Explosion', ru: 'Взрыв' }, effect: explosion },
  {
    key: 'flicker',
    name: { en: 'Light flicker', ru: 'Мерцание' },
    effect: {
      duration: 1,
      loop: true,
      layers: [
        newShapeAnim({
          id: 'flick',
          name: 'Flicker',
          duration: 1,
          look: defaultLook({ shape: 'circle', style: 'soft', blend: 'add' }),
          keys: [
            { t: 0, size: 30, colour: '#ffe6a8', opacity: 0.5, rotation: 0, rise: 0, ease: 'step' },
            { t: 0.15, size: 30, colour: '#ffe6a8', opacity: 0.1, rotation: 0, rise: 0, ease: 'step' },
            { t: 0.25, size: 30, colour: '#ffe6a8', opacity: 0.5, rotation: 0, rise: 0, ease: 'step' },
            { t: 0.7, size: 30, colour: '#ffe6a8', opacity: 0.2, rotation: 0, rise: 0, ease: 'step' },
            { t: 0.78, size: 30, colour: '#ffe6a8', opacity: 0.5, rotation: 0, rise: 0, ease: 'step' },
          ],
        }),
      ],
    },
  },
  {
    key: 'ping',
    name: { en: 'Signal ping', ru: 'Сигнал' },
    effect: {
      duration: 1.5,
      loop: true,
      layers: [0, 0.3, 0.6].map((start, i) =>
        newShapeAnim({ id: `ping${i}`, name: `Wave ${i + 1}`, start, duration: 0.9, look: defaultLook({ shape: 'ring', facing: 'camera' }), keys: [{ t: 0, size: 6, colour: '#8fb04a', opacity: 1, rotation: 0, rise: 0, ease: 'out' }, { t: 0.9, size: 70, colour: '#8fb04a', opacity: 0, rotation: 0, rise: 0, ease: 'linear' }] }),
      ),
    },
  },
];

/** A copy of an effect with fresh layer ids (for presets and duplicates). */
export function cloneEffect(e: Omit<VfxEffect, 'id' | 'name'>, id: string, name: string): VfxEffect {
  const copy = JSON.parse(JSON.stringify(e)) as VfxEffect;
  for (const l of copy.layers) l.id = layerId();
  return { ...copy, id, name };
}

/** The project's effects (none in older files). */
export function effectsOf(settings: { effects?: VfxEffect[] } | undefined): VfxEffect[] {
  return settings?.effects ?? [];
}

// ── Sampling ──

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** A curve's value at `t` (0…1); flat beyond its ends; 1 for an empty curve. */
export function sampleCurve(c: VfxCurve, t: number): number {
  if (!c.length) return 1;
  if (t <= c[0]![0]) return c[0]![1];
  for (let i = 1; i < c.length; i++) {
    const [t1, v1] = c[i]!;
    if (t <= t1) {
      const [t0, v0] = c[i - 1]!;
      const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return v0 + (v1 - v0) * k;
    }
  }
  return c[c.length - 1]![1];
}

/** '#rrggbb' → [r, g, b] (0…1). */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0xffffff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A gradient's colour at `t` (0…1), into `out`. */
export function sampleGradient(g: VfxGradient, t: number, out: [number, number, number] = [1, 1, 1]): [number, number, number] {
  if (!g.length) return ((out[0] = out[1] = out[2] = 1), out);
  let a = g[0]!, b = g[g.length - 1]!;
  if (t <= a.t) b = a;
  else if (t >= b.t) a = b;
  else
    for (let i = 1; i < g.length; i++)
      if (t <= g[i]!.t) {
        a = g[i - 1]!;
        b = g[i]!;
        break;
      }
  const ca = hexRgb(a.colour), cb = hexRgb(b.colour);
  const k = b.t > a.t ? clamp01((t - a.t) / (b.t - a.t)) : 0;
  for (let i = 0; i < 3; i++) out[i] = ca[i]! + (cb[i]! - ca[i]!) * k;
  return out;
}

export function ease(kind: VfxEase, k: number): number {
  k = clamp01(k);
  switch (kind) {
    case 'in':
      return k * k;
    case 'out':
      return 1 - (1 - k) * (1 - k);
    case 'inOut':
      return k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
    case 'step':
      return 0;
    default:
      return k;
  }
}

/** A shape animation's state `t` seconds after the layer starts (null before its first key or after it ends). */
export function sampleKeys(layer: VfxShapeAnim, t: number): { size: number; colour: [number, number, number]; opacity: number; rotation: number; rise: number } | null {
  const keys = layer.keys;
  if (!keys.length || t < 0 || t > layer.duration) return null;
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1]!.t) i++;
  const a = keys[i]!, b = keys[Math.min(i + 1, keys.length - 1)]!;
  if (t < a.t) return null;
  const k = b === a || b.t <= a.t ? 0 : ease(a.ease, (t - a.t) / (b.t - a.t));
  const ca = hexRgb(a.colour), cb = hexRgb(b.colour);
  const mix = (x: number, y: number) => x + (y - x) * k;
  return { size: mix(a.size, b.size), colour: [mix(ca[0], cb[0]), mix(ca[1], cb[1]), mix(ca[2], cb[2])], opacity: mix(a.opacity, b.opacity), rotation: mix(a.rotation, b.rotation), rise: mix(a.rise, b.rise) };
}

/** Whether data looks like an effect (for loading project files). */
export function isEffect(x: unknown): x is VfxEffect {
  const e = x as VfxEffect;
  return !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.duration === 'number' && typeof e.loop === 'boolean' && Array.isArray(e.layers) && e.layers.every((l) => l && (l.kind === 'emitter' || l.kind === 'shape') && typeof l.id === 'string');
}
