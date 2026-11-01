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

export type UiKind = 'panel' | 'text' | 'image' | 'button' | 'bar' | 'hotbar';
export const UI_KINDS: UiKind[] = ['text', 'button', 'panel', 'image', 'bar', 'hotbar'];

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
  const base: UiElement = { id, name: kind, kind, anchor: 'center', x: 0, y: 0, w: 240, h: 48, text: '', size: 22, color: '#ffffff', fill: '', image: '', value: '', max: 100, slots: 9, visible: true };
  switch (kind) {
    case 'text':
      return { ...base, text: 'Text', w: 320, h: 40 };
    case 'button':
      return { ...base, text: 'Button', fill: '#637f2a', w: 200, h: 48 };
    case 'panel':
      return { ...base, fill: '#000000aa', w: 400, h: 300 };
    case 'image':
      return { ...base, w: 128, h: 128 };
    case 'bar':
      return { ...base, fill: '#d94b3d', w: 240, h: 20, value: 'health', max: 100 };
    case 'hotbar':
      return { ...base, anchor: 'bottom', y: 16, w: 9 * 60, h: 60, slots: 9, size: 14 };
  }
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
    names.add(i.name);
  }
  return null;
}
