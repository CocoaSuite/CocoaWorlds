/**
 * The Plants workspace: make grass clumps, leafy plants, budding stalks and trees from presets, shape them with
 * sliders while a live preview turns beside a person for scale, and place them (or grow them as Foliage).
 */
import { PLANT_PRESETS, type PlantDef } from '@cocoaworlds/core';
import { Button, ColorField, Segmented } from '@cocoaworlds/ui';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getLang } from '../i18n';
import { useEditor } from '../store';
import { PLANT_MATERIAL, plantGeometry } from '../viewport/plants';
import { UNITS_PER_METRE } from '../viewport/models';
import { Row, Slider } from './MaterialsPanel';

const L = (en: string, ru: string) => (getLang() === 'ru' ? ru : en);
const newId = () => `plant_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function PlantsPanel() {
  const list = useEditor((s) => s.session?.project.settings.plants) ?? [];
  const [sel, setSel] = useState<string | null>(list[0]?.id ?? null);
  const p = list.find((x) => x.id === sel) ?? null;
  const st = useEditor.getState();
  const edit = (patch: Partial<PlantDef>, key?: string) =>
    p && st.setPlants(list.map((x) => (x.id === p.id ? { ...x, ...patch } : x)), `Edit ${p.name}`, key ? `plant-${key}-${p.id}` : undefined);
  const add = (preset: (typeof PLANT_PRESETS)[number]) => {
    const def: PlantDef = { ...preset.def, id: newId(), name: preset.name };
    st.setPlants([...list, def], `New ${preset.name}`);
    setSel(def.id);
  };
  const num = (k: keyof PlantDef, label: string, min: number, max: number, step = 1, digits = 0) => (
    <Row label={label}>
      <Slider label={label} value={Number(p![k])} min={min} max={max} step={step} digits={digits} onChange={(v) => edit({ [k]: v } as Partial<PlantDef>, k)} />
    </Row>
  );
  return (
    <div className="cw-plants">
      <aside className="cw-plants-list" aria-label={L('Plants', 'Растения')}>
        <div className="cw-lib-cats-h">{L('New from', 'Новое из')}</div>
        {PLANT_PRESETS.map((x) => (
          <Button key={x.key} size="sm" onClick={() => add(x)}>
            + {x.name}
          </Button>
        ))}
        <div className="cw-lib-cats-h">{L('Project plants', 'Растения проекта')}</div>
        <div className="cw-lib-cats" role="listbox" aria-label={L('Project plants', 'Растения проекта')}>
          {list.map((x) => (
            <button key={x.id} type="button" role="option" aria-selected={x.id === sel} className={x.id === sel ? 'on' : ''} onClick={() => setSel(x.id)}>
              <span>{x.name}</span>
            </button>
          ))}
          {!list.length && <div className="cw-muted">{L('None yet: start from a preset above.', 'Пока нет: начните с заготовки выше.')}</div>}
        </div>
      </aside>
      <div className="cw-plants-view">{p ? <PlantPreview def={p} /> : <div className="cw-muted cw-plants-empty">{L('Pick a preset to make your first plant.', 'Выберите заготовку для первого растения.')}</div>}</div>
      {p && (
        <aside className="cw-plants-props" aria-label={L('Plant', 'Растение')}>
          <Row label={L('Name', 'Имя')}>
            <input className="cw-input" aria-label={L('Name', 'Имя')} value={p.name} onChange={(e) => edit({ name: e.currentTarget.value }, 'name')} onKeyDown={(e) => e.stopPropagation()} />
          </Row>
          <Row label={L('Kind', 'Вид')}>
            <Segmented label={L('Kind', 'Вид')} value={p.form} onChange={(form) => edit({ form })} options={[{ value: 'clump', label: L('Clump', 'Куст') }, { value: 'tree', label: L('Tree', 'Дерево') }]} />
          </Row>
          {p.form === 'clump' ? (
            <>
              {num('blades', L('Blades', 'Листья'), 0, 60)}
              {num('bladeHeight', L('Blade height', 'Высота листьев'), 4, 400)}
              {num('bladeWidth', L('Blade width', 'Ширина листьев'), 1, 80)}
              <Row label={L('Blade shape', 'Форма листа')}>
                <Segmented label={L('Blade shape', 'Форма листа')} value={p.bladeShape} onChange={(bladeShape) => edit({ bladeShape })} options={[{ value: 'grass', label: L('Grass', 'Трава') }, { value: 'strap', label: L('Strap', 'Лента') }, { value: 'leaf', label: L('Leaf', 'Лист') }]} />
              </Row>
              {num('spread', L('Lean out (°)', 'Наклон (°)'), 0, 85)}
              {num('bend', L('Droop', 'Изгиб'), 0, 1.5, 0.05, 2)}
              {num('stalks', L('Stalks', 'Стебли'), 0, 30)}
              {num('stalkHeight', L('Stalk height', 'Высота стеблей'), 10, 600)}
              {num('buds', L('Leaves per stalk', 'Листьев на стебле'), 0, 12)}
            </>
          ) : (
            <>
              {num('height', L('Height', 'Высота'), 40, 3000, 10)}
              {num('trunkWidth', L('Trunk width', 'Толщина ствола'), 2, 120)}
              {num('trunkClear', L('Bare trunk', 'Голый ствол'), 0, 0.8, 0.01, 2)}
              <Row label={L('Crown', 'Крона')}>
                <Segmented label={L('Crown', 'Крона')} value={p.crown} onChange={(crown) => edit({ crown })} options={[{ value: 'round', label: L('Round', 'Круглая') }, { value: 'column', label: L('Column', 'Колонна') }, { value: 'cone', label: L('Cone', 'Конус') }, { value: 'poplar', label: L('Poplar', 'Тополь') }]} />
              </Row>
              {num('crownWidth', L('Crown width', 'Ширина кроны'), 20, 1500, 10)}
              <Row label={L('Leaves as', 'Листва')}>
                <Segmented label={L('Leaves as', 'Листва')} value={p.foliage} onChange={(foliage) => edit({ foliage })} options={[{ value: 'cards', label: L('Cards', 'Листики') }, { value: 'lumps', label: L('Lumps', 'Комки') }]} />
              </Row>
              {num('leaves', L('Leaves', 'Листьев'), 5, 3000, 5)}
              {num('leafSize', L('Leaf size', 'Размер листа'), 4, 300)}
              {p.foliage === 'lumps' && (
                <>
                  <Row label={L('Lump shape', 'Форма комков')}>
                    <Segmented label={L('Lump shape', 'Форма комков')} value={p.lumpShape ?? 'diamond'} onChange={(lumpShape) => edit({ lumpShape })} options={[{ value: 'diamond', label: L('Diamond', 'Ромб') }, { value: 'round', label: L('Round', 'Круглые') }, { value: 'blob', label: L('Blob', 'Капля') }, { value: 'spiky', label: L('Spiky', 'Колючие') }]} />
                  </Row>
                  <Row label={L('Lump width (X)', 'Ширина комка (X)')}>
                    <Slider label={L('Lump width (X)', 'Ширина комка (X)')} value={p.lumpX ?? 1} min={0.2} max={3} step={0.05} digits={2} onChange={(lumpX) => edit({ lumpX }, 'lumpX')} />
                  </Row>
                  <Row label={L('Lump height (Y)', 'Высота комка (Y)')}>
                    <Slider label={L('Lump height (Y)', 'Высота комка (Y)')} value={p.lumpY ?? 1.2} min={0.2} max={3} step={0.05} digits={2} onChange={(lumpY) => edit({ lumpY }, 'lumpY')} />
                  </Row>
                  <Row label={L('Lump depth (Z)', 'Глубина комка (Z)')}>
                    <Slider label={L('Lump depth (Z)', 'Глубина комка (Z)')} value={p.lumpZ ?? 1} min={0.2} max={3} step={0.05} digits={2} onChange={(lumpZ) => edit({ lumpZ }, 'lumpZ')} />
                  </Row>
                </>
              )}
            </>
          )}
          <Row label={L('Root colour', 'Цвет у корня')}>
            <ColorField label={L('Root colour', 'Цвет у корня')} value={p.colour} onChange={(colour) => edit({ colour }, 'colour')} />
          </Row>
          <Row label={L('Tip colour', 'Цвет кончиков')}>
            <ColorField label={L('Tip colour', 'Цвет кончиков')} value={p.tipColour} onChange={(tipColour) => edit({ tipColour }, 'tip')} />
          </Row>
          {p.form === 'tree' && (
            <Row label={L('Trunk colour', 'Цвет ствола')}>
              <ColorField label={L('Trunk colour', 'Цвет ствола')} value={p.trunkColour} onChange={(trunkColour) => edit({ trunkColour }, 'trunk')} />
            </Row>
          )}
          {num('variation', L('Variation', 'Разнообразие'), 0, 1, 0.05, 2)}
          <div className="cw-plants-actions">
            <Button onClick={() => edit({ seed: Math.floor(Math.random() * 1e6) })}>{L('New variation', 'Другой вариант')}</Button>
            <Button variant="primary" onClick={() => st.placePlant(p.id)}>
              {L('Place in scene', 'Поставить в сцену')}
            </Button>
            <Button onClick={() => st.setPlants([...list, { ...p, id: newId(), name: `${p.name} copy` }], `Copy ${p.name}`)}>{L('Duplicate', 'Копия')}</Button>
            <Button
              onClick={() => {
                st.setPlants(list.filter((x) => x.id !== p.id), `Delete ${p.name}`);
                setSel(null);
              }}
            >
              {L('Delete', 'Удалить')}
            </Button>
          </div>
          <div className="cw-muted cw-hint">{L('To cover ground with it: a Foliage component on a brush or terrain, Plant set to this one.', 'Чтобы покрыть землю: компонент «Растительность» на браше или ландшафте, «Растение» — это.')}</div>
        </aside>
      )}
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
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), PLANT_MATERIAL);
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
