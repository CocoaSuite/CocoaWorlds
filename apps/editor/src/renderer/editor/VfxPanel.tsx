/**
 * The VFX workspace: the project's effects, made from presets and shaped layer by layer (emitters and shape
 * animations), previewed live over a test ground or in a dark room, with a timeline to play and scrub.
 * Effects are kept in the project (for every scene); the Effect component and the Play effect block use them.
 */
import {
  VFX_PRESETS,
  cloneEffect,
  effectsOf,
  newEffect,
  newEmitter,
  newShapeAnim,
  sampleGradient,
  type VfxArea,
  type VfxCurve,
  type VfxEase,
  type VfxEffect,
  type VfxEmitter,
  type VfxGradient,
  type VfxKey,
  type VfxLayer,
  type VfxLook,
  type VfxRange,
  type VfxShapeAnim,
  type VfxShapeKind,
} from '@cocoaworlds/core';
import { Button, ColorField, NumberField, Segmented, Switch } from '@cocoaworlds/ui';
import { useEffect, useReducer, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getLang } from '../i18n';
import { useEditor } from '../store';
import { VfxRenderer, type VfxHandle } from '../viewport/vfx';
import { Row } from './MaterialsPanel';

const L = (en: string, ru: string) => (getLang() === 'ru' ? ru : en);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, step = 0.01) => Math.round(v / step) * step;

/** The preview's clock, shared by the preview (which runs it) and the timeline (which shows and sets it). */
interface Transport {
  time: number;
  playing: boolean;
  loop: boolean;
  count: number;
  seek: number | null;
  restart: boolean;
  listeners: Set<() => void>;
}

