// CM1: the graph model, the node set and the shaders (the GPU part is covered end to end in the editor).
import { describe, expect, it } from 'vitest';
import {
  GROUPS,
  NODES,
  OUTPUT_ROLES,
  connect,
  disconnect,
  evaluationOrder,
  fingerprints,
  fragmentShader,
  newGraph,
  newNode,
  nodeDef,
  outputNodes,
  paramsOf,
  removeNodes,
  setParam,
  uniformsFor,
  validateGraph,
  wouldLoop,
  type MatGraph,
} from '../src';

describe('the node set', () => {
  it('has the planned groups, every map of a material as an output, and plain labels in both languages', () => {
    expect(NODES.length).toBeGreaterThanOrEqual(30);
    for (const g of GROUPS) expect(NODES.some((n) => n.group === g.id)).toBe(true);
    expect(new Set(NODES.filter((n) => n.role).map((n) => n.role))).toEqual(new Set(OUTPUT_ROLES));
    for (const n of NODES) {
      expect(n.label.en && n.label.ru && n.hint.en && n.hint.ru).toBeTruthy();
      expect(new Set(n.params.map((p) => p.id)).size).toBe(n.params.length);
      for (const p of n.params) expect(p.label.en && p.label.ru).toBeTruthy();
      // Output nodes make no picture of their own for others; the rest do.
      expect(n.output === null).toBe(n.group === 'output');
    }
  });

  it('every node compiles to a program that declares what its body uses', () => {
    for (const n of NODES) {
      const src = fragmentShader(n.type);
      expect(src.startsWith('#version 300 es')).toBe(true);
      for (const m of n.glsl.matchAll(/\bp_(\w+?)(?:_c|_t|_n|_ok)?\b/g)) expect(src, `${n.type}: ${m[0]}`).toContain(`uniform`);
      for (const p of n.params) expect(src).toMatch(new RegExp(`uniform \\w+ p_${p.id}\\b|uniform vec3 p_${p.id}_c`));
      for (const i of n.inputs) expect(src).toContain(`vec4 inC_${i.id}(vec2 uv)`);
      // Braces balance (a cheap check that the body pasted in whole).
      expect([...src].filter((c) => c === '{').length).toBe([...src].filter((c) => c === '}').length);
    }
  });

  it('settings become uniforms: choices by position, colours as RGB, ramps padded to 8 stops', () => {
    const u = uniformsFor('noise', { kind: 'ridged', scale: 6.4 });
    expect(u.find((x) => x.name === 'p_kind')!.value).toBe(2);
    expect(u.find((x) => x.name === 'p_scale')!.value).toBe(6);
    expect(uniformsFor('color', { color: '#ff8000' })[0]!.value).toEqual([1, 128 / 255, 0]);
    const r = uniformsFor('gradientMap', { ramp: [{ at: 1, color: '#ffffff' }, { at: 0, color: '#000000' }] });
    expect(r.find((x) => x.name === 'p_ramp_n')!.value).toBe(2);
    expect((r.find((x) => x.name === 'p_ramp_t')!.value as number[]).slice(0, 3)).toEqual([0, 1, 2]);
    expect((r.find((x) => x.name === 'p_ramp_c')!.value as number[]).length).toBe(24);
  });
});

