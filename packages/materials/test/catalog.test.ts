// The node catalog (docs/cocoamat/): made from the node set, complete, and the committed copies are current.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NODES, fragmentShader } from '../src';
import { catalogMarkdown, fnv1a, nodeCatalog } from '../src/catalog';

const DIR = new URL('../../../docs/cocoamat/', import.meta.url);
const JSON_FILE = new URL('nodes.json', DIR);
const MD_FILE = new URL('nodes.md', DIR);

describe('the node catalog', () => {
  it('has every node, with its settings, inputs and program', () => {
    const c = nodeCatalog();
    expect(c.nodes.map((n) => n.type)).toEqual(NODES.map((n) => n.type));
    for (const n of c.nodes) {
      const def = NODES.find((d) => d.type === n.type)!;
      expect(n.params.map((p) => p.id)).toEqual(def.params.map((p) => p.id));
      expect(n.inputs.map((i) => i.id)).toEqual(def.inputs.map((i) => i.id));
      expect(n.glsl).toBe(def.glsl);
      expect(n.hash).toBe(fnv1a(fragmentShader(n.type)));
      for (const p of n.params) if (p.kind === 'choice') expect(p.options!.length).toBeGreaterThan(0);
    }
  });

  it('hashes with FNV-1a', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
  });

  it('is written out in docs/cocoamat, and the copies there are current', () => {
    const json = `${JSON.stringify(nodeCatalog(), null, 2)}\n`;
    const md = catalogMarkdown();
    if (process.env.CW_WRITE_CATALOG) {
      if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
      writeFileSync(JSON_FILE, json);
      writeFileSync(MD_FILE, md);
    }
    // (Out of date: run CW_WRITE_CATALOG=1 npx vitest run packages/materials/test/catalog.test.ts)
    expect(readFileSync(JSON_FILE, 'utf8')).toBe(json);
    expect(readFileSync(MD_FILE, 'utf8')).toBe(md);
  });
});
