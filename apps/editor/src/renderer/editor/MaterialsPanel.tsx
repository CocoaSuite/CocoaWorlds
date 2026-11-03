/**
 * The Materials workspace: the project's materials on the left, a lit preview of the picked one in the middle
 * (sphere, cube or wall, turned with the mouse), and its settings on the right. Materials belong to the
 * project, so every scene can use them; changes show at once on every face that uses one, and are undoable.
 */
import { newMaterial, newWear, type MaterialDef, type WearDef } from '@cocoaworlds/core';
import { Button, ColorField, NumberField, Segmented, Switch } from '@cocoaworlds/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { brushOf } from '../brush/brushes';
import { t } from '../i18n';
import { useEditor } from '../store';
import { projectMaterial, releaseMaterial, tickMaterials } from '../viewport/project-materials';
import type { FaceRef } from '../viewport/world-render';
import { MaterialSwatch } from './MaterialSwatch';
import { GraphWorkspace } from './MaterialGraph';
import { bakeLater, createGraphMaterial, useGraphs } from '../materials/graphs';

export type Shape = 'sphere' | 'cube' | 'wall';

/** A unique name: base, base 2, … */
function unique(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

// Dragging a slider or a colour is one undo step: changes with the same key join until it rests a moment.
let gesture: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
function endGesture(): void {
  if (!gesture) return;
  clearTimeout(gesture.timer);
  gesture = null;
  useEditor.getState().commit();
}

function setAll(list: MaterialDef[], label: string, key?: string): void {
  const st = useEditor.getState();
  if (key) {
    if (gesture?.key !== key) {
      endGesture();
      st.begin(label);
    } else clearTimeout(gesture.timer);
    gesture = { key, timer: setTimeout(endGesture, 700) };
  } else endGesture();
  st.setMaterials(list, label, key);
}

/** Faces in the open scene that use material `id`. */
function facesUsing(id: string): FaceRef[] {
  const doc = useEditor.getState().doc;
  const out: FaceRef[] = [];
  for (const e of doc?.entities ?? []) {
    const b = brushOf(e);
    b?.brush.faces.forEach((f, face) => f.surface.material === id && out.push({ id: e.id, face }));
  }
  return out;
}

export function MaterialsPanel() {
  useEditor((s) => s.rev);
  const list = useEditor((s) => s.session?.project.settings.materials) ?? [];
  const textures = useEditor((s) => s.assets.textures);
  const picked = useEditor((s) => s.faceSelection.length);
  const selected = useEditor((s) => s.materialPick);
  const setSelected = (id: string | null) => useEditor.getState().pickMaterial(id);
  const [shape, setShape] = useState<Shape>('sphere');
  const fileRef = useRef<HTMLInputElement>(null);
  const mat = list.find((m) => m.id === selected) ?? list[0] ?? null;
  const used = mat ? facesUsing(mat.id) : [];

  useEffect(() => endGesture, []);

  const edit = (patch: Partial<MaterialDef>, label: string, key?: string) => {
    if (!mat) return;
    const cur = useEditor.getState().session?.project.settings.materials ?? [];
    setAll(
      cur.map((m) => {
        if (m.id !== mat.id) return m;
        const next = { ...m, ...patch };
        // (Settings switched back off are left out of the file.)
        for (const k of Object.keys(next) as (keyof MaterialDef)[]) if (next[k] === undefined) delete next[k];
        return next;
      }),
      label,
      key,
    );
  };
  const add = (m: MaterialDef, label: string) => {
    const cur = useEditor.getState().session?.project.settings.materials ?? [];
    setAll([...cur, m], label);
    setSelected(m.id);
  };
  const fromImages = async (files: File[]) => {
    const st = useEditor.getState();
    const paths = await st.importAssets('textures', files);
    const cur = useEditor.getState().session?.project.settings.materials ?? [];
    const names = cur.map((m) => m.name);
    const made = paths.map((p) => {
      const base = p.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      const name = unique(base.charAt(0).toUpperCase() + base.slice(1), names);
      names.push(name);
      return newMaterial(name, { color: '#ffffff', map: p });
    });
    if (!made.length) return;
    setAll([...cur, ...made], made.length === 1 ? `Add material ${made[0]!.name}` : 'Add materials');
    setSelected(made[made.length - 1]!.id);
  };

  const goToScene = () => useEditor.getState().setWorkspace('scene');

  // The list can fold away (remembered), giving the graph and its library the room.
  const [listShut, setListShut] = useState(() => {
    try {
      return localStorage.getItem('cw-mats-list') === 'shut';
    } catch {
      return false;
    }
  });
  const shutList = (shut: boolean) => {
    setListShut(shut);
    try {
      localStorage.setItem('cw-mats-list', shut ? 'shut' : 'open');
    } catch {
      /* ignore */
    }
  };

  const removeMat = () => {
    if (!mat) return;
    setAll(
      list.filter((m) => m.id !== mat.id),
      `Remove material ${mat.name}`,
    );
    setSelected(null);
  };
  /** A graph material's copy gets a copy of the graph (so changing one leaves the other alone). */
  const duplicateGraphMaterial = async (src: MaterialDef) => {
    const name = unique(src.name, list.map((m) => m.name));
    const made = await createGraphMaterial(name);
    if (!made) return;
    const g = useGraphs.getState().graphs[src.graph!];
    if (g) {
      useGraphs.setState((s) => ({ graphs: { ...s.graphs, [made.graph!]: g } }));
      await window.cocoa.projects.writeGraph(useEditor.getState().session!.dir, made.graph!, g);
    }
    const { id, graph } = made;
    add({ ...src, id, name, graph, map: undefined, normalMap: undefined, roughnessMap: undefined, metalnessMap: undefined, occlusionMap: undefined, glowMap: undefined, heightMap: undefined, opacityMap: undefined }, `Duplicate material ${src.name}`);
  };
  const useRow = mat ? (
    <div className="cw-mats-use">
            <span className="cw-muted" data-testid="material-uses">
              {used.length ? t('mat.usedBy').replace('{n}', String(used.length)) : t('mat.unused')}
            </span>
            <Button
              size="sm"
              disabled={!picked}
              title={picked ? undefined : t('mat.noFacesHint')}
              onClick={() => {
                useEditor.getState().setFaces({ material: mat.id }, undefined, `Set material ${mat.name}`);
              }}
            >
              {t('mat.useOnFaces').replace('{n}', String(picked))}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const st = useEditor.getState();
                st.setPaintMaterial(mat.id);
                st.setTool('paint');
                goToScene();
              }}
            >
              {t('mat.paint')}
            </Button>
            <Button
              size="sm"
              disabled={!used.length}
              onClick={() => {
                const st = useEditor.getState();
                st.setTool('face');
                useEditor.setState({ faceSelection: used });
                goToScene();
              }}
            >
              {t('mat.findFaces')}
            </Button>
          </div>
  ) : null;

  return (
    <div className={`cw-screens cw-mats${listShut ? ' list-shut' : ''}`} role="region" aria-label={t('ws.materials')}>
      {listShut ? (
        // Folded away: a narrow strip of swatches, to switch materials without opening it.
        <aside className="cw-mats-rail" aria-label={t('mat.list')}>
          <button type="button" className="cw-iconbtn" aria-label={t('mat.showList')} title={t('mat.showList')} onClick={() => shutList(false)}>
            ›
          </button>
          <ul className="cw-mats-rail-list" role="listbox" aria-label={t('mat.list')}>
            {list.map((m) => (
              <li key={m.id} role="option" aria-selected={m.id === mat?.id} aria-label={m.name} title={m.name} className={m.id === mat?.id ? 'on' : ''} onClick={() => setSelected(m.id)}>
                <MaterialSwatch def={m} className="cw-mats-sw" />
              </li>
            ))}
          </ul>
        </aside>
      ) : (
      <aside className="cw-screens-side" aria-label={t('mat.list')}>
        <div className="cw-screens-h">
          <span>{t('mat.list')}</span>
          <span className="cw-mats-h-tools">
            <Button size="sm" onClick={() => add(newMaterial(unique(t('mat.newName'), list.map((m) => m.name))), 'Add material')}>
              {t('mat.add')}
            </Button>
            <button type="button" className="cw-iconbtn" aria-label={t('mat.hideList')} title={t('mat.hideList')} onClick={() => shutList(true)}>
              ‹
            </button>
          </span>
        </div>
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          {t('mat.fromImage')}
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            const m = await createGraphMaterial(unique(t('cm.newName'), list.map((x) => x.name)));
            if (m) add(m, `Add graph material ${m.name}`);
          }}
        >
          {t('cm.add')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept=".png,.jpg,.jpeg,.webp"
          data-testid="material-images"
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = '';
            if (files.length) void fromImages(files);
          }}
        />
        {!list.length && <p className="cw-muted cw-screens-hint">{t('mat.none')}</p>}
        <ul className="cw-mats-list" role="listbox" aria-label={t('mat.list')}>
          {list.map((m) => (
            <li key={m.id} role="option" aria-selected={m.id === mat?.id} aria-label={m.name} className={m.id === mat?.id ? 'on' : ''} onClick={() => setSelected(m.id)}>
              <MaterialSwatch def={m} className="cw-mats-sw" />
              <span>{m.name}</span>
            </li>
          ))}
        </ul>
        <p className="cw-muted cw-screens-hint">{t('mat.hint')}</p>
      </aside>
      )}

      {mat?.graph ? (
        <GraphWorkspace
          m={mat}
          edit={edit}
          used={used.length}
          onDuplicate={() => void duplicateGraphMaterial(mat)}
          onVariant={() => {
            const name = unique(`${mat.name} ${t('cm.variantName')}`, list.map((m) => m.name));
            const { id } = newMaterial(name);
            add({ ...mat, id, name, map: undefined, normalMap: undefined, roughnessMap: undefined, metalnessMap: undefined, occlusionMap: undefined, glowMap: undefined, heightMap: undefined, opacityMap: undefined }, `Make variant ${name}`);
            bakeLater(mat.graph!);
          }}
          onRemove={removeMat}
          tools={useRow}
          wideLibrary={listShut}
        />
      ) : (
        <>
      <div className="cw-screens-main">
        <div className="cw-screens-tools">
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
          <span className="cw-muted cw-screens-tip">{mat ? t('mat.viewHint') : ''}</span>
        </div>
        <div className="cw-mats-stage">{mat ? <MaterialPreview id={mat.id} shape={shape} /> : <div className="cw-muted cw-screens-empty">{t('mat.pick')}</div>}</div>
        {mat && useRow}
      </div>

      <aside className="cw-screens-side right" aria-label={t('mat.settings')}>
        {mat ? (
          <MaterialProps
            m={mat}
            textures={textures.map((x) => ({ path: x.path, name: x.name }))}
            edit={edit}
            onDuplicate={() => add({ ...mat, id: newMaterial(mat.name).id, name: unique(mat.name, list.map((m) => m.name)) }, `Duplicate material ${mat.name}`)}
            onRemove={removeMat}
            used={used.length}
          />
        ) : (
          <p className="cw-muted cw-screens-hint">{t('mat.pick')}</p>
        )}
      </aside>
        </>
      )}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cw-screens-row">
      <span className="cw-screens-l">{label}</span>
      <span className="cw-screens-v">{children}</span>
    </div>
  );
}

