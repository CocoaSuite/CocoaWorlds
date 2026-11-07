/**
 * Base building (comfort and safety, no structural integrity): what a build piece is, as plain JSON.
 *
 * A piece is placed on an edge of the build grid as a ghost "build site", then advanced stage by stage. Every
 * stage is one short, readable action: `place` (tap E, one item per tap), `tap` (tap E with a tool, N hits),
 * `hold` (hold E for `duration` seconds), `pour` (hold E with a bucket), `wait` (an in-game timer, e.g. curing).
 * New materials are new JSON files: nothing here knows about wood or concrete.
 */

export type StageAction = 'place' | 'tap' | 'hold' | 'pour' | 'wait';
export const STAGE_ACTIONS: StageAction[] = ['place', 'tap', 'hold', 'pour', 'wait'];

export interface StageDef {
  id: string;
  action: StageAction;
  /** Shown in the prompt (falls back to the action and item). */
  label: string;
  /** An item used up per step (missing: none). */
  item: string;
  /** How many of `item` each step uses. */
  use: number;
  /** An alternative to `item` (e.g. a reusable mold, or 4 planks). */
  or: { item: string; use: number } | null;
  /** An item that must be in hand (the picked hotbar slot) and is not used up. */
  tool: string;
  /** Steps: taps, items placed, or holds of `duration` (each hold uses `use` of `item`). */
  count: number;
  /** Seconds per hold/pour step, or the timer of a `wait`. */
  duration: number;
  /** Items given back when the stage is done (a stripped mold). */
  gives: Record<string, number>;
  /** A feature the piece gains when the stage is done (`leaf`, `bolt`, `shutters`). */
  adds: string;
  /** Can be skipped: the piece works without it (only at the end of the list). */
  optional: boolean;
  /** Icon name for the HUD (missing: from the action). */
  icon: string;
  /** A sound per step (project path; '' none). */
  sound: string;
}

/** One box of a piece's look, in edge space: x along the edge (0…grid), y up from the ground, z across. */
export interface PartDef {
  id: string;
  at: [number, number, number];
  size: [number, number, number];
  color: string;
  /** A project material by name ('' : the flat colour). */
  material: string;
  /** Shown once this stage has `step` steps done (0: once it is the current stage). Missing: always. */
  from: string;
  step: number;
  /** Hidden again once this stage is done (a mold). */
  until: string;
  /** Needs this feature (the door leaf, shutters, the bolt). */
  feature: string;
  /** Stands on the ground under itself (posts on uneven ground; the ground is never changed). */
  ground: boolean;
  /** Sinks this far over a stage (posts driven in). */
  sink: { stage: string; depth: number } | null;
  /** Grows up from the bottom over a stage (poured concrete). */
  fill: string;
  /** Swings open about a hinge (x, z in edge space) by `angle` degrees when the piece is open. */
  swing: { hinge: [number, number]; angle: number } | null;
  /** Slides along x by this much when locked (the bolt). */
  slide: number;
  /** Blocks the player when shown (and, for a swinging part, closed). */
  solid: boolean;
  /** Drawn as a ghost before it is built (missing: yes, unless it has `until`). */
  ghost: boolean;
}

