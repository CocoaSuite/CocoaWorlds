/**
 * Built-in development materials: flat colours with a 16-unit grid, so levels can be blocked out and read
 * before real material assets exist (Phase 7). Each texture is 256 × 256 texels; at the default scale of
 * 0.25 units per texel one tile covers 64 units with a line every 16.
 */
import type { Lang } from '../i18n';

export const DEV_TEXTURE_SIZE = 256;

export interface DevMaterial {
  id: string;
  base: string;
  label: Record<Lang, string>;
}

export const DEV_MATERIALS: DevMaterial[] = [
  { id: 'dev/grid', base: '#a3a3a3', label: { en: 'Grey', ru: 'Серый' } },
  { id: 'dev/white', base: '#d8d8d4', label: { en: 'White', ru: 'Белый' } },
  { id: 'dev/dark', base: '#5c5c5c', label: { en: 'Dark', ru: 'Тёмный' } },
  { id: 'dev/wall', base: '#b9ad96', label: { en: 'Wall', ru: 'Стена' } },
  { id: 'dev/floor', base: '#8a7861', label: { en: 'Floor', ru: 'Пол' } },
  { id: 'dev/orange', base: '#d0803c', label: { en: 'Orange', ru: 'Оранжевый' } },
  { id: 'dev/red', base: '#b4574c', label: { en: 'Red', ru: 'Красный' } },
  { id: 'dev/green', base: '#7c9a48', label: { en: 'Green', ru: 'Зелёный' } },
  { id: 'dev/blue', base: '#5a84b6', label: { en: 'Blue', ru: 'Синий' } },
];

const byId = new Map(DEV_MATERIALS.map((m) => [m.id, m]));

export const devMaterial = (id: string): DevMaterial | undefined => byId.get(id);

/** Multiply a hex colour's channels (0–1 = darker). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Paint a dev texture: base colour, a thin line every 16 units and a stronger edge every 64. */
export function paintDevTexture(g: CanvasRenderingContext2D, base: string, size = DEV_TEXTURE_SIZE): void {
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  g.fillStyle = shade(base, 0.86);
  for (let i = 0; i < size; i += size / 4) {
    g.fillRect(i, 0, 2, size);
    g.fillRect(0, i, size, 2);
  }
  g.fillStyle = shade(base, 0.75);
  g.fillRect(0, 0, 4, size);
  g.fillRect(0, 0, size, 4);
}

/** A small CSS swatch for the material picker. */
export function swatchStyle(id: string): { background: string } {
  const m = devMaterial(id);
  const base = m?.base ?? '#777777';
  const line = shade(base, 0.8);
  return {
    background: `linear-gradient(${line} 0 2px, transparent 2px) 0 0 / 100% 50%, linear-gradient(90deg, ${line} 0 2px, transparent 2px) 0 0 / 50% 100%, ${base}`,
  };
}
