/**
 * Schema migrations. Each step upgrades a raw JSON object from version N to N+1.
 * Opening an older file runs every step in order; the editor keeps a backup of the original before saving.
 */
import { CURRENT_SCHEMA_VERSION } from './schema';

type Raw = Record<string, unknown>;
type Step = (data: Raw) => Raw;

/** Keyed by the version a step upgrades FROM. Version 1 is the first format, so there are no steps yet. */
const projectSteps: Record<number, Step> = {};
const sceneSteps: Record<number, Step> = {};

export class MigrationError extends Error {}

function run(kind: string, data: Raw, steps: Record<number, Step>): { data: Raw; migrated: boolean } {
  let v = typeof data.schemaVersion === 'number' ? data.schemaVersion : NaN;
  if (!Number.isInteger(v) || v < 1) throw new MigrationError(`This ${kind} file has no valid schema version.`);
  if (v > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `This ${kind} was saved by a newer CocoaWorlds (format ${v}). Update CocoaWorlds to open it; nothing was changed.`,
    );
  }
  let out = data;
  const start = v;
  while (v < CURRENT_SCHEMA_VERSION) {
    const step = steps[v];
    if (!step) throw new MigrationError(`No upgrade path for ${kind} format ${v}.`);
    out = { ...step(out), schemaVersion: v + 1 };
    v += 1;
  }
  return { data: out, migrated: v !== start };
}

export const migrateProject = (data: Raw) => run('project', data, projectSteps);
export const migrateScene = (data: Raw) => run('scene', data, sceneSteps);
