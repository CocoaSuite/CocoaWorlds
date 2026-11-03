/**
 * Heightmap import for a terrain (T1): a greyscale picture becomes its ground, black lowest and white highest,
 * stretched over the whole terrain. One undo step.
 */
import { Button } from '@cocoaworlds/ui';
import { useRef, useState } from 'react';
import { t } from '../i18n';
import { useEditor } from '../store';
import { changed, loadTerrain } from '../viewport/terrains';

/** Heights (u above the terrain's bottom) from a picture, one per grid column. */
export async function heightsFromImage(file: Blob, nx: number, nz: number, low: number, range: number): Promise<Float32Array> {
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(nx, nz);
  const g = c.getContext('2d')!;
  // (Drawn at the grid's size: the browser averages the picture down, or smooths it up.)
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, nx, nz);
  const px = g.getImageData(0, 0, nx, nz).data;
  const out = new Float32Array(nx * nz);
  for (let i = 0; i < nx * nz; i++) out[i] = low + ((px[i * 4]! * 0.299 + px[i * 4 + 1]! * 0.587 + px[i * 4 + 2]! * 0.114) / 255) * range;
  return out;
}

export function TerrainImport({ file }: { file: string }) {
  const pick = useRef<HTMLInputElement>(null);
  const [range, setRange] = useState(384);
  const run = async (img: File) => {
    const f = await loadTerrain(file);
    if (!f) return useEditor.getState().notify(t('terrain.notLoaded'));
    const [nx, ny, nz] = f.n;
    // Room left below the lowest ground and above the highest.
    const top = (ny - 1) * f.cell - f.cell * 2, low = f.cell * 4;
    const r = Math.max(f.cell, Math.min(range, top - low));
    let h: Float32Array;
    try {
      h = await heightsFromImage(img, nx, nz, low, r);
    } catch {
      return useEditor.getState().notify(t('terrain.badImage').replace('{name}', img.name));
    }
    const before = { d: f.density.slice(), w: f.weights.slice() };
    f.fromHeights((x, z) => h[z * nx + x]!);
    const after = f.density.slice();
    useEditor.getState().terrainEdit({
      label: 'Import heightmap',
      apply: () => {
        f.density.set(after);
        changed(file, null);
      },
      revert: () => {
        f.density.set(before.d);
        f.weights.set(before.w);
        changed(file, null);
      },
    });
    useEditor.getState().log('info', 'Terrain', t('terrain.imported').replace('{name}', img.name));
  };
  return (
    <div className="cw-terrain-import">
      <label className="cw-brush-k">
        {t('terrain.range')}
        <input className="cw-input" type="number" min={16} step={16} value={range} aria-label={t('terrain.range')} onChange={(e) => setRange(Number(e.currentTarget.value) || 384)} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <Button size="sm" onClick={() => pick.current?.click()}>
        {t('terrain.import')}
      </Button>
      <input
        ref={pick}
        type="file"
        hidden
        accept=".png,.jpg,.jpeg,.webp"
        data-testid="import-heightmap"
        onChange={(e) => {
          const img = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (img) void run(img);
        }}
      />
      <div className="cw-muted cw-hint">{t('terrain.importHint')}</div>
    </div>
  );
}
