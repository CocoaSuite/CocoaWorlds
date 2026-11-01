import { describe, expect, it } from 'vitest';
import { COMPONENTS, addableComponents, componentDef, defaultComponent, readComponent } from '../src';

describe('component registry', () => {
  it('every field has a default, a label in both languages, and enum defaults are valid', () => {
    for (const c of COMPONENTS) {
      expect(c.label.en && c.label.ru).toBeTruthy();
      for (const f of c.fields) {
        expect(f.default).not.toBeUndefined();
        expect(f.label.en && f.label.ru).toBeTruthy();
        if (f.type.kind === 'enum') expect(f.type.options.map((o) => o.value)).toContain(f.default);
      }
    }
  });

  it('fills in missing fields and keeps unknown ones', () => {
    const d = readComponent('rigidBody', { motion: 'fixed', custom: 1 });
    expect(d).toMatchObject({ motion: 'fixed', mass: 10, friction: 0.6, custom: 1 });
    expect(defaultComponent('trigger')).toEqual({ detects: 'player', once: false });
  });

  it('offers only what fits: brushes vs point objects, conflicts, no duplicates, no internal ones', () => {
    const brush = { brush: {} };
    const names = (c: Record<string, unknown>, isBrush: boolean) => addableComponents(c, isBrush).map((x) => x.name).sort();
    expect(names(brush, true)).toEqual(['breakable', 'conveyor', 'rigidBody', 'script', 'sound', 'trigger']);
    expect(names({ ...brush, trigger: {} }, true)).toEqual(['breakable', 'script', 'sound']);
    expect(names({ ...brush, rigidBody: {} }, true)).toEqual(['breakable', 'script', 'sound']);
    expect(names({}, false)).toEqual(['breakable', 'collider', 'light', 'model', 'playerSpawn', 'rigidBody', 'script', 'sign', 'sound']);
    expect(names({ light: {} }, false)).toEqual(['breakable', 'collider', 'model', 'playerSpawn', 'rigidBody', 'script', 'sign', 'sound']);
    expect(componentDef('group')?.internal).toBe(true);
  });
});
