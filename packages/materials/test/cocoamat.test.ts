// The .cocoamat file (docs/cocoamat-format.md): manifest, graph, nodes, the ZIP, and the reader's refusals.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import extract from 'extract-zip';
import { describe, expect, it } from 'vitest';
import {
  COCOAMAT_MIME,
  catalogFor,
  changedNodes,
  encodePng,
  evaluable,
  expose,
  graphForExport,
  imageNames,
  imagesUsed,
  manifestOf,
  materialOf,
  newGraph,
  readCocoaMat,
  readZip,
  writeCocoaMat,
  writeZip,
  type MatGraph,
  type MaterialSource,
} from '../src';

function bricks(): MatGraph {
  const g: MatGraph = {
    format: 'cocoaworlds.material',
    version: 1,
    nodes: [
      { id: 'k1z0w2e5', type: 'bricks', x: 0, y: 0, params: { rows: 10 } },
      { id: 'b3n81xq0', type: 'tint', x: 220, y: 0, params: { color: '#8a4a32' } },
      { id: 'i0m4g3e1', type: 'image', x: 0, y: 200, params: { image: 'assets/textures/moss.webp' } },
      { id: 'n0ise001', type: 'noise', x: 0, y: 300, params: { kind: 'ridged' } },
      { id: 'o9w1m2c3', type: 'outColor', x: 440, y: 0, params: {} },
      { id: 'o9w1m2c4', type: 'outGlow', x: 440, y: 100, params: {} },
    ],
    links: [
      { from: 'k1z0w2e5', to: 'b3n81xq0', input: 'in' },
      { from: 'b3n81xq0', to: 'o9w1m2c3', input: 'in' },
      { from: 'i0m4g3e1', to: 'o9w1m2c4', input: 'in' },
    ],
  };
  let out = expose(g, 'b3n81xq0', 'color', 'Brick colour');
  out = expose(out, 'k1z0w2e5', 'rows', 'Rows');
  out = expose(out, 'k1z0w2e5', 'offset', 'Stagger');
  out = expose(out, 'n0ise001', 'kind', 'Kind');
  out = expose(out, 'i0m4g3e1', 'image', 'Moss');
  return out;
}

const mat = (g: MatGraph, patch: Partial<MaterialSource> = {}): MaterialSource => ({
  id: 'mat/k3f9a0z2m1q8x7c4',
  name: 'Red bricks',
  folder: 'Walls/Brick',
  color: '#ffffff',
  roughness: 1,
  metalness: 0,
  graph: undefined,
  bakeSize: 1024,
  tile: 96,
  overrides: { [g.exposed![0]!.id]: '#a0522d', [g.exposed![1]!.id]: 12, [g.exposed![4]!.id]: 'assets/textures/lichen.jpg' },
  ...patch,
} as MaterialSource);

async function file(g = bricks(), m = mat(g)): Promise<Uint8Array> {
  const paths = imageNames(imagesUsed(g, m.overrides));
  return writeCocoaMat({
    manifest: manifestOf(m, g, { generator: 'CocoaWorlds 0.1.0', created: '2026-11-04T12:00:00Z', paths }),
    graph: graphForExport(g, paths),
    nodes: catalogFor(g),
    images: new Map([...paths.values()].map((p) => [p, new Uint8Array([1, 2, 3])])),
  });
}

