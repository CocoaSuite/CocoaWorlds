// The .cocoamat sample files (docs/cocoamat/samples/): CocoaSurface's conformance test. Each sample sits beside
// its maps as CocoaWorlds evaluates them at 256 px. This test evaluates the files again and compares, within
// the spec's tolerance (section 5.6). CW_WRITE_SAMPLES=1 writes them afresh. Also proves the normal map's green
// direction (spec section 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { appDir, launch, quit, tempDirs } from './helpers.mjs';

const DIR = path.join(appDir, '../../docs/cocoamat/samples');
const SIZE = 256;

/** A 64 px PNG made here (diagonal stripes, warm and cool), for the Image node sample. */
function stripesPng() {
  const n = 64;
  const raw = Buffer.alloc((n * 3 + 1) * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const on = Math.floor((x + y) / 8) % 2;
      raw.set(on ? [214, 140, 60] : [52, 92, 140], y * (n * 3 + 1) + 1 + x * 3);
    }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const graph = (nodes, links, exposed) => ({ format: 'cocoaworlds.material', version: 1, nodes, links, ...(exposed ? { exposed } : {}) });
const node = (id, type, x, y, params = {}) => ({ id, type, x, y, params });
const mat = (id, name, patch = {}) => ({ id, name, color: '#ffffff', roughness: 1, metalness: 0, bakeSize: SIZE, tile: 128, ...patch });

const SAMPLES = [
  {
    name: 'stone',
    m: mat('mat/sample0stone0001', 'Stone'),
    g: graph(
      [
        node('noise001', 'noise', 0, 190, { scale: 4, octaves: 6 }),
        node('colour01', 'gradientMap', 220, 0, { ramp: [{ at: 0, color: '#4a4640' }, { at: 0.55, color: '#8a8378' }, { at: 1, color: '#c9c1b2' }] }),
        node('normal01', 'normal', 220, 220),
        node('rough001', 'value', 220, 440, { value: 0.8 }),
        node('outcol01', 'outColor', 440, 20),
        node('outhgt01', 'outHeight', 440, 150),
        node('outnrm01', 'outNormal', 440, 280),
        node('outrgh01', 'outRoughness', 440, 410),
      ],
      [
        { from: 'noise001', to: 'colour01', input: 'in' },
        { from: 'noise001', to: 'normal01', input: 'in' },
        { from: 'colour01', to: 'outcol01', input: 'in' },
        { from: 'noise001', to: 'outhgt01', input: 'in' },
        { from: 'normal01', to: 'outnrm01', input: 'in' },
        { from: 'rough001', to: 'outrgh01', input: 'in' },
      ],
    ),
  },
  {
    name: 'bricks',
    m: mat('mat/sample0bricks001', 'Red bricks', { folder: 'Walls/Brick', overrides: { x7k2m9qa: '#a0522d', p0d4hh2r: 12, f8s1ne0v: 0.25 } }),
    g: graph(
      [
        node('k1z0w2e5', 'bricks', 0, 0, { rows: 10 }),
        node('b3n81xq0', 'tint', 220, 0, { color: '#8a4a32' }),
        node('nrm00001', 'normal', 220, 200, { strength: 2 }),
        node('o9w1m2c3', 'outColor', 440, 0),
        node('o9w1m2c4', 'outNormal', 440, 200),
        node('o9w1m2c5', 'outRoughness', 440, 320),
      ],
      [
        { from: 'k1z0w2e5', to: 'b3n81xq0', input: 'in' },
        { from: 'b3n81xq0', to: 'o9w1m2c3', input: 'in' },
        { from: 'k1z0w2e5', to: 'nrm00001', input: 'in' },
        { from: 'nrm00001', to: 'o9w1m2c4', input: 'in' },
        { from: 'k1z0w2e5', to: 'o9w1m2c5', input: 'in' },
      ],
      [
        { id: 'x7k2m9qa', node: 'b3n81xq0', param: 'color', label: 'Brick colour' },
        { id: 'p0d4hh2r', node: 'k1z0w2e5', param: 'rows', label: 'Rows' },
        { id: 'f8s1ne0v', node: 'k1z0w2e5', param: 'offset', label: 'Stagger' },
      ],
    ),
  },
  {
    name: 'image',
    m: mat('mat/sample0image0001', 'Striped image'),
    images: { 'assets/textures/stripes.png': stripesPng() },
    g: graph(
      [
        node('img00001', 'image', 0, 0, { image: 'assets/textures/stripes.png' }),
        node('nrm00001', 'normal', 220, 200),
        node('outcol01', 'outColor', 440, 0),
        node('outnrm01', 'outNormal', 440, 200),
      ],
      [
        { from: 'img00001', to: 'outcol01', input: 'in' },
        { from: 'img00001', to: 'nrm00001', input: 'in' },
        { from: 'nrm00001', to: 'outnrm01', input: 'in' },
      ],
      [{ id: 'imgparam', node: 'img00001', param: 'image', label: 'Picture' }],
    ),
  },
];

/** In the page: evaluate a file at SIZE and compare each map with the reference PNGs (or return them). */
async function evaluate(page, bytes, refs) {
  return page.evaluate(
    async ({ bytes, refs, size }) => {
      const api = window.__cwMatFiles;
      const r = await api.evaluateFile(new Uint8Array(bytes), size);
      if (typeof r === 'string') throw new Error(r);
      const out = { pngs: {}, diff: {} };
      for (const [role, px] of r.maps) {
        out.pngs[role] = [...(await api.mapPng(role, px, size))];
        const ref = refs?.[role];
        if (!ref) continue;
        const img = await createImageBitmap(new Blob([new Uint8Array(ref)]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const c = new OffscreenCanvas(size, size);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const want = g.getImageData(0, 0, size, size).data;
        let sum = 0, max = 0;
        for (let i = 0; i < want.length; i++) {
          if (i % 4 === 3) continue;
          const d = Math.abs(want[i] - px[i]);
          sum += d;
          max = Math.max(max, d);
        }
        out.diff[role] = { mean: sum / ((want.length * 3) / 4), max };
      }
      return out;
    },
    { bytes: [...bytes], refs, size: SIZE },
  );
}

test('cocoamat samples evaluate to their reference maps', async () => {
  const { userData, projectsDir } = await tempDirs();
  const { app, page } = await launch(userData, projectsDir);
  try {
    await page.getByRole('heading', { name: 'Projects' }).waitFor();
    await page.waitForFunction(() => !!window.__cwMatFiles);

    // Normal green (spec section 6): one soft bump. Above its middle the surface faces the top of the picture.
    const g = await page.evaluate(async () => {
      const api = window.__cwMatFiles;
      const g = {
        format: 'cocoaworlds.material',
        version: 1,
        nodes: [
          { id: 'bump', type: 'shape', x: 0, y: 0, params: { softness: 1, size: 0.9 } },
          { id: 'nrm', type: 'normal', x: 0, y: 0, params: {} },
          { id: 'out', type: 'outNormal', x: 0, y: 0, params: {} },
        ],
        links: [
          { from: 'bump', to: 'nrm', input: 'in' },
          { from: 'nrm', to: 'out', input: 'in' },
        ],
      };
      const px = (await api.evaluateRoles(g, 64)).get('normal');
      const at = (x, y) => [px[(y * 64 + x) * 4], px[(y * 64 + x) * 4 + 1]];
      return { above: at(32, 16), below: at(32, 48), left: at(16, 32), right: at(48, 32) };
    });
    assert.ok(g.above[1] < 128 && g.below[1] > 128, `green points down the picture: ${JSON.stringify(g)}`);
    assert.ok(g.left[0] < 128 && g.right[0] > 128, `red points right: ${JSON.stringify(g)}`);

    const write = !!process.env.CW_WRITE_SAMPLES;
    if (write) await fs.mkdir(DIR, { recursive: true });
    for (const s of SAMPLES) {
      const file = path.join(DIR, `${s.name}.cocoamat`);
      if (write) {
        const bytes = await page.evaluate(
          async ({ m, g, images }) => {
            const imgs = Object.fromEntries(Object.entries(images).map(([k, v]) => [k, new Uint8Array(v)]));
            const b = await window.__cwMatFiles.buildCocoaMat(m, g, { readImage: async (p) => imgs[p], load: (p) => createImageBitmap(new Blob([imgs[p]])), baked: false, generator: 'CocoaWorlds 0.1.0', created: '2026-11-04T12:00:00Z' });
            return [...b];
          },
          { m: s.m, g: s.g, images: Object.fromEntries(Object.entries(s.images ?? {}).map(([k, v]) => [k, [...v]])) },
        );
        await fs.writeFile(file, Buffer.from(bytes));
        const { pngs } = await evaluate(page, Buffer.from(bytes));
        for (const [role, png] of Object.entries(pngs)) await fs.writeFile(path.join(DIR, `${s.name}_${role}.png`), Buffer.from(png));
        continue;
      }
      const bytes = await fs.readFile(file);
      const refs = {};
      for (const f of await fs.readdir(DIR)) if (f.startsWith(`${s.name}_`) && f.endsWith('.png')) refs[f.slice(s.name.length + 1, -4)] = [...(await fs.readFile(path.join(DIR, f)))];
      const { diff } = await evaluate(page, bytes, refs);
      assert.deepEqual(Object.keys(diff).sort(), Object.keys(refs).sort(), `${s.name}: the same maps`);
      for (const [role, d] of Object.entries(diff)) assert.ok(d.mean < 1 && d.max < 8, `${s.name} ${role}: within tolerance (${JSON.stringify(d)})`);
    }
  } finally {
    await quit(app);
  }
});
