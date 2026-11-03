/**
 * The Plants workspace: make grass clumps, leafy plants, budding stalks and trees from presets, shape them with
 * sliders while a live preview turns beside a person for scale, and place them (or grow them as Foliage).
 */
import { PLANT_PRESETS, plantDefaults, type PlantDef } from '@cocoaworlds/core';
import { Button, ColorField, NumberField, Segmented } from '@cocoaworlds/ui';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getLang } from '../i18n';
import { useEditor } from '../store';
import { PLANT_TIME, aimRim, plantGeometry, plantImpostor, plantMaterial, setPlantWind } from '../viewport/plants';
import { UNITS_PER_METRE } from '../viewport/models';

const L = (en: string, ru: string) => (getLang() === 'ru' ? ru : en);
const newId = () => `plant_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
type Preset = { key: string; name: string; def: Omit<PlantDef, 'id' | 'name'> };

// Your own presets: kept on this computer, for every project.
const MINE = 'cw-plant-presets';
function loadMine(): Preset[] {
  try {
    return JSON.parse(localStorage.getItem(MINE) ?? '[]') as Preset[];
  } catch {
    return [];
  }
}
function saveMine(list: Preset[]): void {
  try {
    localStorage.setItem(MINE, JSON.stringify(list));
  } catch {
    /* (Not kept: storage is off.) */
  }
}

/** A small picture of a plant (made a moment after it stops changing). */
function Thumb({ def, seed }: { def: Omit<PlantDef, 'id' | 'name'>; seed?: number }) {
  const [url, setUrl] = useState('');
  const key = JSON.stringify([def, seed]);
  useEffect(() => {
    const t = setTimeout(() => {
      const img = plantImpostor({ ...def, id: 'thumb', name: '' } as PlantDef, seed ?? def.seed).map.image as HTMLCanvasElement;
      setUrl(img.toDataURL());
    }, 200);
    return () => clearTimeout(t);
  }, [key]);
  return <span className="cw-plants-thumb">{url && <img src={url} alt="" />}</span>;
}

export function PlantsPanel() {
  const list = useEditor((s) => s.session?.project.settings.plants) ?? [];
  const [sel, setSel] = useState<string | null>(list[0]?.id ?? null);
  const [mine, setMine] = useState<Preset[]>(loadMine);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<number[]>([]);
  const p = list.find((x) => x.id === sel) ?? null;
  const st = useEditor.getState();
  const edit = (patch: Partial<PlantDef>, key?: string) =>
    p && st.setPlants(list.map((x) => (x.id === p.id ? { ...x, ...patch } : x)), `Edit ${p.name}`, key ? `plant-${key}-${p.id}` : undefined);
  const add = (preset: Preset) => {
    const def: PlantDef = { ...preset.def, id: newId(), name: preset.name, preset: preset.key };
    st.setPlants([...list, def], `New ${preset.name}`);
    setSel(def.id);
  };
  const dflt = p ? plantDefaults(p, mine) : null;
  // A precise number (type it, or drag its label), kept within its range; ↺ puts back its preset's value.
  const num = (k: keyof PlantDef, label: string, min: number, max: number, step = 1, unit = 'u', fallback?: number) => {
    const set = (v: number) => edit({ [k]: Math.min(max, Math.max(min, v)) } as Partial<PlantDef>, k);
    const value = Number(p![k] ?? fallback ?? 0);
    const was = Number(dflt![k as keyof typeof dflt] ?? fallback ?? 0);
    return (
      <PRow label={label} changed={Math.abs(value - was) > 1e-9} onReset={() => edit({ [k]: dflt![k as keyof typeof dflt] } as Partial<PlantDef>)}>
        <NumberField label={unit} ariaLabel={label} step={step} value={value} onChange={set} onCommit={set} />
      </PRow>
    );
  };
  // A choice, with the same reset.
  const pick = <K extends keyof PlantDef>(k: K, label: string, options: { value: string; label: string }[], fallback?: string) => {
    const value = String(p![k] ?? fallback);
    const was = String(dflt![k as keyof typeof dflt] ?? fallback);
    return (
      <PRow label={label} changed={value !== was} onReset={() => edit({ [k]: dflt![k as keyof typeof dflt] } as Partial<PlantDef>)}>
        {options.length > 4 ? (
          <select className="cw-input" aria-label={label} value={value} onChange={(e) => edit({ [k]: e.currentTarget.value } as Partial<PlantDef>)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <Segmented label={label} value={value} onChange={(v) => edit({ [k]: v } as Partial<PlantDef>)} options={options} />
        )}
      </PRow>
    );
  };
  const colour = (k: 'colour' | 'tipColour' | 'trunkColour', label: string) => (
    <PRow label={label} changed={p![k] !== dflt![k]} onReset={() => edit({ [k]: dflt![k] })}>
      <ColorField label={label} value={p![k]} onChange={(v) => edit({ [k]: v }, k)} />
    </PRow>
  );
  const shuffle = () => setSeeds(Array.from({ length: 6 }, () => Math.floor(Math.random() * 1e6)));
  const tiles = (items: Preset[], own: boolean) =>
    items.map((x) => (
      <div key={x.key} className="cw-plants-tile">
        <button type="button" title={L(`New ${x.name}`, `Новое: ${x.name}`)} aria-label={`+ ${x.name}`} onClick={() => add(x)}>
          <Thumb def={x.def} />
          <span>{x.name}</span>
        </button>
        {own && (
          <button
            type="button"
            className="cw-plants-tile-x"
            aria-label={L(`Remove preset ${x.name}`, `Убрать заготовку ${x.name}`)}
            onClick={() => {
              const next = mine.filter((m) => m.key !== x.key);
              setMine(next);
              saveMine(next);
            }}
          >
            ×
          </button>
        )}
      </div>
    ));
  return (
    <div className="cw-plants">
      <aside className="cw-plants-list" aria-label={L('Plants', 'Растения')}>
        <div className="cw-lib-cats-h">{L('New from', 'Новое из')}</div>
        <div className="cw-plants-tiles">{tiles(PLANT_PRESETS, false)}</div>
        {mine.length > 0 && (
          <>
            <div className="cw-lib-cats-h">{L('My presets', 'Мои заготовки')}</div>
            <div className="cw-plants-tiles">{tiles(mine, true)}</div>
          </>
        )}
        <div className="cw-lib-cats-h">{L('Project plants', 'Растения проекта')}</div>
        <div className="cw-lib-cats" role="listbox" aria-label={L('Project plants', 'Растения проекта')}>
          {list.map((x) =>
            renaming === x.id ? (
              <input
                key={x.id}
                className="cw-input"
                autoFocus
                aria-label={L('Name', 'Имя')}
                defaultValue={x.name}
                onBlur={(e) => {
                  const name = e.currentTarget.value.trim();
                  if (name && name !== x.name) st.setPlants(list.map((y) => (y.id === x.id ? { ...y, name } : y)), `Rename ${x.name}`);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <button key={x.id} type="button" role="option" aria-selected={x.id === sel} className={`cw-plants-item${x.id === sel ? ' on' : ''}`} title={L('Double-click to rename', 'Двойной щелчок — переименовать')} onClick={() => setSel(x.id)} onDoubleClick={() => setRenaming(x.id)}>
                <Thumb def={x} />
                <span>{x.name}</span>
              </button>
            ),
          )}
          {!list.length && <div className="cw-muted">{L('None yet: start from a preset above.', 'Пока нет: начните с заготовки выше.')}</div>}
        </div>
      </aside>
      <div className="cw-plants-view">{p ? <PlantPreview def={p} /> : <div className="cw-muted cw-plants-empty">{L('Pick a preset to make your first plant.', 'Выберите заготовку для первого растения.')}</div>}</div>
      {p && dflt && (
        <aside className="cw-plants-props" aria-label={L('Plant', 'Растение')}>
          <div className="cw-plants-actions">
            <Button size="sm" onClick={() => edit({ ...dflt, preset: p.preset })}>
              {L('Reset to preset', 'Сбросить к заготовке')}
            </Button>
          </div>
          <PRow label={L('Name', 'Имя')}>
            <input className="cw-input" aria-label={L('Name', 'Имя')} value={p.name} onChange={(e) => edit({ name: e.currentTarget.value }, 'name')} onKeyDown={(e) => e.stopPropagation()} />
          </PRow>
          {pick('form', L('Kind', 'Вид'), [{ value: 'clump', label: L('Clump', 'Куст') }, { value: 'tree', label: L('Tree', 'Дерево') }])}
          {p.form === 'clump' ? (
            <>
              {num('blades', L('Blades', 'Листья'), 0, 80, 1, '#')}
              {num('bladeHeight', L('Blade height', 'Высота листьев'), 1, 400, 0.5)}
              {num('bladeWidth', L('Blade width', 'Ширина листьев'), 0.2, 80, 0.1)}
              {pick('bladeShape', L('Blade shape', 'Форма листа'), [{ value: 'grass', label: L('Grass', 'Трава') }, { value: 'strap', label: L('Strap', 'Лента') }, { value: 'leaf', label: L('Leaf', 'Лист') }])}
              {num('spread', L('Lean out', 'Наклон'), 0, 85, 1, '°')}
              {num('bend', L('Droop', 'Изгиб'), 0, 1.5, 0.05, '#')}
              {num('stalks', L('Stalks', 'Стебли'), 0, 30, 1, '#')}
              {num('stalkHeight', L('Stalk height', 'Высота стеблей'), 2, 600, 0.5)}
              {num('buds', L('Leaves per stalk', 'Листьев на стебле'), 0, 12, 1, '#')}
            </>
          ) : (
            <>
              {num('height', L('Height', 'Высота'), 10, 3000, 5)}
              {num('trunkWidth', L('Trunk width', 'Толщина ствола'), 0.5, 120, 0.5)}
              {num('trunkClear', L('Bare trunk', 'Голый ствол'), 0, 0.8, 0.01, '#')}
              {pick('crown', L('Crown', 'Крона'), [
                { value: 'round', label: L('Round', 'Круглая') },
                { value: 'oval', label: L('Oval', 'Овальная') },
                { value: 'column', label: L('Column', 'Колонна') },
                { value: 'cone', label: L('Cone', 'Конус') },
                { value: 'poplar', label: L('Poplar', 'Тополь') },
                { value: 'umbrella', label: L('Umbrella', 'Зонтик') },
                { value: 'weeping', label: L('Weeping', 'Плакучая') },
              ])}
              {num('crownWidth', L('Crown width', 'Ширина кроны'), 5, 1500, 5)}
              {num('droop', L('Hanging leaves', 'Свисание листвы'), 0, 1, 0.05, '#', p.crown === 'weeping' ? 0.8 : 0)}
              {pick('foliage', L('Leaves as', 'Листва'), [{ value: 'cards', label: L('Cards', 'Листики') }, { value: 'lumps', label: L('Lumps', 'Комки') }])}
              {num('leaves', L('Leaves', 'Листьев'), 3, 3000, 5, '#')}
              {num('leafSize', L('Leaf size', 'Размер листа'), 1, 300, 0.5)}
              {p.foliage === 'lumps' && (
                <>
                  {pick('lumpShape', L('Lump shape', 'Форма комков'), [{ value: 'diamond', label: L('Diamond', 'Ромб') }, { value: 'round', label: L('Round', 'Круглые') }, { value: 'blob', label: L('Blob', 'Капля') }, { value: 'spiky', label: L('Spiky', 'Колючие') }], 'diamond')}
                  {num('lumpX', L('Lump width (X)', 'Ширина комка (X)'), 0.1, 4, 0.05, '×', 1)}
                  {num('lumpY', L('Lump height (Y)', 'Высота комка (Y)'), 0.1, 4, 0.05, '×', 1.2)}
                  {num('lumpZ', L('Lump depth (Z)', 'Глубина комка (Z)'), 0.1, 4, 0.05, '×', 1)}
                </>
              )}
            </>
          )}
          {colour('colour', L('Root colour', 'Цвет у корня'))}
          {colour('tipColour', L('Tip colour', 'Цвет кончиков'))}
          {p.form === 'tree' && colour('trunkColour', L('Trunk colour', 'Цвет ствола'))}
          {num('variation', L('Variation', 'Разнообразие'), 0, 1, 0.05, '#')}
          {num('wind', L('Wind sway', 'Качание на ветру'), 0, 3, 0.05, '×', 1)}
          <PRow label={L('Seed', 'Зерно')}>
            <NumberField label="#" ariaLabel={L('Seed', 'Зерно')} step={1} value={p.seed} onChange={(v) => edit({ seed: Math.round(v) }, 'seed')} onCommit={(v) => edit({ seed: Math.round(v) }, 'seed')} />
          </PRow>
          <div className="cw-plants-actions">
            <Button onClick={shuffle}>{L('Shuffle variants', 'Перемешать варианты')}</Button>
          </div>
          {seeds.length > 0 && (
            <div className="cw-plants-variants" role="group" aria-label={L('Variants', 'Варианты')}>
              {seeds.map((seed) => (
                <button key={seed} type="button" className={seed === p.seed ? 'on' : ''} aria-label={L(`Use variant ${seed}`, `Взять вариант ${seed}`)} onClick={() => edit({ seed })}>
                  <Thumb def={p} seed={seed} />
                </button>
              ))}
            </div>
          )}
          <div className="cw-plants-actions">
            <Button variant="primary" onClick={() => st.placePlant(p.id)}>
              {L('Place in scene', 'Поставить в сцену')}
            </Button>
            <Button onClick={() => st.setPlants([...list, { ...p, id: newId(), name: `${p.name} copy` }], `Copy ${p.name}`)}>{L('Duplicate', 'Копия')}</Button>
            <Button
              onClick={() => {
                const { id: _id, name, ...def } = p;
                const key = `mine_${Date.now().toString(36)}`;
                const next = [...mine, { key, name, def: { ...def, preset: key } }];
                setMine(next);
                saveMine(next);
              }}
            >
              {L('Save as preset', 'Сохранить как заготовку')}
            </Button>
            <Button
              onClick={() => {
                st.setPlants(list.filter((x) => x.id !== p.id), `Delete ${p.name}`);
                setSel(null);
              }}
            >
              {L('Delete', 'Удалить')}
            </Button>
          </div>
          <div className="cw-muted cw-hint">{L('↺ beside a field puts back its preset value. Plants: double-click one in the list to rename it. To cover ground with it: a Foliage component on a brush or terrain, Plant set to this one.', '↺ рядом с полем возвращает значение заготовки. Двойной щелчок по растению в списке — переименовать. Чтобы покрыть землю: компонент «Растительность» на браше или ландшафте, «Растение» — это.')}</div>
        </aside>
      )}
    </div>
  );
}

/** A labelled field, with ↺ to put back its preset's value once it's been changed. */
function PRow({ label, changed, onReset, children }: { label: string; changed?: boolean; onReset?: () => void; children: React.ReactNode }) {
  return (
    <div className="cw-screens-row">
      <span className="cw-screens-l">
        {label}
        {changed && onReset && (
          <button type="button" className="cw-plants-reset" title={L('Back to preset value', 'Вернуть значение заготовки')} aria-label={L(`Reset ${label}`, `Сбросить: ${label}`)} onClick={onReset}>
            ↺
          </button>
        )}
      </span>
      <span className="cw-screens-v">{children}</span>
    </div>
  );
}

/** The plant turning slowly beside a person for scale, with its height. Drag to orbit, wheel to zoom. */
function PlantPreview({ def }: { def: PlantDef }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; ctl: OrbitControls; mesh: THREE.Mesh; pole: THREE.Line } | null>(null);
  const [h, setH] = useState(0);
  const [tris, setTris] = useState<number[]>([]);
  useEffect(() => {
    const el = host.current!;
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.shadowMap.enabled = true;
    r.setPixelRatio(window.devicePixelRatio);
    el.appendChild(r.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#b9c6d2');
    scene.add(new THREE.HemisphereLight('#eef4ff', '#8a96a4', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(-600, 1200, 500);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -900, right: 900, top: 900, bottom: -900, far: 4000 });
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#c9d3dc' }));
    ground.receiveShadow = true;
    scene.add(ground, new THREE.GridHelper(6000, 30, '#9aa7b4', '#aab6c2'));
    // A person (1.8 m) for scale.
    const person = new THREE.Group();
    const grey = new THREE.MeshLambertMaterial({ color: '#8f9aa6' });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(9, 40, 4, 10), grey);
    body.position.y = 29;
    const head = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8), grey);
    head.position.y = 64;
    person.add(body, head);
    person.traverse((o) => (o.castShadow = true));
    scene.add(person);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), plantMaterial());
    mesh.castShadow = true;
    scene.add(mesh);
    const pole = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#6f7c89' }));
    scene.add(pole);
    const cam = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    const ctl = new OrbitControls(cam, r.domElement);
    ctl.autoRotate = true;
    ctl.autoRotateSpeed = 0.8;
    ctl.enableDamping = true;
    view.current = { r, scene, cam, ctl, mesh, pole };
    let raf = 0;
    const loop = () => {
      const w = el.clientWidth, hh = el.clientHeight;
      if (r.domElement.width !== Math.floor(w * r.getPixelRatio()) || r.domElement.height !== Math.floor(hh * r.getPixelRatio())) {
        r.setSize(w, hh);
        cam.aspect = w / Math.max(1, hh);
        cam.updateProjectionMatrix();
      }
      ctl.update();
      PLANT_TIME.value = performance.now() / 1000;
      aimRim(scene, cam);
      r.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ctl.dispose();
      r.dispose();
      el.removeChild(r.domElement);
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.mesh.geometry = plantGeometry(def);
    setPlantWind(v.mesh.material as THREE.Material, def);
    const box = v.mesh.geometry.boundingBox!;
    const height = Math.max(box.max.y, 1);
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1);
    setH(height);
    setTris([0, 1, 2].map((l) => (plantGeometry(def, def.seed, l).index?.count ?? 0) / 3));
    // The height pole beside it, and the person just outside it.
    const x = width / 2 + 40;
    v.pole.geometry.dispose();
    v.pole.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, height, 0)]);
    v.scene.children.find((o) => o.type === 'Group')!.position.set(-(width / 2 + 40), 0, 0);
    const size = Math.max(height, width, 100);
    v.ctl.target.set(0, height * 0.45, 0);
    if (v.cam.position.lengthSq() === 0 || (v.cam.userData.size && Math.abs(v.cam.userData.size - size) / size > 0.5) || !v.cam.userData.size) {
      v.cam.position.set(size * 1.3, size * 0.75, size * 1.6);
      v.cam.userData.size = size;
    }
  }, [def]);
  return (
    <div className="cw-plants-preview" ref={host} data-testid="plant-preview">
      <div className="cw-plants-height">{(h / UNITS_PER_METRE).toFixed(2)} m · {Math.round(h)} u · {L('triangles', 'треугольников')}: {tris.map((n) => n.toLocaleString()).join(' / ')} {def.form === 'tree' ? L('(near / mid / far) · then a 2-triangle picture', '(близко / средне / далеко) · дальше картинка из 2 треугольников') : L('(near / mid / far)', '(близко / средне / далеко)')}</div>
    </div>
  );
}
