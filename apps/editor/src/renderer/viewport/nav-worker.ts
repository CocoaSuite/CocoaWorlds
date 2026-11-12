/** Background worker: measures where creatures can walk (rows of the navigation grid), so starting to play doesn't freeze. */
import { initNavPhysics, openNavJob, type NavJob, type NavRows } from '@cocoaworlds/runtime/navgrid';

export type NavAsk = { kind: 'level'; id: number; job: NavJob } | { kind: 'rows'; id: number; j0: number; j1: number } | { kind: 'done'; id: number };
export type NavAnswer = { id: number; j0: number; rows: NavRows } | { id: number; error: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<NavAsk>) => void) | null; postMessage(m: NavAnswer, transfer?: Transferable[]): void };

let open: { id: number; level: ReturnType<typeof openNavJob> } | null = null;
// (One at a time, in the order asked: a level is open before its rows are measured.)
let last: Promise<void> = Promise.resolve();

ctx.onmessage = (e) => {
  const m = e.data;
  last = last.then(async () => {
    try {
      if (m.kind === 'level') {
        await initNavPhysics();
        open?.level.free();
        open = null;
        open = { id: m.id, level: openNavJob(m.job) };
      } else if (m.kind === 'rows') {
        if (open?.id !== m.id) throw new Error('no such level');
        const rows = open.level.rows(m.j0, m.j1);
        ctx.postMessage({ id: m.id, j0: m.j0, rows }, [rows.spots.buffer, rows.colOf.buffer]);
      } else if (open?.id === m.id) {
        open.level.free();
        open = null;
      }
    } catch (err) {
      ctx.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
