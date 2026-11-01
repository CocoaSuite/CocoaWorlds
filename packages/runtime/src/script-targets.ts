/** Which objects scripts act on directly (named, or “this object”), so the world can give them a body. */
import { innerLists, type Script, type Statement } from '@cocoaworlds/scripting';

const ACTIONS = new Set(['move', 'turn', 'return', 'show', 'hide', 'turnOn', 'turnOff', 'remove', 'scale', 'physical', 'push', 'moveTo', 'damage', 'turnTo']);

export function scriptTargets(scripts: [owner: string, script: Script][]): string[] {
  const out = new Set<string>();
  const visit = (owner: string, list: Statement[]) => {
    for (const s of list) {
      if (ACTIONS.has(s.kind) && 'target' in s) {
        const t = s.target;
        if ('self' in t) out.add(owner);
        else if ('entity' in t) out.add(t.entity);
      }
      for (const [, inner] of innerLists(s)) visit(owner, inner);
    }
  };
  for (const [owner, script] of scripts) for (const h of script.handlers ?? []) visit(owner, h.body);
  return [...out];
}
