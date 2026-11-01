/** Which objects scripts act on directly (named, or “this object”), so the world can give them a body. */
import type { Script, Statement } from '@cocoaworlds/scripting';

const ACTIONS = new Set(['move', 'turn', 'return', 'show', 'hide', 'turnOn', 'turnOff', 'remove', 'scale', 'physical', 'push', 'moveTo', 'damage']);

export function scriptTargets(scripts: [owner: string, script: Script][]): string[] {
  const out = new Set<string>();
  const visit = (owner: string, list: Statement[]) => {
    for (const s of list) {
      if (ACTIONS.has(s.kind) && 'target' in s) {
        const t = s.target;
        if ('self' in t) out.add(owner);
        else if ('entity' in t) out.add(t.entity);
      }
      if (s.kind === 'if') {
        visit(owner, s.then);
        if (s.otherwise) visit(owner, s.otherwise);
      }
      if (s.kind === 'repeat' || s.kind === 'forever') visit(owner, s.body);
    }
  };
  for (const [owner, script] of scripts) for (const h of script.handlers ?? []) visit(owner, h.body);
  return [...out];
}
