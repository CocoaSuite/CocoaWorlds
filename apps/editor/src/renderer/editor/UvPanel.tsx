/**
 * The UV workspace, Blender-style: the selected faces laid out over their texture as islands. Click to select
 * islands (Shift adds), drag to move, or G (move), R (turn), S (scale) with the mouse (X / Y keep to one axis,
 * click or Enter to finish, Esc or right-click to cancel), A for all. Wheel zooms, middle-drag pans.
 *
 * Hotspots mode edits a material's hotspot sheet: drag out rectangles on its texture (snapped to the grid), click
 * one to select it, Delete removes it. Faces painted with a material set to map itself are fitted into the
 * rectangle that suits them best.
 *
 * Brush faces keep their texture as offset, scale and turn (Hammer-style), so islands move, scale and turn whole.
 */
import { type MaterialDef } from '@cocoaworlds/core';
import { brushOf } from '../brush/brushes';
import { cloneSurface, polygons, uvAt, type FaceSurface, type SurfacePatch, type V3 } from '@cocoaworlds/geometry';
import { Button, NumberField, Segmented, Switch } from '@cocoaworlds/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assetUrl } from '../assets';
import { getLang } from '../i18n';
import { useEditor } from '../store';
import { materialLabel, materialSheet } from '../viewport/project-materials';
import { Row } from './MaterialsPanel';

const L = (en: string, ru: string) => (getLang() === 'ru' ? ru : en);
type Hot = NonNullable<MaterialDef['hotspots']>[number];

interface Island {
  key: string;
  id: string;
  face: number;
  surface: FaceSurface;
  /** Corners in the world (brush space) and on the sheet (0…1 = one repeat). */
  world: V3[];
  uv: [number, number][];
  plane: Parameters<typeof uvAt>[1];
  sheet: [number, number];
}

type Op = { kind: 'grab' | 'rotate' | 'scale'; keys: Set<string>; start: [number, number]; pivot: [number, number]; axis: 'x' | 'y' | null; base: Map<string, FaceSurface>; key: string; moved: boolean };

/** The UV editor beside the 3D view (toolbar UV, or View › UV editor beside the view); drag its edge to widen. */
export function UvPane() {
  const [w, setW] = useState(() => {
    try {
      return Number(localStorage.getItem('cw-uv-pane-w')) || 460;
    } catch {
      return 460;
    }
  });
  const drag = useRef<{ x: number; w: number } | null>(null);
  return (
    <div className="cw-uv-pane" style={{ width: w }} aria-label={L('UV editor', 'Редактор UV')} role="region">
      <div
        className="cw-uv-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label={L('Resize the UV editor', 'Ширина редактора UV')}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, w };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setW(Math.max(300, Math.min(1100, drag.current.w - (e.clientX - drag.current.x))));
        }}
        onPointerUp={() => {
          drag.current = null;
          try {
            localStorage.setItem('cw-uv-pane-w', String(w));
          } catch {
            /* (Not kept.) */
          }
        }}
      />
      <UvPanel pane />
    </div>
  );
}

