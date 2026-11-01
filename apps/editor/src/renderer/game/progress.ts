/**
 * Saved progress (B4) in this browser's storage, by project id: kept game values and items. Exported web games
 * keep it per web site, desktop games in their own user-data folder, and Play in the editor in the editor's.
 */
import type { SavedProgress } from '@cocoaworlds/runtime';

const saveKey = (id: string) => `cocoaworlds.progress.${id}`;

export function loadProgress(id: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(saveKey(id));
    return raw ? (JSON.parse(raw) as SavedProgress) : null;
  } catch {
    return null;
  }
}

/** Keep it (null forgets it). */
export function storeProgress(id: string, p: SavedProgress | null): void {
  try {
    if (p) localStorage.setItem(saveKey(id), JSON.stringify(p));
    else localStorage.removeItem(saveKey(id));
  } catch {
    /* storage full or blocked: progress just isn't kept */
  }
}
