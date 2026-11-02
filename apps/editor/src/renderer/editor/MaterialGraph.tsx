/**
 * Cocoa Materials: the graph of a graph material (decision C2: React Flow, in CocoaCanvas styling). Nodes show
 * what they make; wires go from an output (right) to an input (left). Right-click, Space or “+ Node” adds a
 * node; Delete removes the picked nodes or wires. The right side shows the material on a shape (or the picked
 * node's picture flat) and the settings of the picked node, or of the material when no node is picked.
 */
import { BAKE_SIZES, type MaterialDef } from '@cocoaworlds/core';
import {
  GROUPS,
  NODES,
  connect,
  disconnect,
  newNode,
  nodeDef,
  paramsOf,
  removeNodes,
  setParam,
  wouldLoop,
  type GraphNode,
  type L,
  type MatGraph,
  type Param,
  type ParamValue,
  type RampStop,
} from '@cocoaworlds/materials';
import { Button, ColorField, NumberField, Segmented, Switch } from '@cocoaworlds/ui';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getLang, t } from '../i18n';
import { LiveGraph, bakeNow, endGraphGesture, loadGraph, setGraph, setGraphLive, useGraphs } from '../materials/graphs';
import { useEditor } from '../store';
import { ImagePick, MaterialPreview, Row, Slider, type Shape } from './MaterialsPanel';

const say = (x: L) => (getLang() === 'ru' ? x.ru : x.en);
/** The live picture size: the baked size, but no more than 512 while editing. */
const liveSize = (m: MaterialDef) => Math.min(m.bakeSize ?? 512, 512);

interface Ctx {
  live: LiveGraph | null;
  /** Bumped when pictures are redrawn (nodes repaint their errors). */
  errors: ReadonlyMap<string, string>;
}
const GraphCtx = createContext<Ctx>({ live: null, errors: new Map() });

type CmNode = Node<{ node: GraphNode }, 'cm'>;

const Thumb = memo(function Thumb({ id, size = 116 }: { id: string; size?: number }) {
  const { live } = useContext(GraphCtx);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!live || !ref.current) return;
    return live.attachThumb(id, ref.current);
  }, [live, id]);
  return <canvas ref={ref} width={size} height={size} className="cm-thumb" style={{ width: size, height: size }} />;
});

function CmNodeView({ id, data, selected }: NodeProps<CmNode>) {
  const def = nodeDef(data.node.type)!;
  const { errors } = useContext(GraphCtx);
  const err = errors.get(id);
  return (
    <div className={`cm-node g-${def.group}${def.group === 'output' ? ' out' : ''}${selected ? ' on' : ''}${err ? ' bad' : ''}`} title={err ?? say(def.hint)} data-node-type={def.type} aria-label={say(def.label)}>
      <div className="cm-node-h">{say(def.label)}</div>
      <div className="cm-node-b">
        <div className="cm-ports">
          {def.inputs.map((p) => (
            <div className="cm-port" key={p.id}>
              <Handle type="target" position={Position.Left} id={p.id} className={`cm-h ${p.kind}`} />
              <span>{say(p.label)}</span>
            </div>
          ))}
        </div>
        {def.group === 'output' ? <Thumb id={id} size={56} /> : <Thumb id={id} />}
      </div>
      {def.output && <Handle type="source" position={Position.Right} id="out" className={`cm-h ${def.output}`} />}
    </div>
  );
}
const nodeTypes = { cm: CmNodeView };

