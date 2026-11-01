import { beforeAll, describe, expect, it } from 'vitest';
import { fillText, newEntity, newScene, newUiElement, newUiScreen, uiOffset, uiRect, type EntityData, type SceneFile, type UiSettings } from '@cocoaworlds/core';
import { compileScript, type Handler, type Script } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const n = (value: number) => ({ id: Math.random().toString(36), kind: 'number' as const, value });
const tx = (value: string) => ({ id: Math.random().toString(36), kind: 'text' as const, value });
const h = (event: Handler['event'], ...body: Handler['body']): Handler => ({ id: Math.random().toString(36), event, body });

function shop() {
  const screen = { ...newUiScreen('Shop'), freesMouse: true };
  const buy = { ...newUiElement('button'), name: 'Buy', text: 'Buy a seed' };
  const cash = { ...newUiElement('text'), name: 'Cash', text: 'Cash: {Cash}' };
  const note = { ...newUiElement('text'), name: 'Note', text: '', visible: false };
  screen.elements.push(buy, cash, note);
  const hud = { ...newUiScreen('Hotbar'), elements: [newUiElement('hotbar')] };
  const ui: UiSettings = { screens: [screen, hud], items: [{ name: 'Seed', icon: '' }] };
  return { ui, screen, buy, cash, note, hud };
}

function scene(ui: UiSettings, script: Script): SceneFile {
  const s = newScene('test');
  s.settings.ui = ui;
  const shopkeeper: EntityData = newEntity('shopkeeper', { script: script as never });
  s.entities = [shopkeeper];
  return s;
}
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

describe('screen UI and the inventory', () => {
  it('layout: anchors and offsets', () => {
    const e = { anchor: 'bottom-right' as const, x: 10, y: 20, w: 100, h: 50 };
    expect(uiRect(e)).toEqual({ left: 1280 - 110, top: 720 - 70, width: 100, height: 50 });
    expect(uiOffset(e, 1170, 650)).toEqual({ x: 10, y: 20 });
    const c = { anchor: 'center' as const, x: 5, y: -5, w: 100, h: 50 };
    expect(uiRect(c)).toEqual({ left: 595, top: 330, width: 100, height: 50 });
    expect(uiOffset(c, 595, 330)).toEqual({ x: 5, y: -5 });
    expect(fillText('Cash: {Cash}, {health} hp, {nope}', { Cash: 12.5, health: 80 })).toBe('Cash: 12.5, 80 hp, {nope}');
  });

  it('a shop: clicking Buy pays, gives a seed and says so; the shop closes after three; using a seed plants it', () => {
    const { ui, screen, buy, note } = shop();
    const script: Script = {
      version: 1,
      variables: [],
      handlers: [
        h(
          { id: 'c', kind: 'uiClick', element: buy.id },
          { id: 'a', kind: 'change', variable: 'Cash', by: n(-5) },
          { id: 'g', kind: 'giveItem', item: 'Seed', amount: n(1) },
          { id: 's', kind: 'showUi', element: note.id },
          { id: 't', kind: 'setUiText', element: note.id, text: { id: 'j', kind: 'join', a: tx('Seeds: '), b: { id: 'k', kind: 'itemCount', item: 'Seed' } } },
          {
            id: 'i',
            kind: 'if',
            condition: { id: 'q', kind: 'compare', op: '≥', a: { id: 'k2', kind: 'itemCount', item: 'Seed' }, b: n(3) },
            then: [{ id: 'hs', kind: 'hideScreen', screen: screen.id }],
            otherwise: null,
          },
        ),
        h({ id: 'u', kind: 'useItem', item: 'Seed' }, { id: 'tk', kind: 'takeItem', item: 'Seed', amount: n(1) }, { id: 'sy', kind: 'say', text: { id: 'sel', kind: 'selectedItem' }, seconds: n(2) }),
      ],
    };
    const info = {
      objects: new Map([['me', { name: 'me', isZone: false }]]),
      globals: [{ name: 'Cash', type: 'number' as const }],
      ui: { screens: new Map(ui.screens.map((s) => [s.id, s.name])), elements: new Map(ui.screens.flatMap((s) => s.elements.map((e) => [e.id, { name: e.name, kind: e.kind }] as const))) },
      items: new Set(['Seed']),
    };
    expect(compileScript('me', script, info).problems).toEqual([]);

    const w = GameWorld.create(scene(ui, script), { values: [{ name: 'Cash', type: 'number', initial: 20, show: false }] });
    run(w, 0.1);
    let st = w.uiState();
    expect(st.shown.sort()).toEqual([screen.id, ui.screens[1]!.id].sort());
    expect(st.hidden).toEqual([note.id]);
    expect(st.freesMouse).toBe(true);

    w.clickUi(buy.id);
    run(w, 0.1);
    st = w.uiState();
    expect(st.inventory).toEqual([{ item: 'Seed', count: 1 }]);
    expect(st.hidden).toEqual([]);
    expect(st.texts[note.id]).toBe('Seeds: 1');
    expect(w.gameValues()[0]!.value).toBe(15);

    w.clickUi(buy.id);
    run(w, 0.1);
    w.clickUi(buy.id);
    run(w, 0.1);
    st = w.uiState();
    expect(st.inventory).toEqual([{ item: 'Seed', count: 3 }]);
    expect(st.shown).toEqual([ui.screens[1]!.id]);
    expect(st.freesMouse).toBe(false);
    // The shop is closed: its button does nothing now.
    w.clickUi(buy.id);
    run(w, 0.1);
    expect(w.uiState().inventory).toEqual([{ item: 'Seed', count: 3 }]);

    // Using the seed in the picked slot.
    w.useItem();
    run(w, 0.1);
    expect(w.uiState().inventory).toEqual([{ item: 'Seed', count: 2 }]);
    expect(w.screenMessages()).toEqual(['Seed']);
    // An empty slot uses nothing.
    w.selectSlot(1);
    w.useItem();
    run(w, 0.1);
    expect(w.uiState().inventory).toEqual([{ item: 'Seed', count: 2 }]);
    expect(w.uiState().slot).toBe(1);
    w.selectSlot(-1);
    expect(w.uiState().slot).toBe(8);
    w.dispose();
  });

  it('the checker points at missing screens, buttons and items', () => {
    const { ui, cash } = shop();
    const info = {
      objects: new Map(),
      ui: { screens: new Map(ui.screens.map((s) => [s.id, s.name])), elements: new Map(ui.screens.flatMap((s) => s.elements.map((e) => [e.id, { name: e.name, kind: e.kind }] as const))) },
      items: new Set(['Seed']),
    };
    const script: Script = {
      version: 1,
      variables: [],
      handlers: [
        h({ id: 'c', kind: 'uiClick', element: cash.id }),
        h({ id: 's', kind: 'start' }, { id: 'x', kind: 'showScreen', screen: 'gone' }, { id: 'y', kind: 'giveItem', item: 'Gem', amount: n(1) }, { id: 'z', kind: 'hideUi', element: '' }),
      ],
    };
    expect(compileScript('me', script, info).problems.map((p) => p.message)).toEqual([
      'Cash is not a button.',
      'The screen this block points at no longer exists. Pick another one.',
      'There is no item called “Gem”.',
      'Pick something on a screen (make it in the Screens tab).',
    ]);
  });
});