export interface PieceDef {
  id: string;
  label: string;
  /** The hotbar item that places it (a plan). */
  blueprint: string;
  /** Whether placing uses the blueprint up. */
  consumeBlueprint: boolean;
  /** Snap: on a grid edge, standing on the ground. */
  snap: 'edge';
  stages: StageDef[];
  mesh: { parts: PartDef[] };
  /** The feature that makes it open and close (`leaf`, `shutters`), and the one that locks it (`bolt`). */
  opens: string;
  locks: string;
  /** When this edge counts as closed for sealing a room: built, plus features it needs, plus shut. */
  seal: { needs: string[]; closed: boolean };
  /** Kind for the horror hooks: wall, door, window. */
  kind: string;
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const v3 = (v: unknown, d: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? (v as [number, number, number]) : d;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function readStage(raw: unknown, i: number, suffix: string): StageDef {
  const s = obj(raw);
  const action = STAGE_ACTIONS.includes(s.action as StageAction) ? (s.action as StageAction) : 'tap';
  const or = s.or ? obj(s.or) : null;
  const gives: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(s.gives))) if (typeof n === 'number' && n > 0) gives[k] = Math.round(n);
  return {
    id: str(s.id, `stage${i}`) + suffix,
    action,
    label: str(s.label),
    item: str(s.item),
    use: Math.max(0, Math.round(num(s.use, 1))),
    or: or && str(or.item) ? { item: str(or.item), use: Math.max(1, Math.round(num(or.use, 1))) } : null,
    tool: str(s.tool),
    count: Math.max(1, Math.round(num(s.count, 1))),
    duration: Math.max(0, num(s.duration, action === 'hold' || action === 'pour' ? 1.5 : action === 'wait' ? 60 : 0)),
    gives,
    adds: str(s.adds),
    optional: s.optional === true,
    icon: str(s.icon),
    sound: str(s.sound),
  };
}

/** Stages with `{ "repeat": n, "stages": [...] }` groups spelled out (ids get `_1`, `_2`, …). */
function expandStages(list: unknown[]): StageDef[] {
  const out: StageDef[] = [];
  for (const raw of list) {
    const g = obj(raw);
    if (Array.isArray(g.stages)) {
      const n = Math.max(1, Math.round(num(g.repeat, 1)));
      for (let r = 1; r <= n; r++) for (const s of g.stages) out.push(readStage(s, out.length, `_${r}`));
    } else out.push(readStage(raw, out.length, ''));
  }
  return out;
}

function readPart(raw: unknown, i: number): PartDef {
  const p = obj(raw);
  const sink = p.sink ? obj(p.sink) : null;
  const swing = p.swing ? obj(p.swing) : null;
  const until = str(p.until);
  return {
    id: str(p.id, `part${i}`),
    at: v3(p.at, [0, 0, 0]),
    size: v3(p.size, [8, 8, 8]),
    color: str(p.color, '#8a8a8a'),
    material: str(p.material),
    from: str(p.from),
    step: Math.max(0, Math.round(num(p.step, 1))),
    until,
    feature: str(p.feature),
    ground: p.ground === true,
    sink: sink && str(sink.stage) ? { stage: str(sink.stage), depth: num(sink.depth, 0) } : null,
    fill: str(p.fill),
    swing: swing ? { hinge: (Array.isArray(swing.hinge) && swing.hinge.length === 2 ? swing.hinge : [0, 0]) as [number, number], angle: num(swing.angle, 90) } : null,
    slide: num(p.slide, 0),
    solid: p.solid !== false,
    ghost: typeof p.ghost === 'boolean' ? p.ghost : !until,
  };
}

/** A piece from its JSON, with defaults filled in. Throws on what can't work (no id, unknown stage references). */
export function readPieceDef(raw: unknown): PieceDef {
  const d = obj(raw);
  const id = str(d.id);
  if (!id) throw new Error('A build piece needs an "id".');
  const stages = expandStages(Array.isArray(d.stages) ? d.stages : []);
  if (!stages.length) throw new Error(`Build piece "${id}" has no stages.`);
  // Optional stages only at the end: the piece is finished once the rest are done.
  const firstOptional = stages.findIndex((s) => s.optional);
  if (firstOptional >= 0 && stages.slice(firstOptional).some((s) => !s.optional)) throw new Error(`Build piece "${id}": optional stages must come last.`);
  const mesh = obj(d.mesh);
  const parts = (Array.isArray(mesh.parts) ? mesh.parts : []).map(readPart);
  const ids = new Set(stages.map((s) => s.id));
  for (const p of parts)
    for (const ref of [p.from, p.until, p.fill, p.sink?.stage ?? ''])
      if (ref && !ids.has(ref)) throw new Error(`Build piece "${id}": part "${p.id}" names stage "${ref}", which it doesn't have.`);
  const seal = obj(d.seal);
  return {
    id,
    label: str(d.label, id),
    blueprint: str(d.blueprint, `${id} plan`),
    consumeBlueprint: d.consumeBlueprint === true,
    snap: 'edge',
    stages,
    mesh: { parts },
    opens: str(d.opens),
    locks: str(d.locks),
    seal: { needs: Array.isArray(seal.needs) ? seal.needs.filter((x): x is string => typeof x === 'string') : [], closed: seal.closed === true },
    kind: str(d.kind, 'wall'),
  };
}