/** A min–max slider with its value beside it. */
export function Slider({ label, value, min = 0, max = 1, step = 0.01, digits, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; digits?: number; onChange: (v: number) => void }) {
  const d = digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);
  return (
    <span className="cw-mats-slider">
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} />
      <span className="mono">{value.toFixed(d)}</span>
    </span>
  );
}

export function ImagePick({ label, value, textures, onChange }: { label: string; value: string | undefined; textures: { path: string; name: string }[]; onChange: (v: string | undefined) => void }) {
  return (
    <select className="cw-input" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || undefined)}>
      <option value="">{t('mat.noImage')}</option>
      {textures.map((x) => (
        <option key={x.path} value={x.path}>
          {x.name}
        </option>
      ))}
      {value && !textures.some((x) => x.path === value) && <option value={value}>{value.split('/').pop()} ({t('mat.missing')})</option>}
    </select>
  );
}

function MaterialProps({
  m,
  textures,
  edit,
  onDuplicate,
  onRemove,
  used,
}: {
  m: MaterialDef;
  textures: { path: string; name: string }[];
  edit: (patch: Partial<MaterialDef>, label: string, key?: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  used: number;
}) {
  const [name, setName] = useState(m.name);
  useEffect(() => setName(m.name), [m.id, m.name]);
  const glows = !!m.emissive;
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
      <Row label={t('mat.folder')}>
        <input
          className="cw-input"
          aria-label={t('mat.folder')}
          key={`folder-${m.id}`}
          defaultValue={m.folder ?? ''}
          placeholder={t('mat.folderHint')}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v !== (m.folder ?? '')) edit({ folder: v || undefined }, 'Material folder');
          }}
        />
      </Row>
      <Row label={t('mat.color')}>
        <ColorField label={t('mat.color')} value={m.color} onChange={(v) => edit({ color: v }, 'Material colour', `mat-color-${m.id}`)} />
      </Row>
      <Row label={t('mat.image')}>
        <ImagePick label={t('mat.image')} value={m.map} textures={textures} onChange={(v) => edit({ map: v, color: v && !m.map && m.color === '#b4b4b4' ? '#ffffff' : m.color }, 'Material image')} />
      </Row>
      {m.map && (
        <Row label={t('mat.scale')}>
          <NumberField label="×" ariaLabel={t('mat.scale')} value={m.scale ?? 1} step={0.25} onCommit={(v) => edit({ scale: v > 0 && v !== 1 ? v : undefined }, 'Material image scale')} />
        </Row>
      )}
      {m.map && (
        <label className="cw-screens-sw" title={t('mat.cutoutHint')}>
          <Switch label={t('mat.cutout')} checked={m.cutout !== false} onChange={(v) => edit({ cutout: v ? undefined : false }, v ? 'Cut-out on' : 'Cut-out off')} />
          {t('mat.cutout')}
        </label>
      )}
      <Row label={t('mat.mapping')}>
        <select className="cw-input" aria-label={t('mat.mapping')} value={m.mapping ?? 'face'} onChange={(e) => edit({ mapping: e.currentTarget.value === 'face' ? undefined : (e.currentTarget.value as 'world' | 'object') }, 'Material mapping')}>
          <option value="face">{t('mat.mapFace')}</option>
          <option value="world">{t('mat.mapWorld')}</option>
          <option value="object">{t('mat.mapObject')}</option>
        </select>
      </Row>
      {m.mapping && m.mapping !== 'face' && (
        <Row label={t('cm.tile')}>
          <NumberField label="u" ariaLabel={t('cm.tile')} value={m.tile ?? 128} step={16} onCommit={(v) => v > 0 && edit({ tile: v }, 'Material size in the world')} />
        </Row>
      )}
      <p className="cw-muted cw-screens-note">{t('mat.mappingHint')}</p>
      <Row label={t('mat.normal')}>
        <ImagePick label={t('mat.normal')} value={m.normalMap} textures={textures} onChange={(v) => edit({ normalMap: v, normalStrength: v ? m.normalStrength : undefined }, 'Material surface map')} />
      </Row>
      {m.normalMap && (
        <Row label={t('mat.bumps')}>
          <Slider label={t('mat.bumps')} value={m.normalStrength ?? 1} max={2} onChange={(v) => edit({ normalStrength: v === 1 ? undefined : v }, 'Bump strength', `mat-bumps-${m.id}`)} />
        </Row>
      )}
      <Row label={t('mat.roughness')}>
        <Slider label={t('mat.roughness')} value={m.roughness} onChange={(v) => edit({ roughness: v }, 'Material roughness', `mat-rough-${m.id}`)} />
      </Row>
      <Row label={t('mat.metalness')}>
        <Slider label={t('mat.metalness')} value={m.metalness} onChange={(v) => edit({ metalness: v }, 'Material metalness', `mat-metal-${m.id}`)} />
      </Row>
      <Row label={t('mat.opacity')}>
        <Slider label={t('mat.opacity')} value={m.opacity ?? 1} onChange={(v) => edit({ opacity: v >= 1 ? undefined : v }, 'Material opacity', `mat-opacity-${m.id}`)} />
      </Row>
      <label className="cw-screens-sw">
        <Switch label={t('mat.glows')} checked={glows} onChange={(v) => edit({ emissive: v ? m.color : undefined, emissiveStrength: v ? 1 : undefined }, v ? 'Material glows' : 'Material stops glowing')} />
        {t('mat.glows')}
      </label>
      {glows && (
        <>
          <Row label={t('mat.glowMap')}>
            <ImagePick label={t('mat.glowMap')} value={m.glowMap} textures={textures} onChange={(v) => edit({ glowMap: v }, 'Glow image')} />
          </Row>
          <Row label={t('mat.glowColor')}>
            <ColorField label={t('mat.glowColor')} value={m.emissive!} onChange={(v) => edit({ emissive: v }, 'Glow colour', `mat-glow-${m.id}`)} />
          </Row>
          <Row label={t('mat.glowStrength')}>
            <Slider label={t('mat.glowStrength')} value={m.emissiveStrength ?? 1} max={10} step={0.1} onChange={(v) => edit({ emissiveStrength: v }, 'Glow strength', `mat-glow-i-${m.id}`)} />
          </Row>
        </>
      )}
      <Row label={t('mat.refraction')}>
        <Slider label={t('mat.refraction')} value={m.refraction ?? 0} onChange={(v) => edit({ refraction: v > 0 ? v : undefined }, 'Glass', `mat-glass-${m.id}`)} />
      </Row>
      {(m.refraction ?? 0) > 0 && (
        <>
          <Row label={t('mat.ior')}>
            <NumberField label="#" ariaLabel={t('mat.ior')} value={m.ior ?? 1.5} step={0.05} onCommit={(v) => edit({ ior: Math.max(1, Math.min(2.4, v)) }, 'Glass bending')} />
          </Row>
          <Row label={t('mat.thickness')}>
            <NumberField label="u" ariaLabel={t('mat.thickness')} value={m.thickness ?? 8} step={1} onCommit={(v) => edit({ thickness: Math.max(0, v) }, 'Glass thickness')} />
          </Row>
          <p className="cw-muted cw-screens-note">{t('mat.glassHint')}</p>
        </>
      )}
      <Row label={t('mat.bevel')}>
        <Slider label={t('mat.bevel')} value={m.bevel ?? 0} min={0} max={32} step={1} digits={0} onChange={(v) => edit({ bevel: v > 0 ? v : undefined }, 'Bevel edges', `mat-bevel-${m.id}`)} />
      </Row>
      <Row label={t('mat.blend')}>
        <Slider label={t('mat.blend')} value={m.blend ?? 0} min={0} max={64} step={1} digits={0} onChange={(v) => edit({ blend: v > 0 ? v : undefined }, 'Blend into ground', `mat-blend-${m.id}`)} />
      </Row>
      {(m.blend ?? 0) > 0 && (
        <>
          <Row label={t('mat.blendNoise')}>
            <Slider label={t('mat.blendNoise')} value={m.blendNoise ?? 0.5} min={0} max={1} step={0.05} onChange={(v) => edit({ blendNoise: v }, 'Blend edge', `mat-blendn-${m.id}`)} />
          </Row>
          <Row label={t('mat.blendSize')}>
            <Slider label={t('mat.blendSize')} value={m.blendSize ?? 24} min={2} max={128} step={1} digits={0} onChange={(v) => edit({ blendSize: v }, 'Blend edge', `mat-blends-${m.id}`)} />
          </Row>
        </>
      )}
      <WearSettings m={m} edit={edit} />
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
      <p className="cw-muted cw-screens-note">{t('mat.scrollHint')}</p>
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