describe('the manifest', () => {
  it('lists exposed settings with kinds, ranges, defaults and values', () => {
    const g = bricks();
    const paths = imageNames(imagesUsed(g, mat(g).overrides));
    const m = manifestOf(mat(g), g, { paths });
    expect(m.format).toBe('cocoasuite.material');
    expect(m.version).toBe('1.0');
    expect(m.tiling).toEqual({ worldSize: 96, mapping: 'face' });
    expect(m.evaluation).toEqual({ size: 1024 });
    const [colour, rows, stagger, kind, moss] = m.parameters;
    expect(colour).toMatchObject({ label: 'Brick colour', node: 'b3n81xq0', param: 'color', kind: 'color', default: '#8a4a32', value: '#a0522d' });
    expect(rows).toMatchObject({ kind: 'int', min: 1, max: 64, default: 10, value: 12 });
    expect(stagger).toMatchObject({ kind: 'number', min: 0, max: 1, default: 0.5, value: 0.5 });
    expect(kind).toMatchObject({ kind: 'choice', options: ['perlin', 'value', 'ridged'], default: 'ridged', value: 'ridged' });
    expect(moss).toMatchObject({ kind: 'image', default: 'images/moss.png', value: 'images/lichen.jpg' });
    // A Glow output with no glow colour glows white, at strength 1.
    expect(m.surface).toMatchObject({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveStrength: 1, cutout: true, scroll: [0, 0] });
    expect(m.wear).toBeNull();
    expect(m.glass).toBeNull();
  });

  it('fills a bare material with the defaults', () => {
    const g = newGraph();
    const m = manifestOf({ id: 'mat/0000000000000000', name: 'Stone', color: '#b4b4b4', roughness: 0.8, metalness: 0 }, g);
    expect(m.parameters).toEqual([]);
    expect(m.folder).toBe('');
    expect(m.tiling.worldSize).toBe(128);
    expect(m.evaluation.size).toBe(512);
    expect(m.surface).toEqual({ color: '#b4b4b4', roughness: 0.8, metalness: 0, normalStrength: 1, emissive: '#000000', emissiveStrength: 0, opacity: 1, cutout: true, doubleSided: false, scroll: [0, 0] });
    expect(m.bevel).toBe(0);
  });

  it('carries glass, blend and wear', () => {
    const g = newGraph();
    const wear = { edge: 1, crease: 0, up: 0, width: 8, noise: 0.5, color: '#c4c4c4', roughness: 0.4, metalness: 0.9 };
    const m = manifestOf({ id: 'mat/0000000000000000', name: 'X', color: '#b4b4b4', roughness: 0.8, metalness: 0, refraction: 0.9, blend: 12, wear, bevel: 2 }, g);
    expect(m.glass).toEqual({ transmission: 0.9, ior: 1.5, thickness: 8 });
    expect(m.blend).toEqual({ distance: 12, noise: 0.5, noiseSize: 24 });
    expect(m.wear).toEqual(wear);
    expect(m.bevel).toBe(2);
  });

  it('rewrites image paths in graph.json, without the overrides', () => {
    const g = bricks();
    const paths = imageNames(imagesUsed(g, mat(g).overrides));
    expect([...paths.values()]).toEqual(['images/moss.png', 'images/lichen.jpg']);
    const out = graphForExport(g, paths);
    expect(out.nodes.find((n) => n.type === 'image')!.params.image).toBe('images/moss.png');
    expect(out.nodes.find((n) => n.type === 'tint')!.params.color).toBe('#8a4a32');
    expect(imageNames(['assets/textures/a/x.png', 'assets/textures/b/x.png'])).toEqual(new Map([['assets/textures/a/x.png', 'images/x.png'], ['assets/textures/b/x.png', 'images/x_2.png']]));
  });

  it('cuts the catalog to the nodes used', () => {
    const c = catalogFor(bricks());
    expect(c.nodes.map((n) => n.type).sort()).toEqual(['bricks', 'image', 'noise', 'outColor', 'outGlow', 'tint']);
    expect(c.library.length).toBeGreaterThan(100);
    expect(c.vertexShader).toContain('vUv');
  });
});