export function UvPanel({ pane = false }: { pane?: boolean }) {
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.rev);
  const faceSel = useEditor((s) => s.faceSelection);
  const selection = useEditor((s) => s.selection);
  const materials = useEditor((s) => s.session?.project.settings.materials) ?? [];
  const st = useEditor.getState();
  const [mode, setMode] = useState<'uv' | 'hotspot'>('uv');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [hotMat, setHotMat] = useState<string>('');
  const [hotSel, setHotSel] = useState<number | null>(null);
  const [snap, setSnap] = useState(32);

  // The faces shown: the selected faces, or every face of the selected brushes.
  const islands = useMemo<Island[]>(() => {
    if (!doc) return [];
    const refs = faceSel.length ? faceSel : selection.flatMap((id) => (brushOf(doc.get(id))?.brush.faces ?? []).map((_, face) => ({ id, face })));
    const out: Island[] = [];
    const polysOf = new Map<string, ReturnType<typeof polygons>>();
    for (const r of refs) {
      const b = brushOf(doc.get(r.id));
      if (!b) continue;
      let polys = polysOf.get(r.id);
      if (!polys) polysOf.set(r.id, (polys = polygons(b.brush)));
      const poly = polys.find((p) => p.face === r.face);
      if (!poly) continue;
      const sheet = materialSheet(poly.surface.material);
      out.push({ key: `${r.id}:${r.face}`, id: r.id, face: r.face, surface: poly.surface, world: poly.points, plane: poly.plane, sheet, uv: poly.points.map((p) => { const t = uvAt(p, poly.plane, poly.surface); return [t[0] / sheet[0], t[1] / sheet[1]] as [number, number]; }) });
    }
    return out;
  }, [doc, faceSel, selection, useEditor.getState().rev]);
  const sel = picked ?? new Set(islands.map((i) => i.key));
  useEffect(() => setPicked(null), [faceSel, selection]);

  // The material shown behind: the first selected face's, or the one picked for hotspots.
  const faceMat = islands[0]?.surface.material ?? '';
  const shownMat = mode === 'hotspot' ? hotMat || materials[0]?.id || '' : faceMat;
  const def = materials.find((m) => m.id === shownMat);
  const hots = def?.hotspots ?? [];
  const setHots = (next: Hot[], label: string, key?: string) => def && st.setMaterials(materials.map((m) => (m.id === def.id ? { ...m, hotspots: next } : m)), label, key);

  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ zoom: 360, x: 0, y: 0 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImage(null);
    if (!def?.map) return;
    let live = true;
    void assetUrl(def.map).then((url) => {
      const img = new Image();
      img.onload = () => live && setImage(img);
      img.src = url;
    });
    return () => void (live = false);
  }, [def?.map]);

  const op = useRef<Op | null>(null);
  const draft = useRef<{ from: [number, number]; to: [number, number]; move?: number; base?: Hot } | null>(null);
  const [, redraw] = useState(0);
  const tick = () => redraw((n) => n + 1);

  // Screen ↔ sheet.
  const toSheet = (cx: number, cy: number): [number, number] => {
    const c = canvas.current!, v = view.current;
    return [(cx - c.clientWidth / 2) / v.zoom + 0.5 + v.x, (cy - c.clientHeight / 2) / v.zoom + 0.5 + v.y];
  };
  const toScreen = (u: number, w: number): [number, number] => {
    const c = canvas.current!, v = view.current;
    return [(u - 0.5 - v.x) * v.zoom + c.clientWidth / 2, (w - 0.5 - v.y) * v.zoom + c.clientHeight / 2];
  };
  const snapTo = (n: number) => Math.round(n * snap) / snap;

  // ── Drawing ──
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(c.clientWidth * dpr) || c.height !== Math.round(c.clientHeight * dpr)) {
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1b1c1f';
    g.fillRect(0, 0, c.clientWidth, c.clientHeight);
    const z = view.current.zoom;
    // The texture, repeated round the middle copy (dimmer).
    for (let ty = -1; ty <= 1; ty++)
      for (let tx = -1; tx <= 1; tx++) {
        const [x, y] = toScreen(tx, ty);
        g.globalAlpha = tx === 0 && ty === 0 ? 1 : 0.35;
        if (image) g.drawImage(image, x, y, z, z);
        else {
          const n = 8, s = z / n;
          for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            g.fillStyle = (i + j) % 2 ? '#3a3d44' : '#2c2e33';
            g.fillRect(x + i * s, y + j * s, s + 0.5, s + 0.5);
          }
        }
      }
    g.globalAlpha = 1;
    // Grid inside the middle copy, and its edge.
    const [ox, oy] = toScreen(0, 0);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    const div = mode === 'hotspot' ? snap : 8;
    for (let i = 1; i < div; i++) {
      g.beginPath(); g.moveTo(ox + (i / div) * z, oy); g.lineTo(ox + (i / div) * z, oy + z); g.stroke();
      g.beginPath(); g.moveTo(ox, oy + (i / div) * z); g.lineTo(ox + z, oy + (i / div) * z); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.strokeRect(ox, oy, z, z);
    // Hotspot rectangles.
    hots.forEach((h, i) => {
      const [x, y] = toScreen(h.x, h.y);
      g.fillStyle = mode === 'hotspot' && i === hotSel ? 'rgba(80,190,255,0.25)' : 'rgba(80,190,255,0.06)';
      g.fillRect(x, y, h.w * z, h.h * z);
      g.strokeStyle = mode === 'hotspot' ? (i === hotSel ? '#7fd3ff' : 'rgba(80,190,255,0.8)') : 'rgba(80,190,255,0.35)';
      g.lineWidth = i === hotSel ? 2 : 1;
      g.strokeRect(x + 0.5, y + 0.5, h.w * z, h.h * z);
      if (h.rotate !== false && mode === 'hotspot') {
        g.fillStyle = 'rgba(127,211,255,0.9)';
        g.font = '10px system-ui';
        g.fillText('⟳', x + 3, y + 11);
      }
    });
    const d = draft.current;
    if (d && d.move === undefined) {
      const [a, b] = toScreen(Math.min(d.from[0], d.to[0]), Math.min(d.from[1], d.to[1]));
      g.strokeStyle = '#ffd25e';
      g.setLineDash([4, 3]);
      g.strokeRect(a, b, Math.abs(d.to[0] - d.from[0]) * z, Math.abs(d.to[1] - d.from[1]) * z);
      g.setLineDash([]);
    }
    // Islands.
    if (mode === 'uv')
      for (const isl of islands) {
        const on = sel.has(isl.key);
        g.beginPath();
        isl.uv.forEach(([u, w], k) => {
          const [x, y] = toScreen(u, w);
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.closePath();
        g.fillStyle = on ? 'rgba(255,150,40,0.22)' : 'rgba(200,200,200,0.08)';
        g.fill();
        g.strokeStyle = on ? '#ff9a2e' : 'rgba(220,220,220,0.6)';
        g.lineWidth = on ? 1.5 : 1;
        g.stroke();
        if (on)
          for (const [u, w] of isl.uv) {
            const [x, y] = toScreen(u, w);
            g.fillStyle = '#ffb55e';
            g.fillRect(x - 2, y - 2, 4, 4);
          }
      }
  });

  // ── Editing islands ──
  const chosen = () => islands.filter((i) => sel.has(i.key));
  const centre = (list: Island[]): [number, number] => {
    let u = 0, v = 0, n = 0;
    for (const i of list) for (const p of i.uv) { u += p[0]; v += p[1]; n++; }
    return n ? [u / n, v / n] : [0.5, 0.5];
  };
  /** Each chosen face's surface for the operation so far (mouse at `at`). */
  const patches = (o: Op, at: [number, number]) => {
    const out: { id: string; face: number; patch: SurfacePatch }[] = [];
    let du = at[0] - o.start[0], dv = at[1] - o.start[1];
    if (o.axis === 'x') dv = 0;
    if (o.axis === 'y') du = 0;
    const a0 = Math.atan2(o.start[1] - o.pivot[1], o.start[0] - o.pivot[0]);
    const a1 = Math.atan2(at[1] - o.pivot[1], at[0] - o.pivot[0]);
    const d0 = Math.hypot(o.start[0] - o.pivot[0], o.start[1] - o.pivot[1]) || 1e-6;
    const d1 = Math.hypot(at[0] - o.pivot[0], at[1] - o.pivot[1]);
    const k = d1 / d0;
    for (const isl of islands.filter((i) => o.keys.has(i.key))) {
      const s = o.base.get(isl.key)!;
      const [W, H] = isl.sheet;
      if (o.kind === 'grab') {
        out.push({ id: isl.id, face: isl.face, patch: { offset: [s.offset[0] + du * W, s.offset[1] + dv * H] } });
      } else if (o.kind === 'scale') {
        const kx = o.axis === 'y' ? 1 : Math.max(0.01, k), ky = o.axis === 'x' ? 1 : Math.max(0.01, k);
        const pu = o.pivot[0] * W, pv = o.pivot[1] * H;
        out.push({ id: isl.id, face: isl.face, patch: { scale: [s.scale[0] / kx, s.scale[1] / ky], offset: [pu + kx * (s.offset[0] - pu), pv + ky * (s.offset[1] - pv)] } });
      } else {
        // Turn: the face's texture turn changes, and its offset follows so the island turns about the pivot.
        // (Which way the turn setting goes depends on the face's axes: the sign that lands its corners right wins.)
        const ang = a1 - a0, deg = (ang * 180) / Math.PI;
        const pu = o.pivot[0] * W, pv = o.pivot[1] * H;
        const turnTx = (t: [number, number]): [number, number] => {
          const x = t[0] - pu, y = t[1] - pv, c = Math.cos(ang), sn = Math.sin(ang);
          return [pu + x * c - y * sn, pv + x * sn + y * c];
        };
        const ctr = isl.world.reduce((m, p) => [m[0] + p[0] / isl.world.length, m[1] + p[1] / isl.world.length, m[2] + p[2] / isl.world.length] as V3, [0, 0, 0] as V3);
        let best: { patch: SurfacePatch; err: number } | null = null;
        for (const sign of [1, -1]) {
          const next = { ...cloneSurface(s), rotation: (((s.rotation + sign * deg) % 360) + 360) % 360 };
          const want = turnTx(uvAt(ctr, isl.plane, s));
          const got = uvAt(ctr, isl.plane, next);
          next.offset = [s.offset[0] + want[0] - got[0], s.offset[1] + want[1] - got[1]];
          const pw = turnTx(uvAt(isl.world[0]!, isl.plane, s)), pg = uvAt(isl.world[0]!, isl.plane, next);
          const err = Math.hypot(pw[0] - pg[0], pw[1] - pg[1]);
          if (!best || err < best.err) best = { patch: { rotation: next.rotation, offset: next.offset }, err };
        }
        out.push({ id: isl.id, face: isl.face, patch: best!.patch });
      }
    }
    return out;
  };
  const begin = (kind: Op['kind'], at: [number, number], list = chosen()) => {
    if (!list.length) return;
    op.current = { kind, keys: new Set(list.map((i) => i.key)), start: at, pivot: centre(list), axis: null, base: new Map(list.map((i) => [i.key, cloneSurface(i.surface)])), key: `uv-${Date.now()}`, moved: false };
  };
  const update = (at: [number, number]) => {
    const o = op.current;
    if (!o) return;
    o.moved = true;
    st.setFaceSurfaces(patches(o, at), o.kind === 'grab' ? 'Move UVs' : o.kind === 'scale' ? 'Scale UVs' : 'Turn UVs', o.key);
  };
  const finish = (cancel: boolean) => {
    const o = op.current;
    op.current = null;
    if (cancel && o?.moved) st.undo();
  };
  const last = useRef<[number, number]>([0.5, 0.5]);

  // Keys (while the pointer is over the editor).
  const hover = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hover.current || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (mode === 'hotspot') {
        if ((k === 'delete' || k === 'x' || k === 'backspace') && hotSel !== null) {
          setHots(hots.filter((_, i) => i !== hotSel), 'Delete hotspot');
          setHotSel(null);
          e.preventDefault();
        }
        return;
      }
      const o = op.current;
      if (o && (k === 'x' || k === 'y')) {
        o.axis = o.axis === k ? null : k;
        update(last.current);
      } else if (o && (k === 'enter' || k === ' ')) finish(false);
      else if (o && k === 'escape') finish(true);
      else if (!o && (k === 'g' || k === 'r' || k === 's')) begin(k === 'g' ? 'grab' : k === 'r' ? 'rotate' : 'scale', last.current);
      else if (!o && k === 'a') setPicked(sel.size === islands.length ? new Set() : null);
      else return;
      e.preventDefault();
      e.stopPropagation();
      tick();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const hitIsland = (p: [number, number]) => {
    for (let n = islands.length - 1; n >= 0; n--) {
      const poly = islands[n]!.uv;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return islands[n]!;
    }
    return null;
  };
  const hitHot = (p: [number, number]) => {
    for (let i = hots.length - 1; i >= 0; i--) {
      const h = hots[i]!;
      if (p[0] >= h.x && p[0] <= h.x + h.w && p[1] >= h.y && p[1] <= h.y + h.h) return i;
    }
    return null;
  };
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const local = (e: React.PointerEvent | React.WheelEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onDown = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    const [cx, cy] = local(e);
    const at = toSheet(cx, cy);
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      pan.current = { x: cx, y: cy, vx: view.current.x, vy: view.current.y };
      return;
    }
    if (e.button === 2) {
      finish(true);
      tick();
      return;
    }
    if (op.current) {
      finish(false);
      tick();
      return;
    }
    if (mode === 'hotspot') {
      const i = hitHot(at);
      setHotSel(i);
      draft.current = i !== null ? { from: at, to: at, move: i, base: { ...hots[i]! } } : { from: [snapTo(at[0]), snapTo(at[1])], to: [snapTo(at[0]), snapTo(at[1])] };
      tick();
      return;
    }
    const hit = hitIsland(at);
    if (!hit) {
      if (!e.shiftKey) setPicked(new Set());
      return;
    }
    if (e.shiftKey) {
      const next = new Set(sel);
      if (next.has(hit.key)) next.delete(hit.key);
      else next.add(hit.key);
      setPicked(next);
      return;
    }
    const list = sel.has(hit.key) ? chosen() : [hit];
    if (!sel.has(hit.key)) setPicked(new Set([hit.key]));
    // Drag to move: grab from here.
    begin('grab', at, list);
    dragging.current = true;
  };
  const dragging = useRef(false);
  const onMove = (e: React.PointerEvent) => {
    const [cx, cy] = local(e);
    const at = toSheet(cx, cy);
    last.current = at;
    if (pan.current) {
      const p = pan.current;
      view.current.x = p.vx - (cx - p.x) / view.current.zoom;
      view.current.y = p.vy - (cy - p.y) / view.current.zoom;
      tick();
      return;
    }
    const d = draft.current;
    if (d) {
      if (d.move !== undefined && d.base) {
        const nx = snapTo(d.base.x + at[0] - d.from[0]), ny = snapTo(d.base.y + at[1] - d.from[1]);
        setHots(hots.map((h, i) => (i === d.move ? { ...h, x: nx, y: ny } : h)), 'Move hotspot', `hot-move-${d.move}`);
      } else d.to = [snapTo(at[0]), snapTo(at[1])];
      tick();
      return;
    }
    if (op.current) update(at);
  };
  const onUp = () => {
    pan.current = null;
    const d = draft.current;
    draft.current = null;
    if (d && d.move === undefined) {
      const x = Math.min(d.from[0], d.to[0]), y = Math.min(d.from[1], d.to[1]), w = Math.abs(d.to[0] - d.from[0]), h = Math.abs(d.to[1] - d.from[1]);
      if (w > 0 && h > 0) {
        setHots([...hots, { x, y, w, h }], 'Add hotspot');
        setHotSel(hots.length);
      }
    }
    if (dragging.current) {
      dragging.current = false;
      finish(false);
    }
    tick();
  };
  const onWheel = (e: React.WheelEvent) => {
    const [cx, cy] = local(e);
    const before = toSheet(cx, cy);
    view.current.zoom = Math.min(8000, Math.max(40, view.current.zoom * Math.exp(-e.deltaY * 0.0015)));
    const after = toSheet(cx, cy);
    view.current.x += before[0] - after[0];
    view.current.y += before[1] - after[1];
    tick();
  };

  const h = hotSel !== null ? hots[hotSel] : undefined;
  const setH = (patch: Partial<Hot>, key: string) => hotSel !== null && setHots(hots.map((x, i) => (i === hotSel ? { ...x, ...patch } : x)), 'Edit hotspot', `hot-${key}-${hotSel}`);
  const first = chosen()[0]?.surface ?? islands[0]?.surface;
  const fill = (cols: number, rows: number) => {
    const out: Hot[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: i / cols, y: j / rows, w: 1 / cols, h: 1 / rows });
    setHots(out, 'Hotspot grid');
  };

  return (
    <div className={pane ? 'cw-uv-in' : 'cw-plants cw-uv'}>
      <div className="cw-plants-view cw-uv-view" onPointerEnter={() => (hover.current = true)} onPointerLeave={() => (hover.current = false)}>
        <canvas ref={canvas} className="cw-uv-canvas" data-testid="uv-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
        <div className="cw-plants-height">
          {mode === 'uv'
            ? islands.length
              ? `${islands.length} ${L('faces', 'граней')} · ${materialLabel(faceMat, getLang())} · ${L('G move · R turn · S scale · X/Y axis · A all · wheel zoom · middle-drag pan', 'G двигать · R вращать · S масштаб · X/Y ось · A все · колесо — масштаб · средняя кнопка — сдвиг')}`
              : L('Select faces (Face tool) or brushes to see their UVs.', 'Выберите грани (инструмент «Грани») или браши, чтобы увидеть их UV.')
            : `${def ? def.name : L('No project materials yet', 'Пока нет материалов проекта')} · ${L('drag to draw a rectangle · click to select · Delete removes', 'тяните, чтобы нарисовать прямоугольник · щелчок — выбрать · Delete — удалить')}`}
        </div>
      </div>
      <aside className="cw-plants-props" aria-label={L('UV editor', 'Редактор UV')}>
        <Segmented label={L('Mode', 'Режим')} value={mode} onChange={(m) => setMode(m)} options={[{ value: 'uv', label: L('UVs', 'UV') }, { value: 'hotspot', label: L('Hotspots', 'Хотспоты') }]} />
        {mode === 'uv' ? (
          <>
            <div className="cw-lib-cats-h">{L('Selected faces', 'Выбранные грани')}</div>
            {first ? (
              <>
                <Row label={L('Align', 'Выравнивание')}>
                  <Segmented label={L('Align', 'Выравнивание')} value={first.align} onChange={(align) => st.setFaces({ align })} options={[{ value: 'world', label: L('World', 'Мир') }, { value: 'face', label: L('Face', 'Грань') }]} />
                </Row>
                <Row label={L('Offset U', 'Сдвиг U')}>
                  <NumberField label="U" ariaLabel={L('Offset U', 'Сдвиг U')} step={1} value={Math.round(first.offset[0] * 100) / 100} onChange={(v) => st.setFaces({ offset: [v, undefined] }, 'uv-ou')} onCommit={(v) => st.setFaces({ offset: [v, undefined] }, 'uv-ou')} />
                </Row>
                <Row label={L('Offset V', 'Сдвиг V')}>
                  <NumberField label="V" ariaLabel={L('Offset V', 'Сдвиг V')} step={1} value={Math.round(first.offset[1] * 100) / 100} onChange={(v) => st.setFaces({ offset: [undefined, v] }, 'uv-ov')} onCommit={(v) => st.setFaces({ offset: [undefined, v] }, 'uv-ov')} />
                </Row>
                <Row label={L('Scale U', 'Масштаб U')}>
                  <NumberField label="U" ariaLabel={L('Scale U', 'Масштаб U')} step={0.05} value={Math.round(first.scale[0] * 1000) / 1000} onChange={(v) => st.setFaces({ scale: [v, undefined] }, 'uv-su')} onCommit={(v) => st.setFaces({ scale: [v, undefined] }, 'uv-su')} />
                </Row>
                <Row label={L('Scale V', 'Масштаб V')}>
                  <NumberField label="V" ariaLabel={L('Scale V', 'Масштаб V')} step={0.05} value={Math.round(first.scale[1] * 1000) / 1000} onChange={(v) => st.setFaces({ scale: [undefined, v] }, 'uv-sv')} onCommit={(v) => st.setFaces({ scale: [undefined, v] }, 'uv-sv')} />
                </Row>
                <Row label={L('Turn', 'Поворот')}>
                  <NumberField label="°" ariaLabel={L('Turn', 'Поворот')} step={15} value={Math.round(first.rotation * 10) / 10} onChange={(v) => st.setFaces({ rotation: ((v % 360) + 360) % 360 }, 'uv-rot')} onCommit={(v) => st.setFaces({ rotation: ((v % 360) + 360) % 360 }, 'uv-rot')} />
                </Row>
                <div className="cw-plants-actions">
                  <Button onClick={() => st.fitFaces()}>{L('Fit', 'Вписать')}</Button>
                  <Button onClick={() => st.hotspotFaces()}>{L('Hotspot fit', 'По хотспотам')}</Button>
                </div>
                <div className="cw-muted cw-hint">{L('These change every selected face (the islands too). Hotspot fit uses each face’s material’s hotspot sheet.', 'Меняют все выбранные грани. «По хотспотам» берёт лист хотспотов материала каждой грани.')}</div>
              </>
            ) : (
              <div className="cw-muted cw-hint">{L('Nothing selected.', 'Ничего не выбрано.')}</div>
            )}
          </>
        ) : (
          <>
            <Row label={L('Material', 'Материал')}>
              <select className="cw-input" aria-label={L('Hotspot material', 'Материал хотспотов')} value={shownMat} onChange={(e) => { setHotMat(e.currentTarget.value); setHotSel(null); }}>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Row>
            {def && (
              <>
                <Row label={L('Map when painted', 'Наносить при покраске')}>
                  <Switch label={L('Map when painted', 'Наносить при покраске')} checked={!!def.hotspotAuto} onChange={(v) => st.setMaterials(materials.map((m) => (m.id === def.id ? { ...m, hotspotAuto: v } : m)), v ? 'Hotspot mapping on' : 'Hotspot mapping off')} />
                </Row>
                <Row label={L('Snap', 'Шаг')}>
                  <select className="cw-input" aria-label={L('Snap', 'Шаг')} value={snap} onChange={(e) => setSnap(Number(e.currentTarget.value))}>
                    {[4, 8, 16, 32, 64, 128].map((n) => (
                      <option key={n} value={n}>
                        1/{n}
                      </option>
                    ))}
                  </select>
                </Row>
                <div className="cw-lib-cats-h">
                  {hots.length} {L('rectangles', 'прямоугольников')}
                </div>
                {h ? (
                  <>
                    <Row label="X">
                      <NumberField label="#" ariaLabel={L('Hotspot X', 'Хотспот X')} step={1 / snap} value={Math.round(h.x * 1e4) / 1e4} onChange={(v) => setH({ x: v }, 'x')} onCommit={(v) => setH({ x: v }, 'x')} />
                    </Row>
                    <Row label="Y">
                      <NumberField label="#" ariaLabel={L('Hotspot Y', 'Хотспот Y')} step={1 / snap} value={Math.round(h.y * 1e4) / 1e4} onChange={(v) => setH({ y: v }, 'y')} onCommit={(v) => setH({ y: v }, 'y')} />
                    </Row>
                    <Row label={L('Width', 'Ширина')}>
                      <NumberField label="#" ariaLabel={L('Hotspot width', 'Ширина хотспота')} step={1 / snap} value={Math.round(h.w * 1e4) / 1e4} onChange={(v) => setH({ w: Math.max(1e-3, v) }, 'w')} onCommit={(v) => setH({ w: Math.max(1e-3, v) }, 'w')} />
                    </Row>
                    <Row label={L('Height', 'Высота')}>
                      <NumberField label="#" ariaLabel={L('Hotspot height', 'Высота хотспота')} step={1 / snap} value={Math.round(h.h * 1e4) / 1e4} onChange={(v) => setH({ h: Math.max(1e-3, v) }, 'h')} onCommit={(v) => setH({ h: Math.max(1e-3, v) }, 'h')} />
                    </Row>
                    <Row label={L('May turn 90°', 'Можно повернуть на 90°')}>
                      <Switch label={L('May turn 90°', 'Можно повернуть на 90°')} checked={h.rotate !== false} onChange={(v) => setH({ rotate: v ? undefined : false }, 'rot')} />
                    </Row>
                    <div className="cw-plants-actions">
                      <Button onClick={() => { setHots(hots.filter((_, i) => i !== hotSel), 'Delete hotspot'); setHotSel(null); }}>{L('Delete rectangle', 'Удалить прямоугольник')}</Button>
                    </div>
                  </>
                ) : (
                  <div className="cw-muted cw-hint">{L('Drag on the texture to draw a rectangle; click one to edit it.', 'Тяните по текстуре, чтобы нарисовать прямоугольник; щёлкните, чтобы изменить.')}</div>
                )}
                <div className="cw-lib-cats-h">{L('Quick sheets', 'Быстрые листы')}</div>
                <div className="cw-plants-actions">
                  <Button size="sm" onClick={() => fill(2, 2)}>2×2</Button>
                  <Button size="sm" onClick={() => fill(4, 4)}>4×4</Button>
                  <Button size="sm" onClick={() => setHots([{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.25 }, { x: 0, y: 0.75, w: 0.5, h: 0.25 }, { x: 0.5, y: 0.75, w: 0.5, h: 0.125 }, { x: 0.5, y: 0.875, w: 0.5, h: 0.125 }], 'Hotspot trims')}>
                    {L('Trims', 'Полосы')}
                  </Button>
                  <Button size="sm" onClick={() => { setHots([], 'Clear hotspots'); setHotSel(null); }}>{L('Clear', 'Очистить')}</Button>
                </div>
                <div className="cw-muted cw-hint">{L('With “Map when painted” on, painting this material onto faces fits each into the rectangle that best matches its shape and size (turned when allowed). Hotspot fit in UVs mode refits faces already painted.', 'С «Наносить при покраске» каждая окрашиваемая грань вписывается в прямоугольник, лучше всего подходящий по форме и размеру. «По хотспотам» в режиме UV переподгоняет уже окрашенные грани.')}</div>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
