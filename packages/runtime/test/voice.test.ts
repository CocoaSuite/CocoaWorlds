// Voice-over blocks: captions shown as on-screen messages on their times; a new voice-over cuts the last one off.
import { beforeAll, describe, expect, it } from 'vitest';
import { newEntity, newScene, type EntityData, type Vec3 } from '@cocoaworlds/core';
import { box, toData } from '@cocoaworlds/geometry';
import { blockId, newEvent, newStatement, num, readCaptionFile, type EventBlock, type Statement } from '@cocoaworlds/scripting';
import { GameWorld, initPhysics } from '../src';

beforeAll(async () => {
  await initPhysics();
});

const floor = (): EntityData => newEntity('floor', { brush: { role: 'solid', faces: toData(box([-512, -16, -512] as Vec3, [512, 0, 512] as Vec3)).faces } as never });
const st = (kind: Statement['kind'], patch: Record<string, unknown> = {}) => ({ ...newStatement(kind), ...patch }) as Statement;
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
};

describe('voice-over', () => {
  it('reads caption files from the timing tool', () => {
    const f = readCaptionFile({ format: 'cocoaworlds-captions', sound: 'intro.wav', captions: [{ at: 2, until: 1, text: ' b ' }, { at: 0.5, until: 1.5, text: 'a' }, { at: 1, text: '' }] });
    expect(f).toEqual({ sound: 'intro.wav', captions: [{ at: 0.5, until: 1.5, text: 'a' }, { at: 2, until: 5, text: 'b' }] });
    expect(readCaptionFile({ nope: 1 })).toBeNull();
  });

  it('shows captions on time, and a new voice-over cuts the old one and its captions off', () => {
    const talker = newEntity('talker', {});
    const captions = [{ at: 0, until: 1, text: 'Hello.' }, { at: 1, until: 2, text: 'Second line.' }];
    talker.components.script = {
      version: 1,
      variables: [],
      handlers: [
        {
          id: blockId(),
          event: newEvent('start') as EventBlock,
          body: [st('playVoice', { sound: 'assets/sounds/a.wav', volume: num(0.8), captions }), st('wait', { seconds: num(3.2) }), st('playVoice', { sound: 'assets/sounds/b.wav', captions: [{ at: 0, until: 1, text: 'New.' }] }), st('wait', { seconds: num(2) }), st('stopVoice')],
        },
      ],
    } as never;
    const s = newScene('v');
    s.entities = [floor(), talker, newEntity('start', { playerSpawn: {} })];
    const w = GameWorld.create(s);
    expect(w.scriptProblems).toEqual([]);
    const events: { type: string; sound?: string; volume?: number }[] = [];
    w.bus.on('*', (e) => {
      if (e.type === 'voice' || e.type === 'voice.stop') events.push(e);
    });
    run(w, 0.2);
    expect(events[0]).toMatchObject({ type: 'voice', sound: 'assets/sounds/a.wav', volume: 0.8 });
    // (No sound started it: the captions wait a moment, then show anyway.)
    run(w, 1.5);
    expect(w.screenMessages()).toEqual(['Hello.']);
    run(w, 1);
    expect(w.screenMessages()).toEqual(['Second line.']);
    run(w, 0.5);
    w.voiceBegan('assets/sounds/b.wav');
    run(w, 0.2);
    expect(events[1]).toMatchObject({ type: 'voice', sound: 'assets/sounds/b.wav' });
    expect(w.screenMessages()).toEqual(['New.']);
    run(w, 2);
    expect(events.at(-1)).toMatchObject({ type: 'voice.stop' });
    expect(w.screenMessages()).toEqual([]);
    w.dispose();
  });
});
