import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  SceneDoc,
  applyMat4,
  composeTransform,
  decomposeMat4,
  invertMat4,
  isIdentityMat4,
  migrateScene,
  multiplyMat4,
  newEntity,
  newScene,
  type Transform,
  type Vec3,
} from '../src';

const close = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(eps)));

describe('matrices', () => {
  const t: Transform = { position: [10, -20, 30], rotation: [30, 45, -60], scale: [2, 2, 2] };

  it('compose then decompose gives the transform back', () => {
    const d = decomposeMat4(composeTransform(t));
    close(d.position, t.position);
    close(d.rotation, t.rotation, 1e-3);
    close(d.scale, t.scale);
  });

  it('rotates in YXZ order: yaw 90° turns +X into −Z', () => {
    const m = composeTransform({ position: [0, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1] });
    close(applyMat4(m, [1, 0, 0]), [0, 0, -1]);
  });

  it('inverse undoes the transform', () => {
    const m = composeTransform(t);
    const p: Vec3 = [3, 4, 5];
    close(applyMat4(invertMat4(m)!, applyMat4(m, p)), p);
    expect(isIdentityMat4(multiplyMat4(m, invertMat4(m)!), 1e-9)).toBe(true);
  });

  it('decomposes mirrored scales', () => {
    const d = decomposeMat4(composeTransform({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [-1, 2, 3] }));
    close(d.scale, [-1, 2, 3]);
  });
});

describe('nested transforms in a scene', () => {
  it('world matrix chains parents', () => {
    const doc = new SceneDoc(newScene('t'));
    const room = newEntity('room', { group: {} }, { position: [100, 0, 0], rotation: [0, 90, 0] });
    const lamp = newEntity('lamp', { light: {} }, { position: [10, 20, 0] });
    lamp.parent = room.id;
    doc.insert([room, lamp]);
    // Yaw 90° turns local +X into world −Z.
    close(applyMat4(doc.worldMatrix(lamp.id), [0, 0, 0]), [100, 20, -10]);
    close(applyMat4(doc.parentMatrix(lamp.id), [0, 0, 0]), [100, 0, 0]);
    expect(isIdentityMat4(doc.parentMatrix(room.id))).toBe(true);
  });
});

describe('format 1 → 2', () => {
  const v1 = (entities: unknown[]) => ({ schemaVersion: 1, id: 'scene0000000000a', name: 's', settings: {}, entities });
  const ent = (id: string, parent: string | null, position: Vec3, components: Record<string, unknown> = {}, rotation: Vec3 = [0, 0, 0]) => ({
    id,
    name: id,
    parent,
    transform: { position, rotation, scale: [1, 1, 1] },
    components,
    visible: true,
    locked: false,
  });
  const face = (points: Vec3[]) => ({ material: 'dev/grid', offset: [0, 0], scale: [0.25, 0.25], rotation: 0, align: 'world', points });

  it('groups get an identity transform and nothing moves', () => {
    const brush = { role: 'solid', faces: [face([[0, 0, 0], [0, 0, 16], [16, 0, 0]])] };
    const { data, migrated } = migrateScene(
      v1([ent('room', null, [16, 0, 16], { group: {} }), ent('wall', 'room', [0, 0, 0], { brush }), ent('lamp', 'room', [64, 100, 64], { light: {} })]),
    );
    expect(migrated).toBe(true);
    expect(data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const out = data.entities as ReturnType<typeof ent>[];
    expect(out[0]!.transform.position).toEqual([0, 0, 0]);
    expect(out[1]!.components.brush).toEqual(brush); // exact: parent space is still the world
    expect(out[2]!.transform.position).toEqual([64, 100, 64]);
  });

  it('children of a placed entity are re-expressed relative to it', () => {
    const brush = { role: 'solid', faces: [face([[100, 0, 0], [100, 0, 16], [116, 0, 0]])] };
    const { data } = migrateScene(v1([ent('lamp', null, [100, 50, 0], { light: {} }, [0, 90, 0]), ent('bulb', 'lamp', [100, 60, 10], { light: {} }), ent('shade', 'lamp', [0, 0, 0], { brush })]));
    const out = data.entities as ReturnType<typeof ent>[];
    const doc = new SceneDoc({ ...(data as never) });
    // The child stays where it was in the world.
    close(applyMat4(doc.worldMatrix('bulb'), [0, 0, 0]), [100, 60, 10]);
    // Brush points move into the lamp's space; mapped back they are the original points.
    const pts = (out[2]!.components.brush as { faces: { points: Vec3[] }[] }).faces[0]!.points;
    const W = doc.parentMatrix('shade');
    const back = pts.map((p) => applyMat4(W, p));
    close(back.flat(), [100, 0, 0, 100, 0, 16, 116, 0, 0].map(Number), 1e-2);
  });
});