/** The add-node menu: search box and the nodes by group. */
function AddMenu({ at, onPick, onClose }: { at: { x: number; y: number }; onPick: (type: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const query = q.trim().toLowerCase();
  const list = NODES.filter((n) => !query || say(n.label).toLowerCase().includes(query) || n.label.en.toLowerCase().includes(query) || say(n.hint).toLowerCase().includes(query));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as globalThis.Node) && onClose();
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  return (
    <div className="cm-add" ref={ref} style={{ left: at.x, top: at.y }} role="dialog" aria-label={t('cm.addNode')}>
      <input
        className="cw-input"
        autoFocus
        placeholder={t('cm.search')}
        aria-label={t('cm.search')}
        value={q}
        onChange={(e) => {
          setQ(e.currentTarget.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          if (e.key === 'ArrowDown') setHi((h) => Math.min(list.length - 1, h + 1));
          if (e.key === 'ArrowUp') setHi((h) => Math.max(0, h - 1));
          if (e.key === 'Enter' && list[hi]) onPick(list[hi]!.type);
        }}
      />
      <div className="cm-add-list" role="menu">
        {GROUPS.map((g) => {
          const items = list.filter((n) => n.group === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id}>
              <div className="cm-add-g">{say(g.label)}</div>
              {items.map((n) => (
                <button key={n.type} type="button" role="menuitem" className={list[hi] === n ? 'hi' : ''} title={say(n.hint)} onClick={() => onPick(n.type)}>
                  <i className={`cm-dot g-${n.group}`} />
                  {say(n.label)}
                </button>
              ))}
            </div>
          );
        })}
        {!list.length && <div className="cw-muted cm-add-none">{t('cm.noMatch')}</div>}
      </div>
    </div>
  );
}

function Flow({ path, graph, sel, onSelect }: { path: string; graph: MatGraph; sel: string[]; onSelect: (ids: string[]) => void }) {
  const rf = useReactFlow();
  const host = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null);
  const [nodes, setNodes] = useState<CmNode[]>([]);
  const [edgeSel, setEdgeSel] = useState<Set<string>>(new Set());
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const selRef = useRef(sel);
  selRef.current = sel;

  // The graph is the truth; React Flow's own list follows it (keeping drags and selection smooth).
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((n) => {
        const o = old.get(n.id);
        const dragging = o?.dragging;
        return { id: n.id, type: 'cm', position: dragging ? o!.position : { x: n.x, y: n.y }, data: { node: n }, selected: sel.includes(n.id), dragging };
      });
    });
  }, [graph, sel]);

  const edges: Edge[] = useMemo(
    () =>
      graph.links.map((l) => {
        const id = `${l.to}:${l.input}`;
        const kind = nodeDef(graph.nodes.find((n) => n.id === l.from)?.type ?? '')?.output ?? 'grey';
        return { id, source: l.from, sourceHandle: 'out', target: l.to, targetHandle: l.input, selected: edgeSel.has(id), className: `cm-e ${kind}` };
      }),
    [graph, edgeSel],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CmNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      const g = graphRef.current;
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removed.length) {
        setGraph(path, removeNodes(g, removed), removed.length === 1 ? 'Remove node' : 'Remove nodes');
        onSelect([]);
        return;
      }
      const moved = changes.flatMap((c) => (c.type === 'position' && c.position ? [[c.id, c.position] as const] : []));
      if (moved.length) {
        const pos = new Map(moved);
        const next = { ...g, nodes: g.nodes.map((n) => (pos.has(n.id) ? { ...n, x: Math.round(pos.get(n.id)!.x), y: Math.round(pos.get(n.id)!.y) } : n)) };
        setGraphLive(path, next, 'Move nodes', `move:${[...pos.keys()].sort().join(',')}`);
      }
      const selChanges = changes.filter((c) => c.type === 'select');
      if (selChanges.length) {
        const set = new Set(sel);
        for (const c of selChanges) if (c.type === 'select') c.selected ? set.add(c.id) : set.delete(c.id);
        onSelect([...set]);
      }
    },
    [path, sel, onSelect],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      let g = graphRef.current;
      // (Wires of nodes being deleted go with their nodes, in the same undo step.)
      const going = new Set(selRef.current);
      const removed = changes.flatMap((c) => {
        if (c.type !== 'remove') return [];
        const [to, input] = c.id.split(':') as [string, string];
        const link = g.links.find((l) => l.to === to && l.input === input);
        return link && !going.has(link.to) && !going.has(link.from) ? [c.id] : [];
      });
      for (const id of removed) {
        const [to, input] = id.split(':') as [string, string];
        g = disconnect(g, to, input);
      }
      if (removed.length) setGraph(path, g, removed.length === 1 ? 'Remove wire' : 'Remove wires');
      const selChanges = changes.filter((c) => c.type === 'select');
      if (selChanges.length)
        setEdgeSel((prev) => {
          const set = new Set(prev);
          for (const c of selChanges) if (c.type === 'select') c.selected ? set.add(c.id) : set.delete(c.id);
          return set;
        });
    },
    [path],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.targetHandle) return;
      const next = connect(graphRef.current, c.source, c.target, c.targetHandle);
      if (next !== graphRef.current) setGraph(path, next, 'Connect nodes');
    },
    [path],
  );

  const add = (type: string, at: { x: number; y: number }) => {
    const n = newNode(type, Math.round(at.x), Math.round(at.y));
    setGraph(path, { ...graphRef.current, nodes: [...graphRef.current.nodes, n] }, `Add ${nodeDef(type)!.label.en} node`);
    onSelect([n.id]);
    setMenu(null);
  };

  const openMenu = (clientX: number, clientY: number) => {
    const box = host.current!.getBoundingClientRect();
    setMenu({ x: Math.min(clientX - box.left, box.width - 250), y: Math.min(clientY - box.top, box.height - 340), flow: rf.screenToFlowPosition({ x: clientX, y: clientY }) });
  };

  return (
    <div
      className="cm-flow"
      ref={host}
      data-testid="material-graph"
      tabIndex={-1}
      onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
      onKeyDown={(e) => {
        if (e.code === 'Space' && !menu && !(e.target as HTMLElement).closest('input, select, textarea')) {
          e.preventDefault();
          openMenu(pointer.current.x || host.current!.getBoundingClientRect().left + 200, pointer.current.y || host.current!.getBoundingClientRect().top + 120);
        }
      }}
    >
      <ReactFlow<CmNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={() => endGraphGesture()}
        isValidConnection={(c) => c.source !== c.target && !wouldLoop(graphRef.current, c.source, c.target)}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
        onPaneClick={() => {
          setMenu(null);
          onSelect([]);
        }}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        selectionKeyCode={null}
        colorMode="dark"
        minZoom={0.2}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1.2} color="#2c2c2c" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="cm-flow-tools">
        <Button size="sm" onClick={() => openMenu(host.current!.getBoundingClientRect().left + 24, host.current!.getBoundingClientRect().top + 40)}>
          {t('cm.addNode')}
        </Button>
        <span className="cw-muted">{t('cm.flowHint')}</span>
      </div>
      {menu && <AddMenu at={menu} onPick={(type) => add(type, menu.flow)} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** A colour ramp: the bar, then each stop's colour and place. */
function RampField({ value, onChange }: { value: RampStop[]; onChange: (v: RampStop[], key: string) => void }) {
  const stops = [...value].sort((a, b) => a.at - b.at);
  const bar = `linear-gradient(to right, ${stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ')})`;
  return (
    <div className="cm-ramp">
      <div className="cm-ramp-bar" style={{ background: stops.length > 1 ? bar : stops[0]?.color }} />
      {value.map((s, i) => (
        <div className="cm-ramp-row" key={i}>
          <ColorField label={`${t('cm.stop')} ${i + 1}`} value={s.color} onChange={(c) => onChange(value.map((x, j) => (j === i ? { ...x, color: c } : x)), `ramp-c-${i}`)} />
          <Slider label={`${t('cm.stopAt')} ${i + 1}`} value={s.at} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, at: v } : x)), `ramp-a-${i}`)} />
          <button type="button" className="cw-iconbtn" aria-label={`${t('cm.removeStop')} ${i + 1}`} disabled={value.length < 2} onClick={() => onChange(value.filter((_, j) => j !== i), 'ramp-del')}>
            ×
          </button>
        </div>
      ))}
      {value.length < 8 && (
        <Button
          size="sm"
          onClick={() => {
            // A new stop halfway along the widest gap, in the colour already there.
            let best = 0, gap = -1;
            for (let i = 0; i + 1 < stops.length; i++) {
              const d = stops[i + 1]!.at - stops[i]!.at;
              if (d > gap) [gap, best] = [d, i];
            }
            const a = stops[best]!, b = stops[Math.min(best + 1, stops.length - 1)]!;
            onChange([...value, { at: (a.at + b.at) / 2, color: a.color }], 'ramp-add');
          }}
        >
          {t('cm.addStop')}
        </Button>
      )}
    </div>
  );
}