/** Base-wide settings (comfort weights, sealing, sleep, the chair wedge, the knock), from `base.json`. */
export interface BaseConfig {
  /** Grid cell size (u). */
  grid: number;
  /** How far E reaches a build site, and how far a plan places one. */
  reach: number;
  placeReach: number;
  seal: { lowpass: number; outsideVolume: number; windVolume: number };
  comfort: {
    sealed: number;
    light: number;
    maxLights: number;
    /** Points per object with this tag inside the room (`fireplace`, `bed`, `chair`, `personal`…). */
    tags: Record<string, number>;
    /** Points per object with this component inside (`seat`). */
    components: Record<string, number>;
    wedged: number;
    locked: number;
    max: number;
    /** Sleeping (and saving) needs at least this. */
    sleep: number;
    /** How often it is worked out again (s): lights get carried about. */
    every: number;
  };
  ambience: { music: number; fire: number; fireTag: string };
  sleep: { tags: string[]; hours: number; saveOn: 'sleep' | 'always'; uneasy: string; slept: string };
  wedge: { tags: string[]; components: string[]; unwedgeChance: number; sound: string; prompt: string };
  knock: { every: number; chance: number; sound: string; volume: number; range: number };
}

export function readBaseConfig(raw: unknown, over: unknown = {}): BaseConfig {
  const merge = (a: unknown, b: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...obj(a) };
    for (const [k, v] of Object.entries(obj(b))) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v) : v;
    return out;
  };
  const c = merge(raw, over);
  const sub = (k: string) => obj(c[k]);
  const nums = (v: unknown) => Object.fromEntries(Object.entries(obj(v)).filter(([, n]) => typeof n === 'number')) as Record<string, number>;
  const strs = (v: unknown, d: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : d);
  const seal = sub('seal'), comfort = sub('comfort'), amb = sub('ambience'), sleep = sub('sleep'), wedge = sub('wedge'), knock = sub('knock');
  return {
    grid: Math.max(8, num(c.grid, 96)),
    reach: num(c.reach, 110),
    placeReach: num(c.placeReach, 240),
    seal: { lowpass: num(seal.lowpass, 900), outsideVolume: num(seal.outsideVolume, 0.45), windVolume: num(seal.windVolume, 0.15) },
    comfort: {
      sealed: num(comfort.sealed, 35),
      light: num(comfort.light, 15),
      maxLights: num(comfort.maxLights, 3),
      tags: nums(comfort.tags),
      components: nums(comfort.components),
      wedged: num(comfort.wedged, 5),
      locked: num(comfort.locked, 5),
      max: num(comfort.max, 100),
      sleep: num(comfort.sleep, 55),
      every: Math.max(0.1, num(comfort.every, 0.5)),
    },
    ambience: { music: num(amb.music, 0.35), fire: num(amb.fire, 0.6), fireTag: str(amb.fireTag, 'fireplace') },
    sleep: {
      tags: strs(sleep.tags, ['bed']),
      hours: num(sleep.hours, 8),
      saveOn: sleep.saveOn === 'always' ? 'always' : 'sleep',
      uneasy: str(sleep.uneasy, 'Too uneasy to sleep here.'),
      slept: str(sleep.slept, ''),
    },
    wedge: {
      tags: strs(wedge.tags, ['chair']),
      components: strs(wedge.components, ['seat']),
      unwedgeChance: Math.max(0, Math.min(1, num(wedge.unwedgeChance, 0.08))),
      sound: str(wedge.sound),
      prompt: str(wedge.prompt, 'Wedge under the handle'),
    },
    knock: { every: Math.max(1, num(knock.every, 120)), chance: Math.max(0, Math.min(1, num(knock.chance, 0.3))), sound: str(knock.sound), volume: num(knock.volume, 0.9), range: num(knock.range, 900) },
  };
}
