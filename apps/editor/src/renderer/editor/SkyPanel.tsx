/**
 * The Sky workspace: the current scene's sky, from presets (clear day, sunset, night…) and shaped with its colours,
 * sun, clouds and stars, previewed live over a little test ground (a tree, a ball, a box, a person) lit as the game
 * will light it. The sun's height and direction are the scene's Sun light, moved from here.
 */
import { PLANT_PRESETS, SKY_PRESETS, type SavedSky, readComponent, sceneSettings, skyOf, type PlantDef, type SkySettings } from '@cocoaworlds/core';
import { Button, ColorField, NumberField, Switch } from '@cocoaworlds/ui';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getLang } from '../i18n';
import { useEditor } from '../store';
import { PLANT_TIME, aimRim, plantGeometry, plantMaterial, setPlantWind } from '../viewport/plants';
import { applySky, skyAmbient, skyBoxPngs, skyEnvPng, skyMaterial, skyMesh, sunSkyColour } from '../viewport/sky';
import { Row } from './MaterialsPanel';

const L = (en: string, ru: string) => (getLang() === 'ru' ? ru : en);
const deg = Math.PI / 180;

type LightData = { kind: string; color: string; intensity: number };

/** The scene's first Sun: its id, where it shines from (height and turn, degrees), colour and brightness. */
function useSun() {
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.rev);
  const e = doc?.entities.find((x) => x.components.light && readComponent<LightData>('light', x.components.light).kind === 'directional');
  if (!doc || !e) return null;
  const l = readComponent<LightData>('light', e.components.light);
  const toward = new THREE.Vector3(0, 0, -1).transformDirection(new THREE.Matrix4().fromArray(doc.worldMatrix(e.id))).negate();
  return { id: e.id, height: Math.asin(Math.max(-1, Math.min(1, toward.y))) / deg, turn: (Math.atan2(toward.x, toward.z) / deg + 360) % 360, colour: l.color, intensity: l.intensity, toward };
}