function ParamField({ p, value, onChange, textures }: { p: Param; value: ParamValue; onChange: (v: ParamValue, key?: string) => void; textures: { path: string; name: string }[] }) {
  const label = say(p.label);
  switch (p.kind) {
    case 'number':
      return <Slider label={label} value={Number(value)} max={p.max} min={p.min} step={p.step ?? (p.max - p.min > 20 ? 1 : 0.01)} onChange={(v) => onChange(v, p.id)} />;
    case 'int':
      return <Slider label={label} value={Number(value)} max={p.max} min={p.min} step={1} digits={0} onChange={(v) => onChange(Math.round(v), p.id)} />;
    case 'seed':
      return (
        <span className="cw-screens-pair">
          <NumberField label="#" ariaLabel={label} value={Number(value)} onCommit={(v) => onChange(Math.round(v))} />
          <Button size="sm" title={t('cm.newSeed')} onClick={() => onChange(Math.floor(Math.random() * 9999) + 1)}>
            {t('cm.reroll')}
          </Button>
        </span>
      );
    case 'choice':
      return (
        <select className="cw-input" aria-label={label} value={String(value)} onChange={(e) => onChange(e.currentTarget.value)}>
          {p.options.map((o) => (
            <option key={o.value} value={o.value}>
              {say(o.label)}
            </option>
          ))}
        </select>
      );
    case 'color':
      return <ColorField label={label} value={String(value)} onChange={(v) => onChange(v, p.id)} />;
    case 'bool':
      return <Switch label={label} checked={!!value} onChange={(v) => onChange(v)} />;
    case 'ramp':
      return <RampField value={value as RampStop[]} onChange={(v, key) => onChange(v, `${p.id}-${key}`)} />;
    case 'image':
      return <ImagePick label={label} value={String(value) || undefined} textures={textures} onChange={(v) => onChange(v ?? '')} />;
  }
}

