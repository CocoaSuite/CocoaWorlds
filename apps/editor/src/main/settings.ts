/** Editor preferences and the recent-projects list, stored as JSON in the OS app-data folder. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RecentProject } from '../shared/api';
import { writeAtomic } from './project-fs';

interface Settings {
  recent: RecentProject[];
}

const MAX_RECENT = 12;

export class SettingsStore {
  private cache: Settings | null = null;
  constructor(private readonly file: string) {}

  private async load(): Promise<Settings> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<Settings>;
      this.cache = { recent: Array.isArray(raw.recent) ? raw.recent.filter((r) => r && typeof r.dir === 'string') : [] };
    } catch {
      this.cache = { recent: [] };
    }
    return this.cache;
  }

  private async save(): Promise<void> {
    if (this.cache) await writeAtomic(this.file, JSON.stringify(this.cache, null, 2));
  }

  async recent(): Promise<RecentProject[]> {
    return [...(await this.load()).recent];
  }

  async touch(name: string, dir: string): Promise<void> {
    const s = await this.load();
    const norm = path.resolve(dir);
    s.recent = [{ name, dir: norm, openedAt: new Date().toISOString() }, ...s.recent.filter((r) => path.resolve(r.dir) !== norm)].slice(0, MAX_RECENT);
    await this.save();
  }

  async forget(dir: string): Promise<void> {
    const s = await this.load();
    const norm = path.resolve(dir);
    s.recent = s.recent.filter((r) => path.resolve(r.dir) !== norm);
    await this.save();
  }
}
