// What surfaces sound like in Play: the project's sound files for each kind, and what each material is.
import { guessSurface, isSurface, type MaterialDef, type Surface, type SurfaceSoundSet, type SurfaceSounds } from '@cocoaworlds/core';

let sounds: SurfaceSounds = {};

export function setSurfaceSounds(s: SurfaceSounds | undefined): void {
  sounds = s ?? {};
}

/** A kind's files for steps, soft or hard hits (hard hits fall back to soft ones; any kind to Generic). */
export function surfaceFiles(surface: string, kind: 'steps' | 'soft' | 'hard'): { files: string[]; volume: number } {
  const pick = (set: SurfaceSoundSet | undefined) => (set?.[kind]?.length ? set[kind]! : kind === 'hard' && set?.soft?.length ? set.soft : null);
  const own = isSurface(surface) ? sounds[surface] : undefined;
  const files = pick(own);
  if (files) return { files, volume: own?.volume ?? 1 };
  const g = sounds.generic;
  return { files: pick(g) ?? [], volume: g?.volume ?? 1 };
}

export function allSurfaceFiles(): string[] {
  return [...new Set(Object.values(sounds).flatMap((s) => [...(s?.steps ?? []), ...(s?.soft ?? []), ...(s?.hard ?? [])]))];
}

/** What each material sounds like: set on it, or guessed from its name and folder. */
export function materialSurfaces(list: Iterable<MaterialDef>): Map<string, Surface> {
  const out = new Map<string, Surface>();
  for (const m of list) out.set(m.id, m.sound ?? surfaceGuess(m));
  return out;
}

export const surfaceGuess = (m: MaterialDef): Surface => {
  const s = guessSurface(m.name);
  return s !== 'generic' ? s : guessSurface(m.folder ?? '');
};