function NodeProps({ path, graph, node, onSelect }: { path: string; graph: MatGraph; node: GraphNode; onSelect: (ids: string[]) => void }) {
  const def = nodeDef(node.type)!;
  const params = paramsOf(node);
  const textures = useEditor((s) => s.assets.textures).map((x) => ({ path: x.path, name: x.name }));
  const { errors } = useContext(GraphCtx);
  const change = (key: string, v: ParamValue, gesture?: string) => {
    const next = setParam(graph, node.id, key, v);
    const label = `${def.label.en}: ${def.params.find((p) => p.id === key)?.label.en ?? key}`;
    if (gesture) setGraphLive(path, next, label, `${node.id}:${gesture}`);
    else setGraph(path, next, label);
  };
  return (
    <div className="cw-screens-props" key={node.id} aria-label={t('cm.nodeSettings')}>
      <div className="cm-props-h">
        <i className={`cm-dot g-${def.group}`} />
        <strong>{say(def.label)}</strong>
      </div>
      <p className="cw-muted cw-screens-note">{say(def.hint)}</p>
      {errors.get(node.id) && <p className="cw-screens-note cm-bad">{errors.get(node.id)}</p>}
      {def.params.map((p) => (
        <Row key={p.id} label={say(p.label)}>
          <ParamField p={p} value={params[p.id]!} textures={textures} onChange={(v, key) => change(p.id, v, key)} />
        </Row>
      ))}
      {!def.params.length && <p className="cw-muted cw-screens-note">{t('cm.noSettings')}</p>}
      <div className="cw-screens-pair">
        <Button
          size="sm"
          onClick={() => {
            const copy = { ...newNode(node.type, node.x + 40, node.y + 40), params: { ...node.params } };
            setGraph(path, { ...graph, nodes: [...graph.nodes, copy] }, `Duplicate ${def.label.en} node`);
            onSelect([copy.id]);
          }}
        >
          {t('cm.duplicateNode')}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setGraph(path, removeNodes(graph, [node.id]), 'Remove node');
            onSelect([]);
          }}
        >
          {t('cm.removeNode')}
        </Button>
      </div>
    </div>
  );
}

