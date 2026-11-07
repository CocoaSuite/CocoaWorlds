import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneDoc, defaultComponent, newEntity, newScene } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { FoliageRenderer } from '../src/renderer/viewport/foliage';

function field(cover: boolean) {
  const s = newScene('grass');
  s.entities = [newEntity('lawn', { brush: { role: 'solid', faces: toData(box([-1024, -16, -1024], [1024, 0, 1024])).faces } as never, scatter: { ...defaultComponent('scatter'), cover } })];
  const f = new FoliageRenderer();
  f.sync(new SceneDoc(s));
  const blades: THREE.InstancedMesh[] = [], discs: THREE.InstancedMesh[] = [];
  f.group.traverse((o) => {
    if (!(o as THREE.InstancedMesh).isInstancedMesh) return;
    (o.name.includes(':disc') ? discs : blades).push(o as THREE.InstancedMesh);
  });
  return { f, blades, discs };
}

describe('grass root discs', () => {
  it('with the grass layer, only tufts at the edge of the field have one', () => {
    const { f, discs } = field(true);
    const withDisc = discs.filter((d) => d.name.endsWith('disc0')).reduce((n, d) => n + d.count, 0);
    expect(f.count).toBeGreaterThan(100);
    expect(withDisc).toBeGreaterThan(0);
    expect(withDisc).toBeLessThan(f.count * 0.5);
  });

  it('without it, every tuft keeps its disc (nothing else covers the floor)', () => {
    const { blades, discs } = field(false);
    expect(discs).toHaveLength(0);
    expect(blades.length).toBeGreaterThan(0);
  });
});