describe('graphs', () => {
  it('the starting graph is valid and wires colour, height, normal and roughness', () => {
    const g = newGraph();
    expect(validateGraph(g)).toBeNull();
    expect([...outputNodes(g).keys()].sort()).toEqual(['color', 'height', 'normal', 'roughness']);
    // Nodes come after what feeds them.
    const order = evaluationOrder(g).map((n) => n.id);
    for (const l of g.links) expect(order.indexOf(l.from)).toBeLessThan(order.indexOf(l.to));
  });

  it('links: one per input, never into a loop, never from an output node', () => {
    let g = newGraph();
    const noise = g.nodes.find((n) => n.type === 'noise')!;
    const map = g.nodes.find((n) => n.type === 'gradientMap')!;
    const out = g.nodes.find((n) => n.type === 'outColor')!;
    const lv = newNode('levels');
    g = { ...g, nodes: [...g.nodes, lv] };
    g = connect(g, map.id, lv.id, 'in');
    g = connect(g, lv.id, out.id, 'in');
    expect(g.links.filter((l) => l.to === out.id)).toEqual([{ from: lv.id, to: out.id, input: 'in' }]);
    // Levels can't feed the gradient map that feeds it.
    expect(wouldLoop(g, lv.id, map.id)).toBe(true);
    expect(connect(g, lv.id, map.id, 'in')).toBe(g);
    expect(connect(g, out.id, lv.id, 'in')).toBe(g);
    expect(connect(g, noise.id, lv.id, 'nope')).toBe(g);
    g = disconnect(g, lv.id, 'in');
    expect(g.links.some((l) => l.to === lv.id)).toBe(false);
    g = removeNodes(g, [noise.id]);
    expect(g.links.some((l) => l.from === noise.id)).toBe(false);
    expect(validateGraph(g)).toBeNull();
  });

  it('settings equal to the default are left out of the file', () => {
    let g = newGraph();
    const n = g.nodes.find((x) => x.type === 'noise')!;
    g = setParam(g, n.id, 'octaves', 3);
    expect(g.nodes.find((x) => x.id === n.id)!.params.octaves).toBe(3);
    g = setParam(g, n.id, 'octaves', nodeDef('noise')!.params.find((p) => p.id === 'octaves')!.default);
    expect('octaves' in g.nodes.find((x) => x.id === n.id)!.params).toBe(false);
    expect(paramsOf(g.nodes.find((x) => x.id === n.id)!).octaves).toBe(5);
  });

  it('a change redraws only that node and what is below it', () => {
    const g = newGraph();
    const before = fingerprints(g);
    const rough = g.nodes.find((n) => n.type === 'value')!;
    const after = fingerprints(setParam(g, rough.id, 'value', 0.3));
    const changed = g.nodes.filter((n) => before.get(n.id) !== after.get(n.id)).map((n) => n.type);
    expect(changed.sort()).toEqual(['outRoughness', 'value']);
    const noise = g.nodes.find((n) => n.type === 'noise')!;
    const after2 = fingerprints(setParam(g, noise.id, 'seed', 3));
    expect(g.nodes.filter((n) => before.get(n.id) !== after2.get(n.id)).map((n) => n.type).sort()).toEqual(['gradientMap', 'noise', 'normal', 'outColor', 'outHeight', 'outNormal']);
  });

  it('files that are wrong say what is wrong', () => {
    const g = newGraph();
    expect(validateGraph({ ...g, format: 'x' })).toMatch(/not a Cocoa Materials graph/);
    expect(validateGraph({ ...g, version: 9 })).toMatch(/newer version/);
    expect(validateGraph({ ...g, nodes: [...g.nodes, { ...g.nodes[0]!, id: 'teapot1', type: 'teapot' }] })).toMatch(/Unknown node/);
    const bad: MatGraph = { ...g, nodes: g.nodes.map((n, i) => (i === 0 ? { ...n, params: { scale: 'big' } } : n)) };
    expect(validateGraph(bad)).toMatch(/bad setting “scale”/);
    const loop: MatGraph = { ...g, links: [...g.links, { from: g.nodes.find((n) => n.type === 'gradientMap')!.id, to: g.nodes.find((n) => n.type === 'normal')!.id, input: 'in' }] };
    expect(validateGraph(loop)).toMatch(/two links/);
    const lv = newNode('levels'), inv = newNode('invert');
    const cyc: MatGraph = { ...g, nodes: [...g.nodes, lv, inv], links: [...g.links, { from: lv.id, to: inv.id, input: 'in' }, { from: inv.id, to: lv.id, input: 'in' }] };
    expect(validateGraph(cyc)).toMatch(/loops back/);
  });
});
