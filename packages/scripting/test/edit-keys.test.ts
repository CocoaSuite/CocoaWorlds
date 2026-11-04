import { describe, expect, it } from 'vitest';
import { newStatement, replaceBlock, type Script } from '../src';

describe('value slots of every block can be edited', () => {
  it('Play sound loudness and the Director hint’s spread and sureness', () => {
    for (const kind of ['playSound', 'hint'] as const) {
      const s = newStatement(kind, {}) as unknown as Record<string, { id: string; value: number }>;
      const script: Script = { version: 1, variables: [], handlers: [{ id: 'h', event: { id: 'e', kind: 'start' }, body: [s as never] }] };
      for (const k of kind === 'playSound' ? ['loudness'] : ['spread', 'sure']) {
        const next = replaceBlock(script, s[k]!.id, (b) => ({ ...b, value: 5 }) as never);
        expect(((next.handlers[0]!.body[0] as unknown as Record<string, { value: number }>)[k]!).value).toBe(5);
      }
    }
  });
});
