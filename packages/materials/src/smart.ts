/**
 * Smart materials: ready-made graphs that look like something (stylised rock …) on any surface. Each comes with
 * the material settings it wants (projected from the world, so brushes, terrain and models all get it without
 * texture coordinates) and a few exposed settings to make variants from.
 */
import { GRAPH_FORMAT, GRAPH_VERSION, expose, newNode, type GraphLink, type GraphNode, type MatGraph } from './graph';
import type { L, ParamValue } from './nodes';

export interface SmartMaterial {
  id: string;
  label: L;
  hint: L;
  graph(): MatGraph;
  /** Material settings it is made with (MaterialDef fields). */
  settings: { mapping: 'world' | 'object'; tile: number; bakeSize: number; normalStrength?: number };
}

/** A little graph builder: nodes in columns, links by name. */
function builder() {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const n = (type: string, x: number, y: number, params: Record<string, ParamValue> = {}) => {
    const node = newNode(type, x * 220, y * 130, params);
    nodes.push(node);
    return node;
  };
  const link = (from: GraphNode, to: GraphNode, input = 'in') => links.push({ from: from.id, to: to.id, input });
  const graph = (): MatGraph => ({ format: GRAPH_FORMAT, version: GRAPH_VERSION, nodes, links });
  return { n, link, graph };
}

/**
 * Stylised rock (hand-painted look): chiselled plates with cracks; blue-grey stone, lighter on the plates' top
 * edges, ochre and moss settled in the cracks, painterly patches and light baked in from above.
 */
function rock(): MatGraph {
  const { n, link, graph } = builder();
  const shape = n('rockFacets', 0, 2, { scale: 3, stretch: 1.6, tilt: 0.8, gap: 0.014, bevel: 0.1, detail: 0.75, warp: 0.5 });
  // Surface.
  const normal = n('normal', 1, 0, { strength: 10 });
  const occ = n('occlusion', 1, 1, { radius: 0.025, strength: 1.6 });
  const curv = n('curvature', 1, 2, { radius: 0.007, strength: 5 });
  const edges = n('levels', 2, 2, { inLow: 0.6, inHigh: 0.85 });
  const cracks = n('dirt', 1, 3, { amount: 0.3, scale: 5, seed: 2 });
  const crevice = n('dirt', 1, 4, { amount: 0.2, scale: 3, seed: 7 });
  const mossNoise = n('noise', 1, 7, { scale: 3, octaves: 5, seed: 12 });
  const mossSpots = n('levels', 2, 7, { inLow: 0.52, inHigh: 0.66 });
  link(mossNoise, mossSpots);
  const moss = n('blend', 2, 4, { mode: 'multiply', opacity: 1 });
  link(crevice, moss, 'top');
  link(mossSpots, moss, 'bottom');
  const light = n('emboss', 1, 5, { angle: 215, elevation: 50, strength: 1.4 });
  const patches = n('hexagons', 1, 6, { scale: 20, gap: 0, bevel: 0.5, random: 0.6 });
  for (const x of [normal, occ, curv, cracks, crevice, light]) link(shape, x);
  link(curv, edges);
  // Colour: stone by height, varied, then light, cracks, moss, edges and patches on top.
  const stone = n('gradientMap', 2, 0, {
    ramp: [
      { at: 0, color: '#2f2b28' },
      { at: 0.3, color: '#474f53' },
      { at: 0.6, color: '#677173' },
      { at: 0.85, color: '#868b84' },
      { at: 1, color: '#a39f90' },
    ],
  });
  link(shape, stone);
  const varied = n('colorVariation', 3, 0, { amount: 0.22, hue: 0.07, scale: 3, seed: 4 });
  link(stone, varied);
  const lit = n('blend', 4, 0, { mode: 'overlay', opacity: 0.6 });
  link(light, lit, 'top');
  link(varied, lit, 'bottom');
  const ochre = n('color', 4, 3, { color: '#a87742' });
  const inCracks = n('blend', 5, 0, { mode: 'mix', opacity: 0.7 });
  link(ochre, inCracks, 'top');
  link(lit, inCracks, 'bottom');
  link(cracks, inCracks, 'mask');
  const green = n('color', 5, 4, { color: '#8aa23e' });
  const mossy = n('blend', 6, 0, { mode: 'mix', opacity: 0.7 });
  link(green, mossy, 'top');
  link(inCracks, mossy, 'bottom');
  link(moss, mossy, 'mask');
  const pale = n('color', 6, 2, { color: '#d9d8c8' });
  const rims = n('blend', 7, 0, { mode: 'mix', opacity: 0.55 });
  link(pale, rims, 'top');
  link(mossy, rims, 'bottom');
  link(edges, rims, 'mask');
  const painted = n('blend', 8, 0, { mode: 'overlay', opacity: 0.05 });
  link(patches, painted, 'top');
  link(rims, painted, 'bottom');
  // Outputs. (No roughness picture: the material's own Roughness, fully matte, so it takes no sky shine.)
  const oc = n('outColor', 9, 0), oh = n('outHeight', 9, 1), on = n('outNormal', 9, 2), oo = n('outOcclusion', 9, 3);
  link(painted, oc);
  link(shape, oh);
  link(normal, on);
  link(occ, oo);
  let g = graph();
  g = expose(g, shape.id, 'scale', 'Plates across');
  g = expose(g, shape.id, 'stretch', 'Stretch');
  g = expose(g, shape.id, 'seed', 'Seed');
  g = expose(g, stone.id, 'ramp', 'Stone colours');
  g = expose(g, ochre.id, 'color', 'Crack colour');
  g = expose(g, green.id, 'color', 'Moss colour');
  g = expose(g, crevice.id, 'amount', 'Moss');
  return g;
}

export const SMART_MATERIALS: SmartMaterial[] = [
  {
    id: 'rock',
    label: { en: 'Stylised rock', ru: 'Стилизованный камень' },
    hint: {
      en: 'Hand-painted rock: chiselled plates, cracks with ochre and moss, light top edges. Projected from the world, so it fits brushes, terrain and models alike.',
      ru: 'Рисованный камень: колотые плиты, трещины с охрой и мхом, светлые верхние края. Проецируется из мира — подходит кистям, рельефу и моделям.',
    },
    graph: rock,
    settings: { mapping: 'world', tile: 384, bakeSize: 1024, normalStrength: 1.8 },
  },
];
