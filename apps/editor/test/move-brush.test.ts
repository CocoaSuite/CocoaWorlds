// Moving a brush moves what is inside it (a timer sign on a bomb), down through brushes inside it.
import { expect, it } from 'vitest';
import { SceneDoc, newEntity, newScene } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { movingTree } from '../src/renderer/brush/brushes';

it('a brush carries what is inside it; anything else carries its own contents', () => {
  const s = newScene('m');
  const brush = (name: string) => newEntity(name, { brush: { role: 'solid', faces: toData(box([0, 0, 0], [8, 8, 8])).faces } as never });
  const bomb = brush('bomb');
  const sign = newEntity('timer', { sign: {} });
  const inner = brush('inner');
  const deeper = newEntity('deeper', {});
  const group = newEntity('group', {});
  const inGroup = newEntity('in group', {});
  sign.parent = inner.parent = group.parent = bomb.id;
  deeper.parent = inner.id;
  inGroup.parent = group.id;
  s.entities = [bomb, sign, inner, deeper, group, inGroup];
  const doc = new SceneDoc(s);
  expect(movingTree(doc, bomb).map((e) => e.name).sort()).toEqual(['bomb', 'deeper', 'group', 'inner', 'timer']);
  expect(movingTree(doc, group).map((e) => e.name)).toEqual(['group']);
});