describe('the file', () => {
  it('starts with mimetype, stored, its type string at byte 38', async () => {
    const b = await file();
    expect([...b.subarray(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
    expect(b[8]).toBe(0);
    expect(String.fromCharCode(...b.subarray(30, 38))).toBe('mimetype');
    expect(String.fromCharCode(...b.subarray(38, 38 + COCOAMAT_MIME.length))).toBe(COCOAMAT_MIME);
    expect(COCOAMAT_MIME.length).toBe(39);
  });

  it('is read back by another ZIP reader', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cocoamat-'));
    writeFileSync(path.join(dir, 'a.cocoamat'), await file());
    await extract(path.join(dir, 'a.cocoamat'), { dir: path.join(dir, 'out') });
    expect(readFileSync(path.join(dir, 'out', 'mimetype'), 'utf8')).toBe(COCOAMAT_MIME);
    const m = JSON.parse(readFileSync(path.join(dir, 'out', 'material.json'), 'utf8'));
    expect(m.name).toBe('Red bricks');
    expect([...readFileSync(path.join(dir, 'out', 'images', 'lichen.jpg'))]).toEqual([1, 2, 3]);
  });

  it('is read back by readCocoaMat, and evaluates with its values', async () => {
    const r = await readCocoaMat(await file());
    if (!r.ok) throw new Error(r.error);
    const f = r.value;
    expect(f.manifest.parameters.map((p) => p.value)).toEqual(['#a0522d', 12, 0.5, 'ridged', 'images/lichen.jpg']);
    expect(f.images.size).toBe(2);
    const g = evaluable(f);
    expect(g.nodes.find((n) => n.type === 'bricks')!.params.rows).toBe(12);
    expect(g.nodes.find((n) => n.type === 'image')!.params.image).toBe('images/lichen.jpg');
    expect(changedNodes(f)).toEqual({ missing: [], different: [] });
    const m = materialOf(f.manifest);
    expect(m).toMatchObject({ name: 'Red bricks', folder: 'Walls/Brick', tile: 96, bakeSize: 1024 });
    expect(Object.values(m.overrides!)).toEqual(['#a0522d', 12, 'images/lichen.jpg']);
  });

  it('keeps fields it does not know', async () => {
    const zip = await readZip(await file());
    if (typeof zip === 'string') throw new Error(zip);
    const m = JSON.parse(new TextDecoder().decode(zip.get('material.json')));
    m.extensions = { cocoasurface: { a: 1 } };
    m.future = 2;
    const r = await readCocoaMat(await rezip(zip, { 'material.json': m }));
    expect(r.ok && r.value.manifest.extensions).toEqual({ cocoasurface: { a: 1 } });
    expect(r.ok && r.value.manifest.future).toBe(2);
  });
});

/** The file again with some JSON entries replaced (null: left out). */
async function rezip(zip: Map<string, Uint8Array>, replace: Record<string, unknown>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const entries = [...zip].filter(([n]) => replace[n] !== null).map(([name, data]) => ({ name, data: name in replace ? enc.encode(JSON.stringify(replace[name])) : data, deflate: name !== 'mimetype' }));
  return writeZip(entries);
}

describe('the reader refuses', () => {
  const refused = async (b: Uint8Array) => {
    const r = await readCocoaMat(b);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.error;
  };
  const edit = async (fn: (j: { m: any; g: any; n: any }) => void) => {
    const zip = (await readZip(await file())) as Map<string, Uint8Array>;
    const j = (k: string) => JSON.parse(new TextDecoder().decode(zip.get(k)));
    const parts = { m: j('material.json'), g: j('graph.json'), n: j('nodes.json') };
    fn(parts);
    return rezip(zip, { 'material.json': parts.m, 'graph.json': parts.g, 'nodes.json': parts.n });
  };

  it('a wrong mimetype', async () => {
    const zip = (await readZip(await file())) as Map<string, Uint8Array>;
    zip.set('mimetype', new TextEncoder().encode('application/zip'));
    expect(await refused(await writeZip([...zip].map(([name, data]) => ({ name, data }))))).toMatch(/not a CocoaSuite material/);
    expect(await refused(new Uint8Array(100))).toMatch(/not a CocoaSuite material/);
  });

  it('a higher major version', async () => {
    expect(await refused(await edit(({ m }) => (m.version = '2.0')))).toMatch(/newer/);
    const r = await readCocoaMat(await edit(({ m }) => (m.version = '1.7')));
    expect(r.ok).toBe(true);
  });

  it('an unknown node type', async () => {
    expect(await refused(await edit(({ g }) => (g.nodes[0].type = 'teleport')))).toMatch(/Unknown node/);
    // (A node not in CocoaWorlds but defined in the file is fine.)
    const r = await readCocoaMat(
      await edit(({ g, n }) => {
        n.nodes.push({ ...n.nodes.find((x: any) => x.type === 'tint'), type: 'tint2', hash: '00000000' });
        g.nodes[1].type = 'tint2';
      }),
    );
    expect(r.ok && changedNodes(r.value).missing).toEqual(['tint2']);
  });

  it('a bad link, two links into one input, a loop', async () => {
    expect(await refused(await edit(({ g }) => g.links.push({ from: 'nope', to: 'b3n81xq0', input: 'in' })))).toMatch(/not there/);
    expect(await refused(await edit(({ g }) => g.links.push({ from: 'n0ise001', to: 'b3n81xq0', input: 'in' })))).toMatch(/two links/);
    expect(await refused(await edit(({ g }) => g.links.push({ from: 'b3n81xq0', to: 'k1z0w2e5', input: 'nope' })))).toMatch(/no input/);
  });

  it('a setting of the wrong kind, a bad parameter value, a missing image', async () => {
    expect(await refused(await edit(({ g }) => (g.nodes[0].params.rows = 'ten')))).toMatch(/bad setting/);
    expect(await refused(await edit(({ m }) => (m.parameters[0].value = 'red')))).toMatch(/bad value/);
    expect(await refused(await edit(({ m }) => (m.parameters[0].param = 'nope')))).toMatch(/not there/);
    expect(await refused(await edit(({ g }) => (g.nodes[2].params.image = 'images/gone.png')))).toMatch(/bad setting|missing/);
  });

  it('a path with ..', async () => {
    const zip = (await readZip(await file())) as Map<string, Uint8Array>;
    zip.set('images/../../evil.png', new Uint8Array([0]));
    expect(await refused(await writeZip([...zip].map(([name, data]) => ({ name, data }))))).toMatch(/Bad path/);
  });

  it('a missing manifest, graph or nodes', async () => {
    const zip = (await readZip(await file())) as Map<string, Uint8Array>;
    for (const k of ['material.json', 'graph.json', 'nodes.json']) expect(await refused(await rezip(zip, { [k]: null }))).toMatch(new RegExp(`no ${k}`));
  });

  it('clamps numbers out of range', async () => {
    const r = await readCocoaMat(await edit(({ m }) => ((m.parameters[1].value = 500), (m.surface.roughness = 3))));
    expect(r.ok && r.value.manifest.parameters[1]!.value).toBe(64);
    expect(r.ok && r.value.manifest.surface.roughness).toBe(1);
  });
});

describe('PNG', () => {
  it('writes grey and RGB pictures', async () => {
    const grey = await encodePng(2, 2, 1, new Uint8Array([0, 64, 128, 255]));
    expect([...grey.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(grey[25]).toBe(0);
    const rgb = await encodePng(1, 1, 3, new Uint8Array([1, 2, 3]));
    expect(rgb[25]).toBe(2);
  });
});
