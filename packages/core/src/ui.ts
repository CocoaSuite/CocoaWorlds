/**
 * Screen UI (B5): screens of text, images, buttons, bars and a hotbar laid out in anchored boxes, and the items
 * the player can carry. Both are saved in the scene's settings (`settings.ui`), so editing them is undoable.
 *
 * Layout is in a reference screen of 1280 × 720: in the game everything is scaled by the window's height / 720,
 * so a layout looks the same at any size. An element hangs from one of nine anchors; `x` and `y` are how far it
 * sits in from the anchored edges (for the middle anchors, how far it is shifted from the middle).
 */

export const UI_REF_W = 1280;
export const UI_REF_H = 720;

export type UiAnchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
export const UI_ANCHORS: UiAnchor[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

export type UiKind = 'panel' | 'text' | 'image' | 'button' | 'bar' | 'hotbar' | 'list';
export const UI_KINDS: UiKind[] = ['text', 'button', 'panel', 'image', 'bar', 'list', 'hotbar'];

export interface UiElement {
  id: string;
  name: string;
  kind: UiKind;
  anchor: UiAnchor;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text and buttons: what it says. `{Cash}` shows a game value, `{health}` and `{score}` the player's. */
  text: string;
  /** Text size in reference pixels. */
  size: number;
  /** Text colour. */
  color: string;
  /** Background (panels, buttons, text boxes; '' for none) or a bar's fill. */
  fill: string;
  /** Images: a texture from the project (`assets/textures/…`). */
  image: string;
  /** Bars: what they show (a game value's name, 'health' or 'score') and their full amount. */
  value: string;
  max: number;
  /** Hotbars: how many slots. */
  slots: number;
  /** Shown when the screen is (scripts can hide and show it). */
  visible: boolean;
  /**
   * The element it sits inside ('' for the screen itself): it is placed within that element's box, as if the
   * box were the screen, and hidden with it.
   */
  parent: string;
  /** Texts, buttons and lists: where the words sit. */
  align: 'left' | 'center' | 'right';
  /** Lists: their own rows (scripts can add and remove), or the player's inventory (an item per row). */
  source: 'rows' | 'inventory';
  rows: string[];
  /** Lists: rows side by side (2 or more makes a grid of tiles), and each row's height. */
  columns: number;
  rowHeight: number;
}

export interface UiScreen {
  id: string;
  name: string;
  /** Shown when the game starts. */
  shownAtStart: boolean;
  /** While shown, the mouse is free for clicking buttons (a shop or a menu) instead of turning the view. */
  freesMouse: boolean;
  elements: UiElement[];
}

/** Something the player can carry (in the inventory, shown in a hotbar). */
export interface ItemDef {
  name: string;
  /** A texture from the project to show in the hotbar ('' for the name's first letters). */
  icon: string;
  /** Held in the hotbar, the item is a weapon: clicking (or holding, if automatic) fires it. */
  weapon?: WeaponDef;
}

/**
 * A weapon (A1). Bullets hit at once along the view; projectiles fly (rockets straight, grenades in an arc);
 * melee hits what is within reach. A blast hurts and pushes everything around where it lands, the player
 * included, less with distance and not through walls.
 */
export interface WeaponDef {
  kind: 'bullet' | 'projectile' | 'melee';
  /** Damage of each hit (each pellet, for a shotgun), or at the middle of a blast. */
  damage: number;
  /** Shots a second at most. */
  rate: number;
  /** Keeps firing while the button is held. */
  automatic: boolean;
  /** How far bullets and swings reach (units). */
  range: number;
  /** How far shots stray from the crosshair (degrees). */
  spread: number;
  /** Bullets per shot (6 or more for a shotgun). */
  pellets: number;
  /** The item each shot uses up ('' for none: a crowbar). */
  ammo: string;
  /** Projectiles: how fast they fly (units a second), and whether they fall (grenades). */
  speed: number;
  arc: boolean;
  /** Blast radius where it hits (0: no blast). */
  blast: number;
  /** How hard hits push physics objects. */
  push: number;
  /** A project sound played on each shot ('' for none). */
  sound: string;
}

/** Ready-made weapons, Half-Life's numbers. */
export const WEAPON_PRESETS: Record<string, WeaponDef> = {
  crowbar: { kind: 'melee', damage: 10, rate: 2.5, automatic: true, range: 64, spread: 0, pellets: 1, ammo: '', speed: 0, arc: false, blast: 0, push: 200, sound: '' },
  pistol: { kind: 'bullet', damage: 8, rate: 4, automatic: false, range: 8192, spread: 1, pellets: 1, ammo: '9mm', speed: 0, arc: false, blast: 0, push: 150, sound: '' },
  smg: { kind: 'bullet', damage: 5, rate: 10, automatic: true, range: 8192, spread: 3, pellets: 1, ammo: '9mm', speed: 0, arc: false, blast: 0, push: 100, sound: '' },
  shotgun: { kind: 'bullet', damage: 5, rate: 1.3, automatic: false, range: 2048, spread: 5, pellets: 6, ammo: 'Shells', speed: 0, arc: false, blast: 0, push: 120, sound: '' },
  rocket: { kind: 'projectile', damage: 100, rate: 0.6, automatic: false, range: 0, spread: 0, pellets: 1, ammo: 'Rockets', speed: 1000, arc: false, blast: 160, push: 900, sound: '' },
  grenade: { kind: 'projectile', damage: 100, rate: 1, automatic: false, range: 0, spread: 0, pellets: 1, ammo: 'Grenades', speed: 500, arc: true, blast: 160, push: 700, sound: '' },
};

export const newWeapon = (preset = 'pistol'): WeaponDef => ({ ...(WEAPON_PRESETS[preset] ?? WEAPON_PRESETS.pistol!) });

/** A weapon with every field present (older or hand-edited data). */
export function weaponOf(w: Partial<WeaponDef> | undefined): WeaponDef | null {
  if (!w) return null;
  const d = WEAPON_PRESETS.pistol!;
  const num = (v: unknown, def: number, min = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : def);
  return {
    kind: w.kind === 'projectile' || w.kind === 'melee' ? w.kind : 'bullet',
    damage: num(w.damage, d.damage),
    rate: num(w.rate, d.rate, 0.05),
    automatic: !!w.automatic,
    range: num(w.range, d.range, 1),
    spread: num(w.spread, 0),
    pellets: Math.max(1, Math.round(num(w.pellets, 1, 1))),
    ammo: typeof w.ammo === 'string' ? w.ammo : '',
    speed: num(w.speed, 1000, 1),
    arc: !!w.arc,
    blast: num(w.blast, 0),
    push: num(w.push, 0),
    sound: typeof w.sound === 'string' ? w.sound : '',
  };
}

export interface UiSettings {
  screens: UiScreen[];
  items: ItemDef[];
}

export const emptyUi = (): UiSettings => ({ screens: [], items: [] });

/** A scene's UI with everything filled in (older files have none). */
export function uiOf(settings: { ui?: Partial<UiSettings> } | undefined): UiSettings {
  const ui = settings?.ui;
  return {
    screens: Array.isArray(ui?.screens) ? ui.screens.map((s) => ({ ...s, elements: (s.elements ?? []).map((e) => ({ ...newUiElement(e.kind ?? 'text', e.id ?? 'x'), ...e })) })) : [],
    items: Array.isArray(ui?.items) ? ui.items : [],
  };
}

const rid = () => Math.random().toString(36).slice(2, 10);

export function newUiScreen(name: string): UiScreen {
  return { id: `s_${rid()}`, name, shownAtStart: true, freesMouse: false, elements: [] };
}

/** A new element of a kind, with sensible defaults (in the middle of the screen). */
export function newUiElement(kind: UiKind, id = `u_${rid()}`): UiElement {
  const base: UiElement = {
    id,
    name: kind,
    kind,
    anchor: 'center',
    x: 0,
    y: 0,
    w: 240,
    h: 48,
    text: '',
    size: 22,
    color: '#ffffff',
    fill: '',
    image: '',
    value: '',
    max: 100,
    slots: 9,
    visible: true,
    parent: '',
    align: 'center',
    source: 'rows',
    rows: [],
    columns: 1,
    rowHeight: 40,
  };
  switch (kind) {
    case 'text':
      return { ...base, text: 'Text', w: 320, h: 40 };
    case 'button':
      return { ...base, text: 'Button', fill: '#637f2a', w: 200, h: 48 };
    case 'panel':
      return { ...base, fill: '#000000aa', w: 480, h: 400 };
    case 'image':
      return { ...base, w: 128, h: 128 };
    case 'bar':
      return { ...base, fill: '#d94b3d', w: 240, h: 20, value: 'health', max: 100 };
    case 'hotbar':
      return { ...base, anchor: 'bottom', y: 16, w: 9 * 60, h: 60, slots: 9, size: 14 };
    case 'list':
      return { ...base, w: 320, h: 160, fill: '#000000aa', size: 18, align: 'left', rows: ['First', 'Second', 'Third'], rowHeight: 40 };
  }
}

/**
 * Every element's box on a screen of `w` × `h`, with elements inside others placed within their parent's box
 * (a parent that is missing, or a loop of parents, counts as the screen).
 */
export function uiRects(elements: UiElement[], w = UI_REF_W, h = UI_REF_H): Map<string, { left: number; top: number; width: number; height: number }> {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = new Map<string, { left: number; top: number; width: number; height: number }>();
  const place = (e: UiElement, seen: Set<string>): { left: number; top: number; width: number; height: number } => {
    const done = out.get(e.id);
    if (done) return done;
    const p = e.parent && !seen.has(e.parent) ? byId.get(e.parent) : undefined;
    const space = p ? place(p, new Set([...seen, e.id])) : { left: 0, top: 0, width: w, height: h };
    const r = uiRect(e, space.width, space.height);
    const box = { left: space.left + r.left, top: space.top + r.top, width: r.width, height: r.height };
    out.set(e.id, box);
    return box;
  };
  for (const e of elements) place(e, new Set([e.id]));
  return out;
}

/** Whether an element shows, given which elements are hidden: it and everything it sits inside. */
export function uiShown(e: UiElement, elements: UiElement[], hidden: (id: string) => boolean): boolean {
  const byId = new Map(elements.map((x) => [x.id, x]));
  const seen = new Set<string>();
  for (let x: UiElement | undefined = e; x && !seen.has(x.id); x = x.parent ? byId.get(x.parent) : undefined) {
    if (hidden(x.id)) return false;
    seen.add(x.id);
  }
  return true;
}

/** Where an element sits on a screen of `w` × `h` reference pixels: its left, top, width and height. */
export function uiRect(e: Pick<UiElement, 'anchor' | 'x' | 'y' | 'w' | 'h'>, w = UI_REF_W, h = UI_REF_H): { left: number; top: number; width: number; height: number } {
  const col = e.anchor.endsWith('left') || e.anchor === 'left' ? 0 : e.anchor.endsWith('right') || e.anchor === 'right' ? 2 : 1;
  const row = e.anchor.startsWith('top') ? 0 : e.anchor.startsWith('bottom') ? 2 : 1;
  const left = col === 0 ? e.x : col === 2 ? w - e.x - e.w : (w - e.w) / 2 + e.x;
  const top = row === 0 ? e.y : row === 2 ? h - e.y - e.h : (h - e.h) / 2 + e.y;
  return { left, top, width: e.w, height: e.h };
}

/** The x and y that put an element's top-left corner at (left, top) for its anchor (the inverse of uiRect). */
export function uiOffset(e: Pick<UiElement, 'anchor' | 'w' | 'h'>, left: number, top: number, w = UI_REF_W, h = UI_REF_H): { x: number; y: number } {
  const col = e.anchor.endsWith('left') || e.anchor === 'left' ? 0 : e.anchor.endsWith('right') || e.anchor === 'right' ? 2 : 1;
  const row = e.anchor.startsWith('top') ? 0 : e.anchor.startsWith('bottom') ? 2 : 1;
  const x = col === 0 ? left : col === 2 ? w - left - e.w : left - (w - e.w) / 2;
  const y = row === 0 ? top : row === 2 ? h - top - e.h : top - (h - e.h) / 2;
  return { x, y };
}

/** Text with `{Name}` replaced by values ({Cash}, {health}, {score}); unknown names are left as they are. */
export function fillText(text: string, values: Record<string, unknown>): string {
  return text.replace(/\{([^{}]+)\}/g, (all, name: string) => {
    const v = values[name.trim()];
    if (v === undefined) return all;
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return v === null ? '' : String(v);
  });
}

/** Problems with a scene's UI data (for loading files). */
export function validateUi(ui: unknown): string | null {
  if (ui === undefined) return null;
  if (typeof ui !== 'object' || ui === null) return 'The screen UI must be an object.';
  const u = ui as { screens?: unknown; items?: unknown };
  if (u.screens !== undefined && !Array.isArray(u.screens)) return 'Screens must be a list.';
  if (u.items !== undefined && !Array.isArray(u.items)) return 'Items must be a list.';
  for (const s of (u.screens as unknown[]) ?? []) {
    const sc = s as Partial<UiScreen>;
    if (typeof sc?.id !== 'string' || typeof sc.name !== 'string' || !Array.isArray(sc.elements)) return 'Each screen needs an id, a name and a list of elements.';
    for (const e of sc.elements) if (typeof e?.id !== 'string' || !UI_KINDS.includes(e.kind) || !UI_ANCHORS.includes(e.anchor)) return `An element of the screen ${sc.name} is not valid.`;
  }
  const names = new Set<string>();
  for (const it of (u.items as unknown[]) ?? []) {
    const i = it as Partial<ItemDef>;
    if (typeof i?.name !== 'string' || !i.name.trim()) return 'Each item needs a name.';
    if (names.has(i.name)) return `Two items are called ${i.name}.`;
    if (i.weapon !== undefined && (typeof i.weapon !== 'object' || i.weapon === null)) return `The weapon settings of ${i.name} are not valid.`;
    names.add(i.name);
  }
  return null;
}
