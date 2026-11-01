/** Background worker: builds the level so large edits never freeze the editor. */
import { buildLevel, type WorldJob } from './world-build';

const ctx = self as unknown as { onmessage: ((e: MessageEvent<WorldJob>) => void) | null; postMessage(m: unknown, transfer: Transferable[]): void };

ctx.onmessage = (e) => {
  const r = buildLevel(e.data);
  const m = r.mesh;
  const transfer: Transferable[] = m ? [m.positions.buffer, m.normals.buffer, m.uvs.buffer, m.indices.buffer, m.triangleFaces.buffer, m.triangleBrushes.buffer] : [];
  ctx.postMessage(r, transfer);
};