export function SkyPanel() {
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.rev);
  const sun = useSun();
  const st = useEditor.getState();
  const saved = useEditor((s) => s.session?.project.settings.skies) ?? [];
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!doc) return null;
  const settings = sceneSettings(doc.settings);
  const sky = skyOf(settings.sky);
  const setSky = (patch: Partial<SkySettings>, key?: string) => st.setSceneSettings({ sky: { ...sky, ...patch } }, 'Edit sky', key ? `sky-${key}` : undefined);
  // The Sun light, turned to shine from this height and direction (its own turn kept as yaw and pitch).
  const aimSun = (height: number, turn: number, key?: string) => {
    const e = sun && doc.get(sun.id);
    if (!e) return;
    st.setTransform(e.id, { ...e.transform, rotation: [-height, turn, 0] }, key);
  };
  const apply = (p: { name: { en: string }; sky: Omit<SkySettings, 'enabled'>; sun?: { height: number; colour: string; intensity: number } }) => {
    st.begin(`Sky: ${p.name.en}`);
    st.setSceneSettings({ sky: { ...sky, ...p.sky, enabled: true } }, `Sky: ${p.name.en}`);
    if (sun && p.sun) {
      aimSun(p.sun.height, sun.turn);
      st.setComponentField(sun.id, 'light', 'color', p.sun.colour);
      st.setComponentField(sun.id, 'light', 'intensity', p.sun.intensity);
    }
    st.commit();
  };
  // Save the scene's sky (and where its sun stands) into the project, for any scene; then name it.
  const save = () => {
    const { enabled: _on, ...rest } = sky;
    const item: SavedSky = { id: `sky_${Date.now().toString(36)}`, name: `${L('Sky', 'Небо')} ${saved.length + 1}`, sky: rest, ...(sun ? { sun: { height: Math.round(sun.height), colour: sun.colour, intensity: sun.intensity } } : {}) };
    st.setSkies([...saved, item], 'Save sky');
    setRenaming(item.id);
  };
  const exportSky = async (as: 'env' | 'box') => {
    try {
      const r = await window.cocoa.materials.pickFolder(L('Export sky to…', 'Экспорт неба в…'));
      if (!r.ok) throw new Error(r.error);
      if (!r.value) return;
      const lit = sun ? { dir: sun.toward, colour: sunSkyColour(sun.colour, sun.intensity) } : null;
      const files = as === 'env' ? [{ name: 'sky_env.png', bytes: await skyEnvPng(sky, lit) }] : await skyBoxPngs(sky, lit);
      const w = await window.cocoa.materials.writeFiles(r.value, files);
      if (!w.ok) throw new Error(w.error);
      st.notify(L('Sky exported', 'Небо экспортировано'));
    } catch (e) {
      st.notify(`${L('Export failed', 'Ошибка экспорта')}: ${(e as Error).message}`);
    }
  };
  const swatch = (x: Omit<SkySettings, 'enabled'>) => ({ background: `linear-gradient(${x.top}, ${x.horizon} 62%, ${x.ground} 64%)` });
  const num = (k: keyof SkySettings, label: string, min: number, max: number, step: number, unit = '#') => {
    const set = (v: number) => setSky({ [k]: Math.min(max, Math.max(min, v)) } as Partial<SkySettings>, k);
    return (
      <Row label={label}>
        <NumberField label={unit} ariaLabel={label} step={step} value={Number(sky[k])} onChange={set} onCommit={set} />
      </Row>
    );
  };
  const colour = (k: 'top' | 'horizon' | 'ground' | 'cloudColour' | 'cloudShade', label: string) => (
    <Row label={label}>
      <ColorField label={label} value={sky[k]} onChange={(v) => setSky({ [k]: v }, k)} />
    </Row>
  );
  return (
    <div className="cw-plants cw-sky">
      <aside className="cw-plants-list" aria-label={L('Skies', 'Небо')}>
        <div className="cw-lib-cats-h">{L('Presets', 'Заготовки')}</div>
        <div className="cw-sky-presets">
          {SKY_PRESETS.map((p) => (
            <button key={p.key} type="button" className="cw-sky-preset" aria-label={L(`Sky preset ${p.name.en}`, `Заготовка неба ${p.name.ru}`)} onClick={() => apply(p)}>
              <span className="cw-sky-swatch" style={swatch(p.sky)} />
              <span>{p.name[getLang() === 'ru' ? 'ru' : 'en']}</span>
            </button>
          ))}
        </div>
        <div className="cw-lib-cats-h">{L('Project skies', 'Небо проекта')}</div>
        <div className="cw-sky-presets" role="list" aria-label={L('Project skies', 'Небо проекта')}>
          {saved.map((x) => (
            <div key={x.id} className="cw-plants-tile" role="listitem">
              {renaming === x.id ? (
                <input
                  className="cw-input"
                  autoFocus
                  aria-label={L('Sky name', 'Имя неба')}
                  defaultValue={x.name}
                  onBlur={(e) => {
                    const name = e.currentTarget.value.trim();
                    if (name && name !== x.name) st.setSkies(saved.map((y) => (y.id === x.id ? { ...y, name } : y)), 'Rename sky');
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <button type="button" className="cw-sky-preset" aria-label={L(`Use sky ${x.name}`, `Взять небо ${x.name}`)} onClick={() => apply({ name: { en: x.name }, sky: x.sky, sun: x.sun })} onDoubleClick={() => setRenaming(x.id)}>
                  <span className="cw-sky-swatch" style={swatch(x.sky)} />
                  <span>{x.name}</span>
                </button>
              )}
              <button type="button" className="cw-plants-tile-x" aria-label={L(`Delete sky ${x.name}`, `Удалить небо ${x.name}`)} onClick={() => st.setSkies(saved.filter((y) => y.id !== x.id), 'Delete sky')}>
                ×
              </button>
            </div>
          ))}
        </div>
        <Button onClick={save}>{L('Save this sky', 'Сохранить это небо')}</Button>
        <Button onClick={() => void exportSky('env')}>{L('Export sky as env texture', 'Экспорт неба как текстуры окружения')}</Button>
        <Button onClick={() => void exportSky('box')}>{L('Export sky as skybox (6 squares)', 'Экспорт неба как скайбокса (6 квадратов)')}</Button>
        <div className="cw-muted cw-hint">{L('A preset also sets the scene’s Sun: its height, colour and brightness (not its direction). Saved skies are kept in the project, for every scene; double-click one to rename it.', 'Заготовка задаёт и Солнце сцены: высоту, цвет и яркость (не направление). Сохранённое небо хранится в проекте, для всех сцен; двойной щелчок — переименовать.')}</div>
      </aside>
      <div className="cw-plants-view">
        <SkyPreview sky={settings.sky} ambient={{ colour: settings.ambientColor, intensity: settings.ambientIntensity }} sun={sun ? { toward: sun.toward, colour: sun.colour, intensity: sun.intensity } : null} />
      </div>
      <aside className="cw-plants-props" aria-label={L('Sky', 'Небо')}>
        <Row label={L('Sky', 'Небо')}>
          <Switch label={L('Sky on', 'Небо включено')} checked={sky.enabled} onChange={(v) => setSky({ enabled: v })} />
        </Row>
        <div className="cw-lib-cats-h">{L('Colours', 'Цвета')}</div>
        {colour('top', L('Overhead', 'Над головой'))}
        {colour('horizon', L('Horizon', 'Горизонт'))}
        {colour('ground', L('Below horizon', 'Ниже горизонта'))}
        {num('haze', L('Haze', 'Дымка'), 0, 1, 0.05)}
        <div className="cw-lib-cats-h">{L('Sun', 'Солнце')}</div>
        {sun ? (
          <>
            <Row label={L('Height', 'Высота')}>
              <NumberField label="°" ariaLabel={L('Sun height', 'Высота солнца')} step={1} value={Math.round(sun.height)} onChange={(v) => aimSun(Math.max(-20, Math.min(90, v)), sun.turn, 'sky-sun-aim')} onCommit={(v) => aimSun(Math.max(-20, Math.min(90, v)), sun.turn, 'sky-sun-aim')} />
            </Row>
            <Row label={L('Direction', 'Направление')}>
              <NumberField label="°" ariaLabel={L('Sun direction', 'Направление солнца')} step={1} value={Math.round(sun.turn)} onChange={(v) => aimSun(sun.height, ((v % 360) + 360) % 360, 'sky-sun-aim')} onCommit={(v) => aimSun(sun.height, ((v % 360) + 360) % 360, 'sky-sun-aim')} />
            </Row>
            <Row label={L('Sun colour', 'Цвет солнца')}>
              <ColorField label={L('Sun colour', 'Цвет солнца')} value={sun.colour} onChange={(v) => st.setComponentField(sun.id, 'light', 'color', v, 'sky-sun-colour')} />
            </Row>
            <Row label={L('Brightness', 'Яркость')}>
              <NumberField label="#" ariaLabel={L('Sun brightness', 'Яркость солнца')} step={0.05} value={sun.intensity} onChange={(v) => st.setComponentField(sun.id, 'light', 'intensity', Math.max(0, v), 'sky-sun-int')} onCommit={(v) => st.setComponentField(sun.id, 'light', 'intensity', Math.max(0, v), 'sky-sun-int')} />
            </Row>
          </>
        ) : (
          <div className="cw-plants-actions">
            <Button
              onClick={() => {
                st.add('sun');
                st.setWorkspace('sky');
              }}
            >
              {L('Add a sun', 'Добавить солнце')}
            </Button>
            <span className="cw-muted cw-hint">{L('The disc and the light both come from the scene’s Sun.', 'Диск и свет берутся от Солнца сцены.')}</span>
          </div>
        )}
        {num('sunSize', L('Disc size', 'Размер диска'), 0, 20, 0.1, '°')}
        {num('sunGlow', L('Glow', 'Сияние'), 0, 2, 0.05)}
        <div className="cw-lib-cats-h">{L('Clouds', 'Облака')}</div>
        {num('clouds', L('Cover', 'Покрытие'), 0, 1, 0.02)}
        {num('cloudSoftness', L('Softness', 'Мягкость'), 0, 1, 0.05)}
        {num('cloudSize', L('Size', 'Размер'), 0.2, 4, 0.05, '×')}
        {num('cloudSpeed', L('Drift speed', 'Скорость'), 0, 5, 0.1, '×')}
        {colour('cloudColour', L('Lit side', 'Светлая сторона'))}
        {colour('cloudShade', L('Shaded side', 'Тёмная сторона'))}
        <div className="cw-lib-cats-h">{L('Night', 'Ночь')}</div>
        {num('stars', L('Stars', 'Звёзды'), 0, 1, 0.05)}
        <div className="cw-lib-cats-h">{L('Lighting', 'Освещение')}</div>
        <Row label={L('Light from the sky', 'Свет от неба')}>
          <Switch label={L('Light from the sky', 'Свет от неба')} checked={sky.lightFromSky} onChange={(v) => setSky({ lightFromSky: v })} />
        </Row>
        <Row label={L('Reflect the scene', 'Отражать сцену')}>
          <Switch label={L('Reflect the scene', 'Отражать сцену')} checked={settings.reflections !== false} onChange={(v) => st.setSceneSettings({ reflections: v ? undefined : false }, v ? 'Scene reflections on' : 'Scene reflections off')} />
        </Row>
        {settings.reflections !== false && (
          <Row label={L('Probes for rooms', 'Зонды для комнат')}>
            <Switch label={L('Probes for rooms', 'Зонды для комнат')} checked={settings.autoProbes !== false} onChange={(v) => st.setSceneSettings({ autoProbes: v ? undefined : false }, v ? 'Room probes on' : 'Room probes off')} />
          </Row>
        )}
        <Row label={L('Ambient brightness', 'Яркость окружения')}>
          <NumberField label="#" ariaLabel={L('Ambient brightness', 'Яркость окружения')} step={0.05} value={settings.ambientIntensity} onChange={(v) => st.setSceneSettings({ ambientIntensity: Math.max(0, v) }, 'Ambient', 'sky-amb')} onCommit={(v) => st.setSceneSettings({ ambientIntensity: Math.max(0, v) }, 'Ambient', 'sky-amb')} />
        </Row>
        <div className="cw-muted cw-hint">{L('Light from the sky: the ambient light (and fog, if on) take their colours from the sky, so the scene matches what’s above it. Reflect the scene: shiny and metal materials reflect the level around the camera (captured as you move), not just the sky. Probes for rooms: rooms the brushes make get their own reflections, fitted to their walls (View › Show reflection probes shows them; add a Reflection probe to place one yourself).', 'Свет от неба: окружающий свет (и туман, если включён) берут цвета неба, и сцена совпадает с тем, что над ней.')}</div>
      </aside>
    </div>
  );
}

/** The sky over a small test ground, lit as the game will light it. Drag to look round, wheel to zoom. */
function SkyPreview({ sky, ambient, sun }: { sky: SkySettings | undefined; ambient: { colour: string; intensity: number }; sun: { toward: THREE.Vector3; colour: string; intensity: number } | null }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ mat: THREE.ShaderMaterial; hemi: THREE.HemisphereLight; light: THREE.DirectionalLight; dome: THREE.Mesh; cam: THREE.PerspectiveCamera; tree: THREE.Mesh; aimed: boolean } | null>(null);
  useEffect(() => {
    const el = host.current!;
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.shadowMap.enabled = true;
    r.setPixelRatio(window.devicePixelRatio);
    el.appendChild(r.domElement);
    const scene = new THREE.Scene();
    const mat = skyMaterial();
    const dome = skyMesh(mat);
    scene.add(dome);
    const hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
    const light = new THREE.DirectionalLight('#ffffff', 2);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 1, far: 4000 });
    light.shadow.normalBias = 2.5;
    light.shadow.radius = 1.5;
    scene.add(hemi, light, light.target);
    // The test ground: grass-green floor, a tree, a ball, a box and a person for scale.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2400, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6b8a4e', roughness: 1 }));
    floor.receiveShadow = true;
    const grey = new THREE.MeshStandardMaterial({ color: '#c9c4bb', roughness: 0.8 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshStandardMaterial({ color: '#d8d4cc', roughness: 0.35, metalness: 0.1 }));
    ball.position.set(-140, 40, 60);
    const box = new THREE.Mesh(new THREE.BoxGeometry(90, 90, 90), grey);
    box.position.set(140, 45, -40);
    box.rotation.y = 0.5;
    const person = new THREE.Mesh(new THREE.CapsuleGeometry(9, 40, 4, 10), grey);
    person.position.set(-40, 29, 140);
    const poplar = PLANT_PRESETS.find((p) => p.key === 'poplar')!;
    const def = { ...poplar.def, id: 'sky-preview', name: '' } as PlantDef;
    const tree = new THREE.Mesh(plantGeometry(def), plantMaterial());
    setPlantWind(tree.material, def);
    tree.position.set(0, 0, -260);
    for (const o of [ball, box, person, tree]) o.castShadow = o.receiveShadow = true;
    scene.add(floor, ball, box, person, tree);
    const cam = new THREE.PerspectiveCamera(55, 1, 1, 20000);
    cam.position.set(0, 90, 420);
    const ctl = new OrbitControls(cam, r.domElement);
    ctl.target.set(0, 120, 0);
    ctl.enableDamping = true;
    ctl.maxDistance = 2000;
    view.current = { mat, hemi, light, dome, cam, tree, aimed: false };
    let raf = 0;
    const loop = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (r.domElement.width !== Math.floor(w * r.getPixelRatio()) || r.domElement.height !== Math.floor(h * r.getPixelRatio())) {
        r.setSize(w, h);
        cam.aspect = w / Math.max(1, h);
        cam.updateProjectionMatrix();
      }
      ctl.update();
      PLANT_TIME.value = performance.now() / 1000;
      cam.updateMatrixWorld();
      aimRim(scene, cam);
      r.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ctl.dispose();
      mat.dispose();
      r.dispose();
      el.removeChild(r.domElement);
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    // The first time there's a sun: look towards it (its disc and glow, the trees backlit).
    if (sun && !v.aimed) {
      v.aimed = true;
      const flat = new THREE.Vector3(sun.toward.x, 0, sun.toward.z);
      if (flat.lengthSq() > 1e-6) {
        flat.normalize();
        v.cam.position.set(-flat.x * 460, 90, -flat.z * 460);
        v.tree.position.set(flat.x * 260, 0, flat.z * 260);
      }
    }
    const s = skyOf(sky);
    applySky(v.mat, sky, sun ? { dir: sun.toward, colour: sunSkyColour(sun.colour, sun.intensity) } : null);
    v.dome.visible = s.enabled;
    const fromSky = s.enabled && s.lightFromSky;
    const a = skyAmbient(sky);
    v.hemi.color.copy(fromSky ? a.above : new THREE.Color(ambient.colour));
    v.hemi.groundColor.copy(fromSky ? a.below : new THREE.Color(ambient.colour).multiplyScalar(0.35));
    v.hemi.intensity = ambient.intensity * 2.2;
    v.light.visible = !!sun;
    if (sun) {
      v.light.color.set(sun.colour);
      v.light.intensity = sun.intensity;
      v.light.position.copy(sun.toward).multiplyScalar(1500);
    }
  }, [JSON.stringify([sky, ambient, sun && [sun.toward.toArray(), sun.colour, sun.intensity]])]);
  return <div className="cw-plants-preview" ref={host} data-testid="sky-preview" />;
}
