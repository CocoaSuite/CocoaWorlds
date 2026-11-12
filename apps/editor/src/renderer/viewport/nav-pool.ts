/**
 * Where creatures can walk, measured in background workers (a few, each taking bands of the grid's rows), so a
 * large level doesn't freeze the window when Play starts. The grid is the very one the game world would measure
 * itself: each worker reads the same snapshot of the physics.
 */
import { navSize, type NavBuilder, type NavJob, type NavRows } from '@cocoaworlds/runtime';
import NavWorker from './nav-worker?worker&inline';
import type { NavAnswer, NavAsk } from './nav-worker';

/** Bands each worker gets on average (smaller bands even out rows that take longer). */
const BANDS_EACH = 4;
/** Give up after this long (the world then measures the level itself). */
const TIMEOUT_MS = 30000;

/** How many levels the workers have measured, and how many they couldn't (those the world measured itself). */
export const navWork = { measured: 0, failed: 0, workers: 0 };
(globalThis as { __cwNavWork?: typeof navWork }).__cwNavWork = navWork;

let workers: Worker[] | null = null;
let jobs = 0;

function pool(): Worker[] {
  if (workers) return workers;
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  workers = Array.from({ length: n }, () => new NavWorker());
  navWork.workers = n;
  return workers;
}

function drop(): void {
  for (const w of workers ?? []) w.terminate();
  workers = null;
}

/** Measures a level's navigation in the workers. Rejects if they can't (the world then measures it itself). */
export const navInWorkers: NavBuilder = (job: NavJob) =>
  new Promise<NavRows[]>((resolve, reject) => {
    let ws: Worker[];
    try {
      ws = pool();
    } catch (err) {
      navWork.failed++;
      return reject(err instanceof Error ? err : new Error(String(err)));
    }
    const id = ++jobs;
    const { nz } = navSize(job.min, job.max, job.opts);
    const count = Math.min(nz, ws.length * BANDS_EACH);
    const bands = Array.from({ length: count }, (_, k) => [Math.floor((nz * k) / count), Math.floor((nz * (k + 1)) / count)] as const);
    const out = new Map<number, NavRows>();
    let next = 0;
    let over = false;
    const end = (err?: Error) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      for (const w of ws) {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
      }
      if (err) {
        // (Workers that failed or hung are not asked again as they are: new ones next time.)
        drop();
        navWork.failed++;
        reject(err);
      } else {
        for (const w of ws) w.postMessage({ kind: 'done', id } satisfies NavAsk);
        navWork.measured++;
        resolve(bands.map(([j0]) => out.get(j0)!));
      }
    };
    const give = (w: Worker) => {
      const b = bands[next++];
      if (b) w.postMessage({ kind: 'rows', id, j0: b[0], j1: b[1] } satisfies NavAsk);
    };
    const onMessage = (e: MessageEvent<NavAnswer>) => {
      const m = e.data;
      if (m.id !== id) return;
      if ('error' in m) return end(new Error(m.error));
      out.set(m.j0, m.rows);
      if (out.size === bands.length) end();
      else give(e.target as Worker);
    };
    const onError = (e: ErrorEvent) => end(new Error(e.message || 'the navigation worker failed'));
    const timer = setTimeout(() => end(new Error('measuring the level took too long')), TIMEOUT_MS);
    for (const w of ws) {
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      w.postMessage({ kind: 'level', id, job } satisfies NavAsk);
      give(w);
    }
  });