function GraphMaterialProps({ m, edit, onDuplicate, onRemove, used }: { m: MaterialDef; edit: (patch: Partial<MaterialDef>, label: string, key?: string) => void; onDuplicate: () => void; onRemove: () => void; used: number }) {
  const [name, setName] = useState(m.name);
  useEffect(() => setName(m.name), [m.id, m.name]);
  const scroll = m.scroll ?? [0, 0];
  return (
    <div className="cw-screens-props" key={m.id}>
      <Row label={t('mat.name')}>
        <input
          className="cw-input"
          aria-label={t('mat.name')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={() => (name.trim() && name.trim() !== m.name ? edit({ name: name.trim() }, 'Rename material') : setName(m.name))}
        />
      </Row>
      <Row label={t('cm.tile')}>
        <NumberField label="u" ariaLabel={t('cm.tile')} value={m.tile ?? 128} step={16} onCommit={(v) => v > 0 && edit({ tile: v }, 'Material size in the world')} />
      </Row>
      <p className="cw-muted cw-screens-note">{t('cm.tileHint')}</p>
      <Row label={t('cm.bakeSize')}>
        <select className="cw-input" aria-label={t('cm.bakeSize')} value={m.bakeSize ?? 512} onChange={(e) => edit({ bakeSize: Number(e.currentTarget.value) }, 'Baked size')}>
          {BAKE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} × {s}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('mat.bumps')}>
        <Slider label={t('mat.bumps')} value={m.normalStrength ?? 1} max={2} onChange={(v) => edit({ normalStrength: v === 1 ? undefined : v }, 'Bump strength', `mat-bumps-${m.id}`)} />
      </Row>
      <Row label={t('mat.glowStrength')}>
        <Slider label={t('mat.glowStrength')} value={m.emissiveStrength ?? 1} max={10} step={0.1} onChange={(v) => edit({ emissiveStrength: v === 1 ? undefined : v }, 'Glow strength', `mat-glow-i-${m.id}`)} />
      </Row>
      <Row label={t('mat.opacity')}>
        <Slider label={t('mat.opacity')} value={m.opacity ?? 1} onChange={(v) => edit({ opacity: v >= 1 ? undefined : v }, 'Material opacity', `mat-opacity-${m.id}`)} />
      </Row>
      <label className="cw-screens-sw" title={t('mat.cutoutHint')}>
        <Switch label={t('mat.cutout')} checked={m.cutout !== false} onChange={(v) => edit({ cutout: v ? undefined : false }, v ? 'Cut-out on' : 'Cut-out off')} />
        {t('mat.cutout')}
      </label>
      <label className="cw-screens-sw" title={t('mat.twoSidedHint')}>
        <Switch label={t('mat.twoSided')} checked={!!m.doubleSided} onChange={(v) => edit({ doubleSided: v || undefined }, v ? 'Two-sided on' : 'Two-sided off')} />
        {t('mat.twoSided')}
      </label>
      <Row label={t('mat.scroll')}>
        <span className="cw-screens-pair">
          <NumberField label="↔" ariaLabel={t('mat.scrollX')} value={scroll[0]} step={4} onCommit={(v) => edit({ scroll: v || scroll[1] ? [v, scroll[1]] : undefined }, 'Material scroll')} />
          <NumberField label="↕" ariaLabel={t('mat.scrollY')} value={scroll[1]} step={4} onCommit={(v) => edit({ scroll: v || scroll[0] ? [scroll[0], v] : undefined }, 'Material scroll')} />
        </span>
      </Row>
      <p className="cw-muted cw-screens-note">{t('cm.pickNodeHint')}</p>
      <div className="cw-screens-pair">
        <Button size="sm" onClick={onDuplicate}>
          {t('mat.duplicate')}
        </Button>
        <Button size="sm" onClick={onRemove}>
          {t('mat.remove')}
        </Button>
      </div>
      {used > 0 && <p className="cw-muted cw-screens-note">{t('mat.removeHint')}</p>}
    </div>
  );
}

