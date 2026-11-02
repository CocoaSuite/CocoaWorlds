// R1: Repeat groups expanded into copies.
import { describe, expect, it } from 'vitest';
import { expandRepeats, newEntity, newScene, ownerOf, repeatEnd, repeatLayout, SceneDoc, type EntityData, type Vec3 } from '../src';

/** Stand-in brushes: a `box` component with its own-space bounds. */
const boundsOf = (e: EntityData) => (e.components.box as { min: Vec3; max: Vec3 } | undefined) ?? null;
const part = (name: string, parent: string, min: Vec3, max: Vec3, extra: Record<string, unknown> = {}) => ({ ...newEntity(name, { box: { min, max } as never, ...extra }), parent });

function ladder(length: number, fit: 'whole' | 'stretch' = 'whole') {
  const g = newEntity('ladder', {});
  const seg = part('rung', g.id, [0, 0, 0], [32, 16, 4], { script: { handlers: [] } as never });
  const top = part('top', g.id, [0, 16, 0], [32, 24, 4]);
  const zone = { ...part('zone', seg.id, [0, 0, -16], [32, 16, 0]) };
  g.components.repeat = { segment: seg.id, endCap: top.id, length, fit } as never;
  const s = newScene('t');
  s.entities = [g, seg, top, zone];
  return { s, g, seg, top, zone };
}

describe('repeat', () => {
  it('layout: whole segments snap; stretch fits exactly', () => {
    expect(repeatLayout({ length: 64, fit: 'whole', gap: 0 }, 16)).toEqual({ count: 4, spacing: 16, scale: 1 });
    expect(repeatLayout({ length: 70, fit: 'whole', gap: 0 }, 16).count).toBe(4);
    const st = repeatLayout({ length: 70, fit: 'stretch', gap: 0 }, 16);
    expect(st.count).toBe(4);
    expect(st.count * 16 * st.scale).toBeCloseTo(70, 6);
    expect(repeatLayout({ length: 1, fit: 'whole', gap: 0 }, 16).count).toBe(1);
  });

  it('copies the segment (and what is inside it) along the axis, and moves the end cap out', () => {
    const { s, g, seg, top, zone } = ladder(64);
    const out = expandRepeats(s, boundsOf);
    const copies = out.entities.filter((e) => e.tags.includes('generated'));
    // Three more segments, each with its zone.
    expect(copies.length).toBe(6);
    const segs = out.entities.filter((e) => e.parent === g.id && (e.id === seg.id || ownerOf(e.id) === g.id) && e.name === 'rung');
    expect(segs.map((e) => e.transform.position[1]).sort((a, b) => a - b)).toEqual([0, 16, 32, 48]);
    expect(out.entities.find((e) => e.id === top.id)!.transform.position[1]).toBe(48);
    // A copied zone sits inside its copied segment; copies have no scripts; ids say whose they are.
    const z2 = copies.find((e) => e.name === 'zone')!;
    expect(out.entities.find((e) => e.id === z2.parent)!.name).toBe('rung');
    expect(copies.every((e) => !e.components.script && ownerOf(e.id) === g.id)).toBe(true);
    expect(z2.id.endsWith(zone.id)).toBe(true);
    // The input is left alone; scenes without repeats come back as they are.
    expect(s.entities.length).toBe(4);
    const plain = newScene('p');
    expect(expandRepeats(plain, boundsOf)).toBe(plain);
  });

  it('stretch scales the segments along the axis; the handle sits at the end', () => {
    const { s, g, top } = ladder(70, 'stretch');
    const out = expandRepeats(s, boundsOf);
    const capY = out.entities.find((e) => e.id === top.id)!.transform.position[1];
    expect(capY).toBeCloseTo(70 - 16, 6);
    expect(repeatEnd(new SceneDoc(s), g.id, boundsOf)![1]).toBeCloseTo(70, 6);
  });
});