/** Texture repeats on the preview shapes, so a material looks the size it will in the level (128-unit shapes). */
export function previewGeometry(shape: Shape): THREE.BufferGeometry {
  const g = shape === 'sphere' ? new THREE.SphereGeometry(72, 64, 32) : shape === 'cube' ? new THREE.BoxGeometry(128, 128, 128) : new THREE.PlaneGeometry(192, 128);
  // Face coordinates: one dev tile (256 texels) is 64 units.
  const [su, sv] = shape === 'sphere' ? [(2 * Math.PI * 72) / 64, (Math.PI * 72) / 64] : shape === 'cube' ? [2, 2] : [3, 2];
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, (1 - uv.getY(i)) * sv);
  uv.needsUpdate = true;
  return g;
}

export function MaterialPreview({ id, shape }: { id: string; shape: Shape }) {
  const host = useRef<HTMLDivElement>(null);
  const turn = useRef({ yaw: 0.6, pitch: 0.25, drag: null as null | { x: number; y: number; light: boolean }, idle: 0 });
  /** Closer or further (1 = the whole shape in view), and where the main light comes from. */
  const view = useRef({ zoom: 1, az: -0.6, el: 0.6, dirty: () => {} });
  const [lightMode, setLightMode] = useState(false);
  const lightRef = useRef(false);
  lightRef.current = lightMode;
  const geometry = useMemo(() => previewGeometry(shape), [shape]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.domElement.setAttribute('aria-label', t('mat.preview'));
    r.domElement.setAttribute('data-testid', 'material-preview');
    el.appendChild(r.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x3a3834, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd2ff, 0.6);
    rim.position.set(260, 60, -300);
    scene.add(rim);
    const cam = new THREE.PerspectiveCamera(30, 1, 10, 4000);
    const base = shape === 'cube' ? 560 : shape === 'wall' ? 500 : 420;
    let dirty = true;
    view.current.dirty = () => (dirty = true);
    const material = projectMaterial(id, () => (dirty = true));
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const size = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      dirty = true;
    };
    const obs = new ResizeObserver(size);
    obs.observe(el);
    size();
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tr = turn.current;
      // Turns slowly on its own until dragged (or zoomed in); picks up again a few seconds after.
      if (!tr.drag && now > tr.idle && shape !== 'wall' && view.current.zoom >= 1) {
        tr.yaw += dt * 0.35;
        dirty = true;
      }
      if (tickMaterials(now)) dirty = true;
      if (!dirty) return;
      dirty = false;
      const v = view.current;
      cam.position.set(0, 0, base * v.zoom);
      key.position.set(Math.sin(v.az) * Math.cos(v.el) * 450, Math.sin(v.el) * 450, Math.cos(v.az) * Math.cos(v.el) * 450);
      mesh.rotation.set(tr.pitch, tr.yaw, 0, 'XYZ');
      r.render(scene, cam);
    };
    loop();
    const down = (e: PointerEvent) => {
      turn.current.drag = { x: e.clientX, y: e.clientY, light: lightRef.current || e.shiftKey || e.button === 2 };
      r.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const tr = turn.current;
      if (!tr.drag) return;
      const dx = e.clientX - tr.drag.x, dy = e.clientY - tr.drag.y;
      if (tr.drag.light) {
        const v = view.current;
        v.az += dx * 0.012;
        v.el = Math.max(-1.3, Math.min(1.45, v.el - dy * 0.012));
      } else {
        tr.yaw += dx * 0.01;
        tr.pitch = Math.max(-1.2, Math.min(1.2, tr.pitch + dy * 0.01));
      }
      tr.drag = { ...tr.drag, x: e.clientX, y: e.clientY };
      dirty = true;
    };
    const up = () => {
      turn.current.drag = null;
      turn.current.idle = performance.now() + 4000;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      v.zoom = Math.max(0.3, Math.min(2.5, v.zoom * Math.exp(e.deltaY * 0.0012)));
      turn.current.idle = performance.now() + 4000;
      dirty = true;
    };
    const reset = () => {
      Object.assign(view.current, { zoom: 1, az: -0.6, el: 0.6 });
      Object.assign(turn.current, { yaw: 0.6, pitch: 0.25 });
      dirty = true;
    };
    const noMenu = (e: Event) => e.preventDefault();
    r.domElement.addEventListener('pointerdown', down);
    r.domElement.addEventListener('pointermove', move);
    r.domElement.addEventListener('pointerup', up);
    r.domElement.addEventListener('pointercancel', up);
    r.domElement.addEventListener('wheel', wheel, { passive: false });
    r.domElement.addEventListener('dblclick', reset);
    r.domElement.addEventListener('contextmenu', noMenu);
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      releaseMaterial(material);
      material.dispose();
      r.dispose();
      r.domElement.remove();
    };
  }, [id, geometry, shape]);

  const zoomBy = (k: number) => {
    const v = view.current;
    v.zoom = Math.max(0.3, Math.min(2.5, v.zoom * k));
    turn.current.idle = performance.now() + 4000;
    v.dirty();
  };
  return (
    <div className={`cw-mats-preview-wrap${lightMode ? ' light' : ''}`}>
      <div className="cw-mats-preview" ref={host} />
      <div className="cw-mats-preview-tools">
        <button type="button" className="cw-iconbtn" aria-label={t('mat.zoomIn')} title={t('mat.zoomIn')} onClick={() => zoomBy(0.8)}>
          +
        </button>
        <button type="button" className="cw-iconbtn" aria-label={t('mat.zoomOut')} title={t('mat.zoomOut')} onClick={() => zoomBy(1.25)}>
          −
        </button>
        <button type="button" className={`cw-iconbtn${lightMode ? ' on' : ''}`} aria-pressed={lightMode} aria-label={t('mat.turnLight')} title={t('mat.turnLightHint')} onClick={() => setLightMode((v) => !v)}>
          ☀
        </button>
      </div>
    </div>
  );
}