/** The picked node's picture, flat (or the material's colour when nothing is picked). */
function FlatPreview({ id }: { id: string | null }) {
  const { live } = useContext(GraphCtx);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!live || !id || !ref.current) return;
    const c = ref.current;
    live.paint(id, c);
    return live.onDrawn(() => live.paint(id, c));
  }, [live, id]);
  if (!id) return <div className="cw-muted cw-screens-empty">{t('cm.pickForFlat')}</div>;
  return <canvas ref={ref} width={512} height={512} className="cm-flat" data-testid="node-preview" aria-label={t('cm.flat')} />;
}

/**
 * A graph material's part of the Materials workspace: the graph in the middle, preview and settings on the
 * right. `edit`, `onDuplicate` and `onRemove` work on the material itself.
 */
export function GraphWorkspace({
  m,
  edit,
  onDuplicate,
  onRemove,
  used,
  tools,
}: {
  m: MaterialDef;
  edit: (patch: Partial<MaterialDef>, label: string, key?: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  used: number;
  tools: React.ReactNode;
}) {
  const path = m.graph!;
  const graph = useGraphs((s) => s.graphs[path]);
  const error = useGraphs((s) => s.errors[path]);
  const baking = useGraphs((s) => s.baking[path]);
  const [live, setLive] = useState<LiveGraph | null>(null);
  const [imagesIn, setImagesIn] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [view, setView] = useState<'3d' | 'flat'>('3d');
  const [shape, setShape] = useState<Shape>('sphere');
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => void loadGraph(path), [path]);
  useEffect(() => {
    setSel([]);
    const lg = new LiveGraph(m.id, () => setImagesIn((n) => n + 1));
    setLive(lg);
    return () => lg.dispose();
  }, [m.id]);
  const size = liveSize(m);
  useEffect(() => {
    if (!graph || !live) return;
    live.run(graph, size);
    setErrors(new Map(live.errors));
  }, [graph, live, size, imagesIn]);
  useEffect(() => endGraphGesture, []);

  const node = sel.length === 1 ? graph?.nodes.find((n) => n.id === sel[0]) : undefined;
  const status = baking === 'baking' ? t('cm.baking') : baking === 'waiting' ? t('cm.waiting') : baking === 'failed' ? t('cm.bakeFailed') : t('cm.baked');

  return (
    <GraphCtx.Provider value={{ live, errors }}>
      <div className="cw-screens-main cm-main">
        <div className="cw-screens-tools">
          {tools}
          <span className={`cm-bake ${baking ?? 'done'}`} data-testid="bake-status">
            {status}
          </span>
          <Button size="sm" disabled={!graph} onClick={() => void bakeNow(path)}>
            {t('cm.bakeNow')}
          </Button>
        </div>
        {error ? (
          <div className="cw-muted cw-screens-empty">
            {t('cm.cantRead')} {error}
          </div>
        ) : graph ? (
          <ReactFlowProvider>
            <Flow path={path} graph={graph} sel={sel} onSelect={setSel} />
          </ReactFlowProvider>
        ) : (
          <div className="cw-muted cw-screens-empty">{t('cm.loading')}</div>
        )}
      </div>
      <aside className="cw-screens-side right cm-side" aria-label={t('mat.settings')}>
        <div className="cm-preview-tools">
          <Segmented<'3d' | 'flat'>
            label={t('cm.previewKind')}
            value={view}
            onChange={setView}
            options={[
              { value: '3d', label: t('cm.on3d') },
              { value: 'flat', label: t('cm.flat') },
            ]}
          />
          {view === '3d' && (
            <Segmented<Shape>
              label={t('mat.shape')}
              value={shape}
              onChange={setShape}
              options={[
                { value: 'sphere', label: t('mat.sphere') },
                { value: 'cube', label: t('mat.cube') },
                { value: 'wall', label: t('mat.wall') },
              ]}
            />
          )}
        </div>
        <div className="cm-preview">{view === '3d' ? <MaterialPreview id={m.id} shape={shape} /> : <FlatPreview id={node?.id ?? graph?.nodes.find((n) => n.type === 'outColor')?.id ?? null} />}</div>
        {node && graph ? <NodeProps path={path} graph={graph} node={node} onSelect={setSel} /> : <GraphMaterialProps m={m} edit={edit} onDuplicate={onDuplicate} onRemove={onRemove} used={used} />}
      </aside>
    </GraphCtx.Provider>
  );
}