export function VfxPanel() {
  const st = useEditor.getState();
  const list = useEditor((s) => s.session?.project.settings.effects) ?? [];
  const sel = useEditor((s) => s.selection);
  const textures = useEditor((s) => s.assets.textures);
  const [pick, setPick] = useState<string | null>(list[0]?.id ?? null);
  const [layerId, setLayerId] = useState<string | null>(null);
  const [keyIndex, setKeyIndex] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [bounds, setBounds] = useState(true);
  const tr = useRef<Transport>({ time: 0, playing: true, loop: true, count: 0, seek: null, restart: false, listeners: new Set() }).current;
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const fx = list.find((e) => e.id === pick) ?? list[0] ?? null;
  const layer = fx?.layers.find((l) => l.id === layerId) ?? fx?.layers[0] ?? null;

  /** Change the picked effect (edits with the same key merge into one undo step). */
  const edit = (change: (e: VfxEffect) => void, label = 'Edit effect', key?: string) => {
    if (!fx) return;
    const copy = structuredClone(fx);
    change(copy);
    st.setEffects(effectsOf(st.session?.project.settings).map((e) => (e.id === fx.id ? copy : e)), label, key ? `vfx-${fx.id}-${key}` : undefined);
  };
  const editLayer = (change: (l: VfxLayer) => void, key?: string) => edit((e) => change(e.layers.find((l) => l.id === layer?.id)!), 'Edit effect layer', key && `${layer?.id}-${key}`);

  const add = (e: VfxEffect) => {
    st.setEffects([...effectsOf(st.session?.project.settings), e], 'New effect');
    setPick(e.id);
    setLayerId(null);
    tr.restart = true;
    tr.playing = true;
  };
  const fromPreset = (p: (typeof VFX_PRESETS)[number]) => {
    const name = uniqueName(p.key, list);
    add({ ...cloneEffect(p.effect, `fx_${Date.now().toString(36)}`, name), preset: p.key });
  };
  const remove = (id: string) => st.setEffects(list.filter((e) => e.id !== id), 'Delete effect');

  // Shape keys: the one picked stays in range.
  const keys = layer?.kind === 'shape' ? layer.keys : [];
  const key = keys[Math.min(keyIndex, keys.length - 1)];

  return (
    <div className="cw-plants cw-vfx">
      <aside className="cw-plants-list" aria-label={L('Effects', 'Эффекты')}>
        <div className="cw-lib-cats-h">{L('Presets', 'Заготовки')}</div>
        <div className="cw-sky-presets">
          {VFX_PRESETS.map((p) => (
            <button key={p.key} type="button" className="cw-sky-preset" aria-label={L(`New effect from ${p.name.en}`, `Новый эффект из «${p.name.ru}»`)} onClick={() => fromPreset(p)}>
              <span className="cw-vfx-swatch">
                <EffectIcon effect={p.effect} />
              </span>
              <span>{p.name[getLang() === 'ru' ? 'ru' : 'en']}</span>
            </button>
          ))}
        </div>
        <div className="cw-lib-cats-h">{L('Project effects', 'Эффекты проекта')}</div>
        <div role="list" aria-label={L('Project effects', 'Эффекты проекта')} className="cw-vfx-rows">
          {list.map((e) => (
            <div key={e.id} role="listitem" className={`cw-vfx-row${e.id === fx?.id ? ' on' : ''}`}>
              {renaming === e.id ? (
                <input
                  className="cw-input"
                  autoFocus
                  aria-label={L('Effect name', 'Имя эффекта')}
                  defaultValue={e.name}
                  onBlur={(ev) => {
                    const name = ev.currentTarget.value.trim();
                    if (name && name !== e.name) st.setEffects(list.map((x) => (x.id === e.id ? { ...x, name } : x)), 'Rename effect');
                    setRenaming(null);
                  }}
                  onKeyDown={(ev) => {
                    ev.stopPropagation();
                    if (ev.key === 'Enter') ev.currentTarget.blur();
                    if (ev.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="cw-vfx-row-main"
                  title={L('Double-click to rename', 'Двойной щелчок — переименовать')}
                  onClick={() => {
                    setPick(e.id);
                    setLayerId(null);
                    tr.restart = true;
                    tr.playing = true;
                  }}
                  onDoubleClick={() => setRenaming(e.id)}
                >
                  <span className="cw-vfx-dot" />
                  <span className="cw-vfx-name">{e.name}</span>
                  <span className="cw-muted">{e.layers.length}</span>
                </button>
              )}
              <button type="button" className="cw-vfx-x" aria-label={L(`Duplicate effect ${e.name}`, `Копировать эффект ${e.name}`)} title={L('Duplicate', 'Копировать')} onClick={() => add(cloneEffect(e, `fx_${Date.now().toString(36)}`, uniqueName(e.name, list)))}>
                ⧉
              </button>
              <button type="button" className="cw-vfx-x" aria-label={L(`Delete effect ${e.name}`, `Удалить эффект ${e.name}`)} onClick={() => remove(e.id)}>
                ×
              </button>
            </div>
          ))}
          {!list.length && <div className="cw-muted cw-hint">{L('No effects yet: pick a preset or make a new one.', 'Эффектов пока нет: выберите заготовку или создайте новый.')}</div>}
        </div>
        <Button onClick={() => add(newEffect(uniqueName(L('Effect', 'Эффект'), list)))}>{L('New effect', 'Новый эффект')}</Button>
        {fx && (
          <>
            <div className="cw-lib-cats-h">{L('Layers', 'Слои')}</div>
            <div className="cw-vfx-rows" role="list" aria-label={L('Layers', 'Слои')}>
              {fx.layers.map((l, i) => (
                <div key={l.id} role="listitem" className={`cw-vfx-row${l.id === layer?.id ? ' on' : ''}${l.visible ? '' : ' off'}`}>
                  <button type="button" className="cw-vfx-row-main" onClick={() => setLayerId(l.id)}>
                    <span className={`cw-vfx-dot${l.kind === 'shape' ? ' sq' : ''}`} />
                    <span className="cw-vfx-name">{l.name}</span>
                    <span className="cw-muted">{l.kind === 'emitter' ? L('Emitter', 'Эмиттер') : L('Shape anim', 'Анимация')}</span>
                  </button>
                  <button type="button" className="cw-vfx-x" aria-label={L(`Move ${l.name} up`, `Поднять ${l.name}`)} disabled={!i} onClick={() => edit((e) => void e.layers.splice(i - 1, 0, ...e.layers.splice(i, 1)), 'Reorder layers')}>
                    ↑
                  </button>
                  <button type="button" className="cw-vfx-x" aria-label={l.visible ? L(`Hide ${l.name}`, `Скрыть ${l.name}`) : L(`Show ${l.name}`, `Показать ${l.name}`)} onClick={() => edit((e) => void (e.layers[i]!.visible = !l.visible), 'Toggle layer')}>
                    {l.visible ? '◉' : '○'}
                  </button>
                  <button type="button" className="cw-vfx-x" aria-label={L(`Delete layer ${l.name}`, `Удалить слой ${l.name}`)} onClick={() => edit((e) => void e.layers.splice(i, 1), 'Delete layer')}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="cw-plants-actions">
              <Button
                onClick={() => {
                  const l = newEmitter({ name: L('Emitter', 'Эмиттер'), duration: fx.duration });
                  edit((e) => void e.layers.push(l), 'Add emitter');
                  setLayerId(l.id);
                }}
              >
                + {L('Emitter', 'Эмиттер')}
              </Button>
              <Button
                onClick={() => {
                  const l = newShapeAnim({ name: L('Shape', 'Фигура') });
                  edit((e) => void e.layers.push(l), 'Add shape animation');
                  setLayerId(l.id);
                }}
              >
                + {L('Shape anim', 'Анимация')}
              </Button>
            </div>
          </>
        )}
      </aside>

      <div className="cw-vfx-stage">
        <div className="cw-plants-view">
          {fx ? <VfxPreview effect={fx} tr={tr} dark={dark} bounds={bounds} /> : <div className="cw-plants-empty cw-muted">{L('Pick a preset on the left to make your first effect.', 'Выберите заготовку слева, чтобы сделать первый эффект.')}</div>}
          {fx && (
            <div className="cw-vfx-chips">
              <button type="button" className={dark ? '' : 'on'} onClick={() => setDark(false)}>
                {L('Test ground', 'Тестовая площадка')}
              </button>
              <button type="button" className={dark ? 'on' : ''} onClick={() => setDark(true)}>
                {L('Dark room', 'Тёмная комната')}
              </button>
              <button
                type="button"
                className={tr.loop ? 'on' : ''}
                aria-pressed={tr.loop}
                onClick={() => {
                  tr.loop = !tr.loop;
                  redraw();
                }}
              >
                {L('Loop', 'Повтор')}
              </button>
              <button type="button" className={bounds ? 'on' : ''} aria-pressed={bounds} onClick={() => setBounds(!bounds)}>
                {L('Show origin', 'Показать точку')}
              </button>
            </div>
          )}
        </div>
        {fx && <Timeline fx={fx} tr={tr} layerId={layer?.id ?? null} onPickLayer={setLayerId} onPickKey={(lid, i) => (setLayerId(lid), setKeyIndex(i))} onMoveLayer={(lid, start) => edit((e) => void (e.layers.find((l) => l.id === lid)!.start = start), 'Move layer', `${lid}-start`)} />}
      </div>

      <aside className="cw-plants-props" aria-label={L('Effect settings', 'Настройки эффекта')}>
        {fx && (
          <>
            <div className="cw-lib-cats-h">{L('Effect', 'Эффект')}</div>
            <Num label={L('Length', 'Длина')} unit="s" step={0.05} value={fx.duration} min={0.05} max={60} onChange={(v) => edit((e) => void (e.duration = v), 'Effect length', 'len')} />
            <Row label={L('Repeats', 'Повторяется')}>
              <Switch label={L('Effect repeats', 'Эффект повторяется')} checked={fx.loop} onChange={(v) => edit((e) => void (e.loop = v), v ? 'Effect repeats' : 'Effect plays once')} />
            </Row>
          </>
        )}
        {fx && layer && (
          <>
            <div className="cw-lib-cats-h">
              {layer.kind === 'emitter' ? L('Emitter', 'Эмиттер') : L('Shape animation', 'Анимация фигуры')} · {layer.name}
            </div>
            <Row label={L('Name', 'Имя')}>
              <input key={layer.id} className="cw-input" aria-label={L('Layer name', 'Имя слоя')} defaultValue={layer.name} onKeyDown={(ev) => ev.stopPropagation()} onBlur={(ev) => ev.currentTarget.value.trim() && editLayer((l) => void (l.name = ev.currentTarget.value.trim()))} />
            </Row>
            <Num label={L('Starts at', 'Начало')} unit="s" step={0.05} value={layer.start} min={0} max={60} onChange={(v) => editLayer((l) => void (l.start = v), 'start')} />
            <Num label={L('Lasts', 'Длится')} unit="s" step={0.05} value={layer.duration} min={0.01} max={60} onChange={(v) => editLayer((l) => void (l.duration = v), 'dur')} />
            {layer.kind === 'emitter' ? <EmitterProps e={layer} editLayer={editLayer} /> : <ShapeProps s={layer} keyIndex={Math.min(keyIndex, keys.length - 1)} setKeyIndex={setKeyIndex} k={key} editLayer={editLayer} tr={tr} />}
            <LookProps look={layer.look} textures={textures} editLayer={editLayer} align={layer.kind === 'emitter' ? layer.alignToMotion : null} />
          </>
        )}
        {fx && (
          <>
            <div className="cw-lib-cats-h">{L('Use in game', 'В игре')}</div>
            <div className="cw-vfx-code">
              {L('Play effect', 'Показать эффект')} “{fx.name}” {L('at', 'у')} {L('this object', 'этого объекта')}
            </div>
            <div className="cw-muted cw-hint">{L('In scripts: the Play effect block (Effects). On an object: the Effect component, which Turn on and Turn off blocks start and stop.', 'В скриптах: блок «Показать эффект» (Эффекты). На объекте: компонент «Эффект», который блоки «Включить» и «Выключить» запускают и останавливают.')}</div>
            <Button
              disabled={sel.length !== 1}
              onClick={() => {
                const id = sel[0]!;
                const ent = st.doc?.get(id);
                if (!ent) return;
                st.begin('Add effect to object');
                if (!ent.components.vfx) st.addComponent(id, 'vfx');
                st.setComponentField(id, 'vfx', 'effect', fx.id);
                st.commit();
                st.notify(L(`Added “${fx.name}” to ${ent.name}`, `«${fx.name}» добавлен к ${ent.name}`));
              }}
            >
              {sel.length === 1 ? L('Add to selected object', 'Добавить к выбранному объекту') : L('Select one object in the scene to attach', 'Выберите один объект в сцене')}
            </Button>
          </>
        )}
      </aside>
    </div>
  );
}

function uniqueName(base: string, list: VfxEffect[]): string {
  const names = new Set(list.map((e) => e.name));
  const stem = base.replace(/\s+\d+$/, '');
  if (!names.has(stem)) return stem;
  for (let i = 2; ; i++) if (!names.has(`${stem} ${i}`)) return `${stem} ${i}`;
}

// ── Fields ──

function Num({ label, value, onChange, step = 1, unit = '#', min = -1e9, max = 1e9 }: { label: string; value: number; onChange: (v: number) => void; step?: number; unit?: string; min?: number; max?: number }) {
  const set = (v: number) => onChange(clamp(round(v, step < 1 ? Math.min(step, 0.01) : 1), min, max));
  return (
    <Row label={label}>
      <NumberField label={unit} ariaLabel={label} step={step} value={value} onChange={set} onCommit={set} />
    </Row>
  );
}

function RangeField({ label, value, onChange, step = 1, unit = '#', min = -1e9 }: { label: string; value: VfxRange; onChange: (v: VfxRange) => void; step?: number; unit?: string; min?: number }) {
  const set = (i: 0 | 1) => (v: number) => {
    const next: VfxRange = [...value];
    next[i] = Math.max(min, round(v, step < 1 ? Math.min(step, 0.01) : 1));
    if (next[0] > next[1]) next[i ? 0 : 1] = next[i];
    onChange(next);
  };
  return (
    <Row label={label}>
      <span className="cw-vfx-range">
        <NumberField label={unit} ariaLabel={`${label} ${L('from', 'от')}`} step={step} value={value[0]} onChange={set(0)} onCommit={set(0)} />
        <span className="cw-muted">–</span>
        <NumberField label={unit} ariaLabel={`${label} ${L('to', 'до')}`} step={step} value={value[1]} onChange={set(1)} onCommit={set(1)} />
      </span>
    </Row>
  );
}

/** A value over a particle's life: drag points, click to add one, double-click one to take it away. */
function CurveField({ label, value, onChange, max = 1 }: { label: string; value: VfxCurve; onChange: (v: VfxCurve) => void; max?: number }) {
  const W = 180, H = 60, P = 5;
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const toXY = ([t, v]: [number, number]) => [P + t * (W - 2 * P), H - P - (v / max) * (H - 2 * P)] as const;
  const fromEvent = (ev: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    const t = clamp(((ev.clientX - r.left) / r.width) * W, P, W - P);
    const y = clamp(((ev.clientY - r.top) / r.height) * H, P, H - P);
    return [round((t - P) / (W - 2 * P)), round(((H - P - y) / (H - 2 * P)) * max)];
  };
  const pts = [...value].sort((a, b) => a[0] - b[0]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${toXY(p).join(' ')}`).join(' ');
  const flat = pts.length ? `M${P} ${toXY(pts[0]!)[1]} L${toXY(pts[0]!)[0]} ${toXY(pts[0]!)[1]} M${toXY(pts[pts.length - 1]!).join(' ')} L${W - P} ${toXY(pts[pts.length - 1]!)[1]}` : '';
  return (
    <Row label={label}>
      <svg
        ref={ref}
        className="cw-vfx-curve"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: ${pts.map(([t, v]) => `${Math.round(t * 100)}% ${v}`).join(', ')}`}
        onPointerDown={(ev) => {
          if (ev.target !== ref.current) return;
          const p = fromEvent(ev);
          const next = [...pts, p].sort((a, b) => a[0] - b[0]);
          onChange(next);
          setDrag(next.indexOf(p));
          ref.current!.setPointerCapture(ev.pointerId);
        }}
        onPointerMove={(ev) => {
          if (drag === null) return;
          const next = pts.map((p) => [...p] as [number, number]);
          next[drag] = fromEvent(ev);
          onChange(next);
        }}
        onPointerUp={() => setDrag(null)}
      >
        <path d={`M${P} ${H - P}H${W - P}`} className="cw-vfx-curve-axis" />
        <path d={flat} className="cw-vfx-curve-flat" />
        <path d={path} className="cw-vfx-curve-line" />
        {pts.map((p, i) => {
          const [x, y] = toXY(p);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={4}
              className="cw-vfx-curve-pt"
              onPointerDown={(ev) => {
                ev.stopPropagation();
                setDrag(i);
                ref.current!.setPointerCapture(ev.pointerId);
              }}
              onDoubleClick={() => pts.length > 1 && onChange(pts.filter((_, j) => j !== i))}
            />
          );
        })}
      </svg>
    </Row>
  );
}

function GradientField({ label, value, onChange }: { label: string; value: VfxGradient; onChange: (v: VfxGradient) => void }) {
  const stops = [...value].sort((a, b) => a.t - b.t);
  const css = stops.length > 1 ? `linear-gradient(90deg, ${stops.map((s) => `${s.colour} ${Math.round(s.t * 100)}%`).join(', ')})` : (stops[0]?.colour ?? '#ffffff');
  const set = (i: number, patch: Partial<VfxGradient[number]>) => onChange(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <>
      <Row label={label}>
        <span className="cw-vfx-grad" style={{ background: css }} />
      </Row>
      {stops.map((s, i) => (
        <Row key={i} label={i ? '' : L('Stops', 'Точки')}>
          <span className="cw-vfx-stop">
            <ColorField label={`${label} ${i + 1}`} value={s.colour} onChange={(v) => set(i, { colour: v })} />
            <NumberField label="%" ariaLabel={`${label} ${i + 1} ${L('at', 'на')}`} step={5} value={Math.round(s.t * 100)} onChange={(v) => set(i, { t: clamp(v, 0, 100) / 100 })} onCommit={(v) => set(i, { t: clamp(v, 0, 100) / 100 })} />
            <button type="button" className="cw-vfx-x" disabled={stops.length < 2} aria-label={L(`Remove colour ${i + 1}`, `Убрать цвет ${i + 1}`)} onClick={() => onChange(stops.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        </Row>
      ))}
      {stops.length < 6 && (
        <Row label="">
          <Button size="sm" onClick={() => onChange([...stops, { t: 1, colour: stops[stops.length - 1]?.colour ?? '#ffffff' }])}>
            + {L('Colour', 'Цвет')}
          </Button>
        </Row>
      )}
    </>
  );
}

type EditLayer = (change: (l: VfxLayer) => void, key?: string) => void;

function EmitterProps({ e, editLayer }: { e: VfxEmitter; editLayer: EditLayer }) {
  const ed = (change: (x: VfxEmitter) => void, key?: string) => editLayer((l) => change(l as VfxEmitter), key);
  return (
    <>
      <Row label={L('Spawn', 'Появление')}>
        <Segmented<'rate' | 'burst'> label={L('Spawn', 'Появление')} value={e.spawn} onChange={(v) => ed((x) => void (x.spawn = v))} options={[{ value: 'rate', label: L('Stream', 'Поток') }, { value: 'burst', label: L('Burst', 'Залп') }]} />
      </Row>
      {e.spawn === 'rate' ? <Num label={L('Per second', 'В секунду')} value={e.rate} min={0} max={2000} onChange={(v) => ed((x) => void (x.rate = v), 'rate')} /> : <Num label={L('Count', 'Сколько')} value={e.count} min={0} max={2000} onChange={(v) => ed((x) => void (x.count = Math.round(v)), 'count')} />}
      <RangeField label={L('Lifetime', 'Живёт')} unit="s" step={0.05} min={0.01} value={e.life} onChange={(v) => ed((x) => void (x.life = v), 'life')} />
      <Row label={L('Area', 'Область')}>
        <select className="cw-input cw-select" aria-label={L('Area', 'Область')} value={e.area} onChange={(ev) => ed((x) => void (x.area = ev.target.value as VfxArea))}>
          <option value="point">{L('Point', 'Точка')}</option>
          <option value="disc">{L('Disc', 'Диск')}</option>
          <option value="sphere">{L('Ball', 'Шар')}</option>
          <option value="box">{L('Box', 'Коробка')}</option>
        </select>
      </Row>
      <Num label={L('Start height', 'Высота начала')} unit="u" value={e.rise ?? 0} onChange={(v) => ed((x) => void (x.rise = v), 'rise')} />
      {e.area !== 'point' && <Num label={L('Area size', 'Размер области')} unit="u" value={e.areaSize} min={0} max={5000} onChange={(v) => ed((x) => void (x.areaSize = v), 'area')} />}
      <Num label={L('Spread', 'Разброс')} unit="°" value={e.spread} min={0} max={180} onChange={(v) => ed((x) => void (x.spread = v), 'spread')} />
      <RangeField label={L('Speed (u/s)', 'Скорость (u/с)')} unit="#" step={5} min={0} value={e.speed} onChange={(v) => ed((x) => void (x.speed = v), 'speed')} />
      <Num label={L('Gravity (u/s²)', 'Тяжесть (u/с²)')} unit="#" step={10} value={e.gravity} onChange={(v) => ed((x) => void (x.gravity = v), 'grav')} />
      <Num label={L('Drag', 'Торможение')} step={0.1} value={e.drag} min={0} max={20} onChange={(v) => ed((x) => void (x.drag = v), 'drag')} />
      <RangeField label={L('Size', 'Размер')} unit="u" step={0.5} min={0} value={e.size} onChange={(v) => ed((x) => void (x.size = v), 'size')} />
      <RangeField label={L('Spin (°/s)', 'Вращение (°/с)')} unit="°" step={10} min={0} value={e.spin} onChange={(v) => ed((x) => void (x.spin = v), 'spin')} />
      <div className="cw-lib-cats-h">{L('Over lifetime', 'За время жизни')}</div>
      <CurveField label={L('Size', 'Размер')} max={3} value={e.sizeOverLife} onChange={(v) => ed((x) => void (x.sizeOverLife = v), 'sizeCurve')} />
      <CurveField label={L('Speed', 'Скорость')} max={3} value={e.speedOverLife} onChange={(v) => ed((x) => void (x.speedOverLife = v), 'speedCurve')} />
      <CurveField label={L('Opacity', 'Непрозрачность')} value={e.opacityOverLife} onChange={(v) => ed((x) => void (x.opacityOverLife = v), 'opCurve')} />
      <GradientField label={L('Colour', 'Цвет')} value={e.colourOverLife} onChange={(v) => ed((x) => void (x.colourOverLife = v), 'grad')} />
      <div className="cw-muted cw-hint">{L('Curves: drag a point, click to add one, double-click one to remove it. Left is when a particle is born, right when it dies.', 'Кривые: тяните точку, щелчок — добавить, двойной щелчок — убрать. Слева — рождение частицы, справа — исчезновение.')}</div>
    </>
  );
}

function ShapeProps({ s, k, keyIndex, setKeyIndex, editLayer, tr }: { s: VfxShapeAnim; k: VfxKey | undefined; keyIndex: number; setKeyIndex: (i: number) => void; editLayer: EditLayer; tr: Transport }) {
  const ed = (change: (x: VfxShapeAnim) => void, key?: string) => editLayer((l) => change(l as VfxShapeAnim), key);
  const edKey = (change: (x: VfxKey) => void, key?: string) =>
    ed((x) => {
      change(x.keys[keyIndex]!);
      x.keys.sort((a, b) => a.t - b.t);
    }, key && `k${keyIndex}-${key}`);
  const addKey = () => {
    const t = clamp(round(tr.time - s.start), 0, s.duration);
    const near = [...s.keys].reverse().find((x) => x.t <= t) ?? s.keys[0];
    const nk: VfxKey = near ? { ...near, t } : { t, size: 20, colour: '#ececec', opacity: 1, rotation: 0, rise: 0, ease: 'linear' };
    const next = [...s.keys.filter((x) => Math.abs(x.t - t) > 1e-3), nk].sort((a, b) => a.t - b.t);
    ed((x) => void (x.keys = next), 'addkey');
    setKeyIndex(next.indexOf(nk));
  };
  return (
    <>
      <div className="cw-lib-cats-h">{L('Keyframes', 'Ключи')}</div>
      <div className="cw-vfx-keys" role="list" aria-label={L('Keyframes', 'Ключи')}>
        {s.keys.map((x, i) => (
          <button key={i} type="button" role="listitem" className={i === keyIndex ? 'on' : ''} onClick={() => setKeyIndex(i)}>
            {x.t.toFixed(2)}s
          </button>
        ))}
      </div>
      <div className="cw-plants-actions">
        <Button size="sm" onClick={addKey}>
          + {L('Key at playhead', 'Ключ на курсоре')}
        </Button>
        <Button size="sm" disabled={s.keys.length < 2 || !k} onClick={() => (ed((x) => void x.keys.splice(keyIndex, 1), 'delkey'), setKeyIndex(Math.max(0, keyIndex - 1)))}>
          {L('Delete key', 'Удалить ключ')}
        </Button>
      </div>
      {k && (
        <>
          <Num label={L('Time', 'Время')} unit="s" step={0.05} min={0} max={s.duration} value={k.t} onChange={(v) => edKey((x) => void (x.t = v), 't')} />
          <Num label={L('Size', 'Размер')} unit="u" step={1} min={0} value={k.size} onChange={(v) => edKey((x) => void (x.size = v), 'size')} />
          <Row label={L('Colour', 'Цвет')}>
            <ColorField label={L('Key colour', 'Цвет ключа')} value={k.colour} onChange={(v) => edKey((x) => void (x.colour = v), 'col')} />
          </Row>
          <Num label={L('Opacity', 'Непрозрачность')} step={0.05} min={0} max={1} value={k.opacity} onChange={(v) => edKey((x) => void (x.opacity = v), 'op')} />
          <Num label={L('Rotation', 'Поворот')} unit="°" step={5} value={k.rotation} onChange={(v) => edKey((x) => void (x.rotation = v), 'rot')} />
          <Num label={L('Height', 'Высота')} unit="u" step={1} value={k.rise} onChange={(v) => edKey((x) => void (x.rise = v), 'rise')} />
          <Row label={L('To next key', 'К следующему')}>
            <select className="cw-input cw-select" aria-label={L('Easing to the next key', 'Переход к следующему ключу')} value={k.ease} onChange={(ev) => edKey((x) => void (x.ease = ev.target.value as VfxEase))}>
              <option value="linear">{L('Even', 'Ровно')}</option>
              <option value="in">{L('Speed up', 'Разгон')}</option>
              <option value="out">{L('Slow down', 'Замедление')}</option>
              <option value="inOut">{L('Smooth', 'Плавно')}</option>
              <option value="step">{L('Jump', 'Скачком')}</option>
            </select>
          </Row>
        </>
      )}
    </>
  );
}

const SHAPE_LABELS: { value: VfxShapeKind; en: string; ru: string }[] = [
  { value: 'circle', en: 'Circle', ru: 'Круг' },
  { value: 'square', en: 'Square', ru: 'Квадрат' },
  { value: 'diamond', en: 'Diamond', ru: 'Ромб' },
  { value: 'triangle', en: 'Triangle', ru: 'Треугольник' },
  { value: 'star', en: 'Star', ru: 'Звезда' },
  { value: 'ring', en: 'Ring', ru: 'Кольцо' },
  { value: 'line', en: 'Line', ru: 'Линия' },
];

function LookProps({ look, textures, editLayer, align }: { look: VfxLook; textures: { path: string; name: string }[]; editLayer: EditLayer; align: boolean | null }) {
  const ed = (patch: Partial<VfxLook>) => editLayer((l) => void (l.look = { ...l.look, ...patch }));
  return (
    <>
      <div className="cw-lib-cats-h">{L('Look', 'Вид')}</div>
      <Row label={L('Style', 'Стиль')}>
        <Segmented<VfxLook['style']> label={L('Style', 'Стиль')} value={look.style} onChange={(v) => ed({ style: v })} options={[{ value: 'vector', label: L('Vector', 'Вектор') }, { value: 'soft', label: L('Soft', 'Мягкий') }, { value: 'texture', label: L('Image', 'Картинка') }]} />
      </Row>
      {look.style !== 'texture' ? (
        <Row label={L('Shape', 'Фигура')}>
          <span className="cw-vfx-shapes" role="radiogroup" aria-label={L('Shape', 'Фигура')}>
            {SHAPE_LABELS.map((s) => (
              <button key={s.value} type="button" role="radio" aria-checked={look.shape === s.value} aria-label={L(s.en, s.ru)} title={L(s.en, s.ru)} className={look.shape === s.value ? 'on' : ''} onClick={() => ed({ shape: s.value })}>
                <svg viewBox="0 0 16 16" aria-hidden>
                  <ShapeGlyph shape={s.value} colour="currentColor" />
                </svg>
              </button>
            ))}
          </span>
        </Row>
      ) : (
        <>
          <Row label={L('Image', 'Картинка')}>
            <select className="cw-input cw-select" aria-label={L('Image', 'Картинка')} value={look.texture} onChange={(ev) => ed({ texture: ev.target.value })}>
              <option value="">{L('None (import images in Assets)', 'Нет (импортируйте в «Ресурсах»)')}</option>
              {textures.map((x) => (
                <option key={x.path} value={x.path}>
                  {x.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={L('Flipbook', 'Покадрово')}>
            <Switch label={L('Flipbook', 'Покадрово')} checked={!!look.flipbook} onChange={(v) => ed({ flipbook: v ? { cols: 4, rows: 4, fps: 0 } : undefined })} />
          </Row>
          {look.flipbook && (
            <>
              <Num label={L('Columns', 'Столбцы')} min={1} max={32} value={look.flipbook.cols} onChange={(v) => ed({ flipbook: { ...look.flipbook!, cols: Math.round(v) } })} />
              <Num label={L('Rows', 'Строки')} min={1} max={32} value={look.flipbook.rows} onChange={(v) => ed({ flipbook: { ...look.flipbook!, rows: Math.round(v) } })} />
              <Num label={L('Frames/s', 'Кадров/с')} min={0} max={120} value={look.flipbook.fps} onChange={(v) => ed({ flipbook: { ...look.flipbook!, fps: Math.round(v) } })} />
              <div className="cw-muted cw-hint">{L('Frames are read left to right, top to bottom. 0 frames/s: one pass over each particle’s life.', 'Кадры читаются слева направо, сверху вниз. 0 кадров/с — один проход за жизнь частицы.')}</div>
            </>
          )}
        </>
      )}
      <Row label={L('Blend', 'Смешивание')}>
        <Segmented<VfxLook['blend']> label={L('Blend', 'Смешивание')} value={look.blend} onChange={(v) => ed({ blend: v })} options={[{ value: 'normal', label: L('Normal', 'Обычное') }, { value: 'add', label: L('Add', 'Сложение') }]} />
      </Row>
      <Row label={L('Facing', 'Повёрнут')}>
        <Segmented<VfxLook['facing']> label={L('Facing', 'Повёрнут')} value={look.facing} onChange={(v) => ed({ facing: v })} options={[{ value: 'camera', label: L('Camera', 'К камере') }, { value: 'flat', label: L('Flat', 'Плашмя') }]} />
      </Row>
      {align !== null && (
        <Row label={L('Point along motion', 'По движению')}>
          <Switch label={L('Point along motion', 'По движению')} checked={align} onChange={(v) => editLayer((l) => void ((l as VfxEmitter).alignToMotion = v))} />
        </Row>
      )}
    </>
  );
}

// ── Icons ──

function ShapeGlyph({ shape, colour, x = 8, y = 8, r = 6, w = 2 }: { shape: VfxShapeKind; colour: string; x?: number; y?: number; r?: number; w?: number }) {
  const solid = { fill: colour };
  switch (shape) {
    case 'square':
      return <rect x={x - r * 0.8} y={y - r * 0.8} width={r * 1.6} height={r * 1.6} {...solid} />;
    case 'diamond':
      return <path d={`M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`} {...solid} />;
    case 'triangle':
      return <path d={`M${x} ${y - r}L${x + r} ${y + r * 0.75}L${x - r} ${y + r * 0.75}Z`} {...solid} />;
    case 'star': {
      const d = Array.from({ length: 10 }, (_, i) => {
        const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
        return `${i ? 'L' : 'M'}${(x + Math.cos(a) * rr).toFixed(2)} ${(y + Math.sin(a) * rr).toFixed(2)}`;
      }).join('');
      return <path d={`${d}Z`} {...solid} />;
    }
    case 'ring':
      return <circle cx={x} cy={y} r={r * 0.8} fill="none" stroke={colour} strokeWidth={w} />;
    case 'line':
      return <path d={`M${x - r} ${y}L${x + r} ${y}`} stroke={colour} strokeWidth={w} strokeLinecap="round" />;
    default:
      return <circle cx={x} cy={y} r={r * 0.9} {...solid} />;
  }
}

/** A small drawing of an effect: each layer's shape in its colour. */
function EffectIcon({ effect }: { effect: Omit<VfxEffect, 'id' | 'name'> }) {
  const n = effect.layers.length;
  return (
    <svg viewBox="0 0 60 30" aria-hidden>
      {effect.layers.map((l, i) => {
        const colour = l.kind === 'emitter' ? rgbHex(sampleGradient(l.colourOverLife, 0)) : (l.keys[0]?.colour ?? '#ececec');
        const x = n === 1 ? 30 : 18 + (i * 24) / Math.max(1, n - 1);
        if (l.kind === 'emitter')
          return (
            <g key={l.id}>
              {[-7, 0, 7].map((dx, j) => (
                <ShapeGlyph key={j} shape={l.look.shape} colour={colour} x={x + dx} y={15 + (j === 1 ? -5 : 3)} r={j === 1 ? 5 : 3.5} w={1.6} />
              ))}
            </g>
          );
        return <ShapeGlyph key={l.id} shape={l.look.shape} colour={colour} x={x} y={15} r={9} w={1.6} />;
      })}
    </svg>
  );
}

const rgbHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;

// ── Timeline ──

function useTransport(tr: Transport) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    tr.listeners.add(tick);
    return () => void tr.listeners.delete(tick);
  }, [tr]);
}

function Timeline({ fx, tr, layerId, onPickLayer, onPickKey, onMoveLayer }: { fx: VfxEffect; tr: Transport; layerId: string | null; onPickLayer: (id: string) => void; onPickKey: (layer: string, i: number) => void; onMoveLayer: (id: string, start: number) => void }) {
  useTransport(tr);
  const len = Math.max(0.05, fx.duration, ...fx.layers.map((l) => l.start + l.duration));
  const pct = (t: number) => `${(clamp(t, 0, len) / len) * 100}%`;
  const scrub = (ev: React.PointerEvent<HTMLElement>, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    tr.seek = clamp(((ev.clientX - r.left) / r.width) * len, 0, len);
    tr.time = tr.seek;
    tr.playing = false;
    for (const fn of tr.listeners) fn();
  };
  const ticks = Array.from({ length: Math.floor(len / tickStep(len)) + 1 }, (_, i) => i * tickStep(len));
  const drag = useRef<{ id: string; x: number; start: number; w: number } | null>(null);
  return (
    <div className="cw-vfx-tl" aria-label={L('Timeline', 'Шкала времени')}>
      <div className="cw-vfx-tl-h">
        <Button
          size="sm"
          aria-label={tr.playing ? L('Pause', 'Пауза') : L('Play', 'Играть')}
          onClick={() => {
            tr.playing = !tr.playing;
            if (tr.playing && !fx.loop && !tr.loop && tr.time >= fx.duration) tr.restart = true;
            for (const fn of tr.listeners) fn();
          }}
        >
          {tr.playing ? '❚❚' : '▶'}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            tr.restart = true;
            tr.playing = true;
          }}
        >
          ⟲ {L('Restart', 'Сначала')}
        </Button>
        <span className="mono cw-muted">
          {Math.min(tr.time, len).toFixed(2)} s / {fx.duration.toFixed(2)} s
        </span>
        <span className="cw-sp" />
        <span className="mono cw-muted">
          {L('Particles', 'Частиц')} {tr.count}
        </span>
      </div>
      <div className="cw-vfx-tracks">
        <div className="cw-vfx-track cw-vfx-ruler">
          <span className="cw-muted">{L('Time', 'Время')}</span>
          <div className="cw-vfx-lane" onPointerDown={(ev) => (ev.currentTarget.setPointerCapture(ev.pointerId), scrub(ev, ev.currentTarget))} onPointerMove={(ev) => ev.buttons && scrub(ev, ev.currentTarget)}>
            {ticks.map((t) => (
              <span key={t} className="cw-vfx-tick mono" style={{ left: pct(t) }}>
                {t.toFixed(t < 1 && tickStep(len) < 0.5 ? 1 : tickStep(len) < 1 ? 1 : 0)}
              </span>
            ))}
            <span className="cw-vfx-end" style={{ left: pct(fx.duration) }} />
            <span className="cw-vfx-head" style={{ left: pct(tr.time) }} />
          </div>
        </div>
        {fx.layers.map((l) => (
          <div key={l.id} className={`cw-vfx-track${l.id === layerId ? ' on' : ''}${l.visible ? '' : ' off'}`}>
            <button type="button" className="cw-vfx-track-name" onClick={() => onPickLayer(l.id)}>
              {l.name} · {l.kind === 'emitter' ? L('Emitter', 'Эмиттер') : L('Shape', 'Фигура')}
            </button>
            <div className="cw-vfx-lane" onPointerDown={(ev) => ev.target === ev.currentTarget && scrub(ev, ev.currentTarget)}>
              <span
                className={`cw-vfx-bar ${l.kind}`}
                style={{ left: pct(l.start), width: `calc(${pct(l.start + Math.max(l.duration, 0.01))} - ${pct(l.start)})` }}
                title={L('Drag to move when it starts', 'Тяните, чтобы сдвинуть начало')}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  onPickLayer(l.id);
                  drag.current = { id: l.id, x: ev.clientX, start: l.start, w: ev.currentTarget.parentElement!.getBoundingClientRect().width };
                  ev.currentTarget.setPointerCapture(ev.pointerId);
                }}
                onPointerMove={(ev) => {
                  const d = drag.current;
                  if (!d || !ev.buttons) return;
                  onMoveLayer(d.id, clamp(round(d.start + ((ev.clientX - d.x) / d.w) * len, 0.05), 0, 60));
                }}
                onPointerUp={() => (drag.current = null)}
              />
              {l.kind === 'shape' &&
                l.keys.map((k, i) => (
                  <button key={i} type="button" className="cw-vfx-key" aria-label={L(`Key at ${k.t.toFixed(2)} s`, `Ключ на ${k.t.toFixed(2)} с`)} style={{ left: pct(l.start + k.t) }} onClick={() => onPickKey(l.id, i)} />
                ))}
              <span className="cw-vfx-head" style={{ left: pct(tr.time) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const tickStep = (len: number) => (len <= 1.5 ? 0.2 : len <= 4 ? 0.5 : len <= 10 ? 1 : 5);

// ── Preview ──

/** The effect playing over a small test ground (or in a dark room). Drag to look round, wheel to zoom. */
function VfxPreview({ effect, tr, dark, bounds }: { effect: VfxEffect; tr: Transport; dark: boolean; bounds: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ fx: VfxRenderer; handle: VfxHandle; scene: THREE.Scene; floor: THREE.Mesh; grid: THREE.GridHelper; marker: THREE.Group; person: THREE.Mesh } | null>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const el = host.current!;
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(window.devicePixelRatio);
    el.appendChild(r.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 2.2));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1200, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#2a2a2a' }));
    floor.position.y = -0.5;
    const grid = new THREE.GridHelper(1200, 24, '#3a3a3a', '#333333');
    grid.position.y = -0.4;
    // The player's size (72 u) for scale, off to the side.
    const person = new THREE.Mesh(new THREE.CapsuleGeometry(12, 48, 4, 10).translate(0, 36, 0), new THREE.MeshLambertMaterial({ color: '#5a5a5a' }));
    person.position.set(-110, 0, -40);
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(4, 5.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4b9cff', depthTest: false, transparent: true }));
    const up = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 40, 0)]), new THREE.LineDashedMaterial({ color: '#4b9cff', dashSize: 4, gapSize: 3, depthTest: false, transparent: true }));
    up.computeLineDistances();
    marker.add(ring, up);
    marker.renderOrder = 30;
    const fx = new VfxRenderer();
    scene.add(floor, grid, person, marker, fx.group);
    const handle = fx.play(effect, { matrix: new THREE.Matrix4(), keep: true, seed: 1, repeat: tr.loop });
    shown.current = effect.id;
    const cam = new THREE.PerspectiveCamera(50, 1, 1, 20000);
    cam.position.set(0, 110, 280);
    const ctl = new OrbitControls(cam, r.domElement);
    ctl.target.set(0, 40, 0);
    ctl.enableDamping = true;
    ctl.maxDistance = 3000;
    view.current = { fx, handle, scene, floor, grid, marker, person };
    let raf = 0, last = performance.now(), told = 0;
    const loop = () => {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const w = el.clientWidth, h = el.clientHeight;
      if (r.domElement.width !== Math.floor(w * r.getPixelRatio()) || r.domElement.height !== Math.floor(h * r.getPixelRatio())) {
        r.setSize(w, h);
        cam.aspect = w / Math.max(1, h);
        cam.updateProjectionMatrix();
      }
      const p = handle.player;
      p.repeat = tr.loop;
      if (tr.restart) {
        tr.restart = false;
        p.reset();
        p.step(0);
      } else if (tr.seek !== null) {
        p.seek(tr.seek);
        tr.seek = null;
      } else if (tr.playing) {
        p.step(dt);
        if (!p.loops && p.done) tr.playing = false;
      }
      handle.sync();
      tr.time = p.time;
      tr.count = p.count;
      if (now - told > 50) {
        told = now;
        for (const fn of tr.listeners) fn();
      }
      ctl.update();
      r.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ctl.dispose();
      fx.clear();
      r.dispose();
      el.removeChild(r.domElement);
      view.current = null;
    };
  }, []);
  // An edit: the same effect changed (shown at the same moment), or another effect picked (from the start).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.handle.setEffect(effect);
    if (shown.current !== effect.id) {
      shown.current = effect.id;
      tr.restart = true;
      tr.playing = true;
    } else if (!tr.playing) tr.seek = tr.time;
  }, [effect]);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.scene.background = new THREE.Color(dark ? '#0b0b0d' : '#1f1f1f');
    (v.floor.material as THREE.MeshLambertMaterial).color.set(dark ? '#111113' : '#2a2a2a');
    v.grid.visible = !dark;
    v.person.visible = !dark;
  }, [dark]);
  useEffect(() => {
    if (view.current) view.current.marker.visible = bounds;
  }, [bounds]);
  return <div className="cw-plants-preview" ref={host} data-testid="vfx-preview" />;
}