/** The wear layer (CM3): another look on edges, in creases and on top, broken up by noise. */
export function WearSettings({ m, edit }: { m: MaterialDef; edit: (patch: Partial<MaterialDef>, label: string, key?: string) => void }) {
  const w = m.wear;
  const set = (patch: Partial<WearDef>, label: string, key?: string) => w && edit({ wear: { ...w, ...patch } }, label, key ? `wear-${key}-${m.id}` : undefined);
  return (
    <div className="cm-own" role="group" aria-label={t('wear.title')}>
      <label className="cw-screens-sw" title={t('wear.hint')}>
        <Switch label={t('wear.title')} checked={!!w} onChange={(v) => edit({ wear: v ? newWear() : undefined }, v ? 'Wear on' : 'Wear off')} />
        {t('wear.title')}
      </label>
      {w && (
        <>
          <Row label={t('wear.edge')}>
            <Slider label={t('wear.edge')} value={w.edge} onChange={(v) => set({ edge: v }, 'Wear on edges', 'edge')} />
          </Row>
          <Row label={t('wear.crease')}>
            <Slider label={t('wear.crease')} value={w.crease} onChange={(v) => set({ crease: v }, 'Wear in creases', 'crease')} />
          </Row>
          <Row label={t('wear.up')}>
            <Slider label={t('wear.up')} value={w.up} onChange={(v) => set({ up: v }, 'Wear on top', 'up')} />
          </Row>
          <Row label={t('wear.width')}>
            <Slider label={t('wear.width')} value={w.width} min={0.5} max={32} step={0.5} onChange={(v) => set({ width: v }, 'Wear width', 'width')} />
          </Row>
          <Row label={t('wear.noise')}>
            <Slider label={t('wear.noise')} value={w.noise} onChange={(v) => set({ noise: v }, 'Wear noise', 'noise')} />
          </Row>
          <Row label={t('wear.color')}>
            <ColorField label={t('wear.color')} value={w.color} onChange={(v) => set({ color: v }, 'Wear colour', 'color')} />
          </Row>
          <Row label={t('wear.roughness')}>
            <Slider label={t('wear.roughness')} value={w.roughness} onChange={(v) => set({ roughness: v }, 'Wear roughness', 'rough')} />
          </Row>
          <Row label={t('wear.metalness')}>
            <Slider label={t('wear.metalness')} value={w.metalness} onChange={(v) => set({ metalness: v }, 'Wear metal', 'metal')} />
          </Row>
          <p className="cw-muted cw-screens-note">{t(m.graph ? 'wear.graphHint' : 'wear.hint')}</p>
        </>
      )}
    </div>
  );
}
