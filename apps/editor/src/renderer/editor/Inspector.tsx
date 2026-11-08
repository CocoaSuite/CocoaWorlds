/** Inspector for the selection (CocoaCanvas right panel). Scene settings when nothing is selected. */
import { SurfaceSoundsEditor } from './SurfaceSounds';
import { PaintPanel } from '../viewport/PaintPanel';
import { useState } from 'react';
import { shown, stored, type AxisKind } from '../axes';
import { PIVOT, aoOf, bloomOf, dayOf, backgroundSoundOf, gameRules, pivotOf, sceneSettings, worldBoundsOf, type EmptyClass, type EntityData, type SceneSettings as SceneSettingsData, type Transform, type Vec3 } from '@cocoaworlds/core';
import { brushBounds, brushOf } from '../brush/brushes';
import { Button, ColorField, Field, NumberField, PanelHeader, Section, Switch } from '@cocoaworlds/ui';
import { storeProgress } from '../game/progress';
import { t } from '../i18n';
import { BrushInspector, MultiBrushActions } from './BrushInspector';
import { FaceInspector } from './FaceInspector';
import { MaterialPicker } from './MaterialPicker';
import { buildingCatalog } from '@cocoaworlds/runtime';
import { ComponentsSection } from './ComponentsSection';
import { PrefabSection } from './PrefabSection';
import { isGroup } from '../scene-ops';
import { clearsGrass } from '../viewport/foliage';
import { isPlainEmpty } from '../viewport/markers';
import { useSelectedEntities, useEditor } from '../store';

export function Inspector() {
  useEditor((s) => s.rev);
  const sel = useSelectedEntities();
  const faceTool = useEditor((s) => s.tool === 'face');
  const paintTool = useEditor((s) => s.tool === 'paint');
  const kind = sel.length === 1 ? componentLabel(sel[0]!) : sel.length > 1 ? `${sel.length}` : '';
  return (
    <aside className="cw-side cw-right" aria-label={t('insp.title')}>
      <PanelHeader title={t('insp.title')}>{kind && <span className="cw-ph-note">{kind}</span>}</PanelHeader>
      <div className="cw-insp cw-scroll">
        {paintTool && <PaintPanel />}
        {faceTool && <FaceInspector />}
        {!faceTool && !paintTool && sel.length === 0 && <SceneSettings />}
        {!faceTool && !paintTool && sel.length === 1 && (sel[0]!.components.brush ? <BrushEntity e={sel[0]!} /> : isGroupEntity(sel[0]!) ? <GroupEntity e={sel[0]!} /> : <EntityInspector e={sel[0]!} />)}
        {!faceTool && !paintTool && sel.length > 1 && (
          <>
            <p className="cw-empty">
              {sel.length} {t('insp.multi')}
            </p>
            <MultiBrushActions count={sel.filter((e) => (e.components.brush as { role?: string } | undefined)?.role === 'solid').length} />
          </>
        )}
      </div>
    </aside>
  );
}

/** Brushes: name, brush settings, visibility. Their transform lives in the geometry, so no transform rows. */
function BrushEntity({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  return (
    <>
      <input
        className="cw-input"
        aria-label={t('insp.name')}
        key={`${e.id}-${e.name}`}
        defaultValue={e.name}
        onKeyDown={(ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') ev.currentTarget.blur();
        }}
        onBlur={(ev) => s.rename(e.id, ev.currentTarget.value)}
      />
      <PrefabSection e={e} />
      <BrushInspector e={e} />
      <PivotSection e={e} />
      <ComponentsSection e={e} />
      <Section title={t('insp.display')}>
        <div className="cw-flagrow">
          <span>{t('insp.visible')}</span>
          <Switch label={t('insp.visible')} checked={e.visible} onChange={(v) => s.setFlag(e.id, 'visible', v)} />
        </div>
        <div className="cw-flagrow">
          <span>{t('insp.locked')}</span>
          <Switch label={t('insp.locked')} checked={e.locked} onChange={(v) => s.setFlag(e.id, 'locked', v)} />
        </div>
        <div className="cw-flagrow">
          <span>{t('insp.clearsGrass')}</span>
          <Switch label={t('insp.clearsGrass')} checked={clearsGrass(e)} onChange={(v) => s.setFlag(e.id, 'keepsGrass', !v)} />
        </div>
        <div className="cw-flagrow">
          <span>{t('insp.smooth')}</span>
          <Switch label={t('insp.smooth')} checked={!!e.components.smooth} onChange={(v) => s.setSmooth(e.id, v)} />
        </div>
        <BrushTint e={e} />
      </Section>
    </>
  );
}

/** A brush's tint: set on every face (the Face tool tints faces one by one). */
function BrushTint({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  const faces = brushOf(e)?.brush.faces ?? [];
  if (!faces.length) return null;
  const first = faces[0]!.surface.tint ?? '#ffffff';
  const mixed = faces.some((f) => (f.surface.tint ?? '#ffffff') !== first);
  const set = (v: string) => s.setFaceSurfaces(faces.map((_, i) => ({ id: e.id, face: i, patch: { tint: v } })), 'Tint', `tint-${e.id}`);
  return (
    <Field label={t('insp.tint')}>
      <div className="cw-row">
        <ColorField label={t('insp.tint')} value={mixed ? t('face.mixed') : first} onChange={set} />
        {(mixed || first !== '#ffffff') && <Button onClick={() => set('')}>{t('insp.tintClear')}</Button>}
      </div>
    </Field>
  );
}

const isGroupEntity = (e: EntityData) => {
  const doc = useEditor.getState().doc;
  return !!doc && isGroup(doc, e);
};

/** Groups: name, what's inside, step in / ungroup, and visibility and lock for everything inside. */
function GroupEntity({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  const doc = useEditor((x) => x.doc)!;
  const count = doc.subtree(e.id).length - 1;
  return (
    <>
      <input
        className="cw-input"
        aria-label={t('insp.name')}
        key={`${e.id}-${e.name}`}
        defaultValue={e.name}
        onKeyDown={(ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') ev.currentTarget.blur();
        }}
        onBlur={(ev) => s.rename(e.id, ev.currentTarget.value)}
      />
      <PrefabSection e={e} />
      <TransformSection e={e} />
      <PivotSection e={e} />
      <Section title={t('insp.group')}>
        <div className="cw-f">
          <span>{t('insp.contains')}</span>
          <span data-testid="group-count">{count}</span>
        </div>
        <p className="cw-hint">{t('insp.groupHint')}</p>
        <div className="cw-row">
          <Button onClick={s.enterGroup}>{t('insp.selectInside')}</Button>
          <Button onClick={s.ungroupSelection}>{t('edit.ungroup')}</Button>
        </div>
      </Section>
      <Section title={t('insp.display')}>
        <div className="cw-flagrow">
          <span>{t('insp.visible')}</span>
          <Switch label={t('insp.visible')} checked={e.visible} onChange={(v) => s.setFlag(e.id, 'visible', v)} />
        </div>
        <div className="cw-flagrow">
          <span>{t('insp.locked')}</span>
          <Switch label={t('insp.locked')} checked={e.locked} onChange={(v) => s.setFlag(e.id, 'locked', v)} />
        </div>
      </Section>
    </>
  );
}

function componentLabel(e: EntityData): string {
  const brush = e.components.brush as { role?: string } | undefined;
  if (brush) return brush.role === 'subtract' ? t('brush.subtract') : t('insp.brush');
  const light = e.components.light as { kind?: string } | undefined;
  if (light) return `${light.kind ?? ''} light`;
  if (e.components.playerSpawn) return 'Player spawn';
  if (e.components.sign) return t('add.sign');
  if (e.components.stake) return t('add.stake');
  if (e.components.printer) return t('add.printer');
  if (e.components.poster) return t((e.components.poster as { rolls?: boolean }).rolls === false ? 'add.painting' : 'add.poster');
  if (isGroupEntity(e)) return t('insp.group');
  return 'Object';
}

function SceneSettings() {
  useEditor((s) => s.rev);
  const doc = useEditor((s) => s.doc)!;
  const st = useEditor.getState();
  const cur = sceneSettings(doc.settings);
  const ao = aoOf(doc.settings);
  const bloom = bloomOf(doc.settings);
  const day = dayOf(doc.settings);
  const set = (patch: Partial<SceneSettingsData>, label: string, mergeKey?: string) => st.setSceneSettings(patch, label, mergeKey);
  const sky = cur.sky!;
  const bg = backgroundSoundOf(doc.settings);
  const sounds = useEditor((s) => s.assets.sounds);
  const num = (label: string, value: number, step: number, onChange: (v: number) => void, unit = '#') => (
    <NumberField label={unit} ariaLabel={label} value={value} step={step} onChange={onChange} onCommit={onChange} />
  );
  return (
    <>
      <p className="cw-empty" style={{ padding: 0 }}>
        {t('insp.nothing')}
      </p>
      <Fold id="scene" title={t('insp.sceneSettings')}>
        <Field label={t('insp.name')}>
          <span>{doc.name}</span>
        </Field>
        <Field label={t('insp.gravity')}>
          {num(t('insp.gravity'), cur.gravity, 50, (v) => set({ gravity: Math.max(0, v) }, 'Gravity', 'scene-gravity'), 'u/s²')}
        </Field>
      </Fold>
      <Fold id="light" title={t('insp.lighting')}>
        <Field label={t('insp.ambient')}>
          <ColorField label={t('insp.ambient')} value={cur.ambientColor} onChange={(v) => set({ ambientColor: v }, 'Ambient colour', 'scene-ambient')} />
        </Field>
        <Field label={t('insp.ambientStrength')}>
          {num(t('insp.ambientStrength'), cur.ambientIntensity, 0.05, (v) => set({ ambientIntensity: Math.max(0, v) }, 'Ambient strength', 'scene-ambient-i'))}
        </Field>
        <Field label={t('insp.ao')}>
          <Switch label={t('insp.ao')} checked={ao.enabled} onChange={(v) => set({ ao: { ...ao, enabled: v } }, v ? 'Ambient occlusion on' : 'Ambient occlusion off')} />
        </Field>
        {ao.enabled && (
          <>
            <Field label={t('insp.aoStrength')}>{num(t('insp.aoStrength'), ao.strength, 0.1, (v) => set({ ao: { ...ao, strength: Math.max(0, Math.min(2, v)) } }, 'Occlusion strength', 'scene-ao-s'))}</Field>
            <Field label={t('insp.aoRadius')}>{num(t('insp.aoRadius'), ao.radius, 4, (v) => set({ ao: { ...ao, radius: Math.max(1, v) } }, 'Occlusion radius', 'scene-ao-r'), 'u')}</Field>
            <p className="cw-hint">{t('insp.aoHint')}</p>
          </>
        )}
        <Field label={t('insp.bloom')}>
          <Switch label={t('insp.bloom')} checked={bloom.enabled} onChange={(v) => set({ bloom: { ...bloom, enabled: v } }, v ? 'Bloom on' : 'Bloom off')} />
        </Field>
        {bloom.enabled && (
          <>
            <Field label={t('insp.bloomStrength')}>{num(t('insp.bloomStrength'), bloom.strength, 0.1, (v) => set({ bloom: { ...bloom, strength: Math.max(0, Math.min(3, v)) } }, 'Bloom strength', 'scene-bloom-s'))}</Field>
            <Field label={t('insp.bloomThreshold')}>{num(t('insp.bloomThreshold'), bloom.threshold, 0.05, (v) => set({ bloom: { ...bloom, threshold: Math.max(0, v) } }, 'Bloom threshold', 'scene-bloom-t'))}</Field>
            <Field label={t('insp.bloomRadius')}>{num(t('insp.bloomRadius'), bloom.radius, 0.05, (v) => set({ bloom: { ...bloom, radius: Math.max(0, Math.min(1, v)) } }, 'Bloom spread', 'scene-bloom-r'))}</Field>
          </>
        )}
        <Field label={t('insp.background')}>
          <ColorField label={t('insp.background')} value={cur.backgroundColor} onChange={(v) => set({ backgroundColor: v }, 'Background', 'scene-bg')} />
        </Field>
      </Fold>
      <Fold id="sky" title={t('insp.sky')}>
        <Field label={t('insp.skyOn')}>
          <Switch label={t('insp.skyOn')} checked={sky.enabled} onChange={(v) => set({ sky: { ...sky, enabled: v } }, v ? 'Sky on' : 'Sky off')} />
        </Field>
        <Button size="sm" onClick={() => st.setWorkspace('sky')}>
          {t('insp.openSky')}
        </Button>
        <Field label={t('insp.day')}>
          <Switch label={t('insp.day')} checked={day.enabled} onChange={(v) => set({ day: { ...day, enabled: v } }, v ? 'Day and night on' : 'Day and night off')} />
        </Field>
        {day.enabled && (
          <>
            <Field label={t('insp.dayStart')}>{num(t('insp.dayStart'), day.startHour, 0.5, (v) => set({ day: { ...day, startHour: ((v % 24) + 24) % 24 } }, 'Start hour', 'scene-day-h'), 'h')}</Field>
            <Field label={t('insp.dayFirst')}>{num(t('insp.dayFirst'), day.startDay, 1, (v) => set({ day: { ...day, startDay: Math.max(0, Math.round(v)) } }, 'Start day', 'scene-day-d'))}</Field>
            <Field label={t('insp.dayShow')}>
              <Switch label={t('insp.dayShow')} checked={day.showDay} onChange={(v) => set({ day: { ...day, showDay: v } }, v ? 'Day shown' : 'Day hidden')} />
            </Field>
            <Field label={t('insp.clockShow')}>
              <Switch label={t('insp.clockShow')} checked={!!day.showClock} onChange={(v) => set({ day: { ...day, showClock: v } }, v ? 'Clock shown' : 'Clock hidden')} />
            </Field>
            <Field label={t('insp.dayLength')}>{num(t('insp.dayLength'), day.minutes, 1, (v) => set({ day: { ...day, minutes: Math.max(0, v) } }, 'Day length', 'scene-day-m'), 'min')}</Field>
            <Field label={t('insp.dayNight')}>{num(t('insp.dayNight'), day.night, 0.05, (v) => set({ day: { ...day, night: Math.max(0, Math.min(1, v)) } }, 'Night brightness', 'scene-day-n'))}</Field>
            <p className="cw-hint">{t('insp.dayHint')}</p>
          </>
        )}
        <Field label={t('insp.fog')}>
          <Switch label={t('insp.fog')} checked={cur.fog.enabled} onChange={(v) => set({ fog: { ...cur.fog, enabled: v } }, v ? 'Fog on' : 'Fog off')} />
        </Field>
        {cur.fog.enabled && (
          <>
            {!(sky.enabled && sky.lightFromSky) && (
              <Field label={t('insp.fogColor')}>
                <ColorField label={t('insp.fogColor')} value={cur.fog.color} onChange={(v) => set({ fog: { ...cur.fog, color: v } }, 'Fog colour', 'scene-fog-c')} />
              </Field>
            )}
            <Field label={t('insp.fogNear')}>{num(t('insp.fogNear'), cur.fog.near, 64, (v) => set({ fog: { ...cur.fog, near: Math.max(0, v) } }, 'Fog', 'scene-fog-n'), 'u')}</Field>
            <Field label={t('insp.fogFar')}>{num(t('insp.fogFar'), cur.fog.far, 256, (v) => set({ fog: { ...cur.fog, far: Math.max(cur.fog.near + 1, v) } }, 'Fog', 'scene-fog-f'), 'u')}</Field>
          </>
        )}
        <p className="cw-hint">{t('insp.skyHint')}</p>
      </Fold>
      <Fold id="sound" title={t('insp.sound')}>
        <Field label={t('insp.bgSound')}>
          <select className="cw-input cw-select" aria-label={t('insp.bgSound')} value={bg.sound} onChange={(ev) => set({ backgroundSound: { ...bg, sound: ev.target.value } }, 'Background sound')}>
            <option value="">{t('assets.pick')}</option>
            {bg.sound && !sounds.some((a) => a.path === bg.sound) && <option value={bg.sound}>{bg.sound} ?</option>}
            {sounds.map((a) => (
              <option key={a.path} value={a.path}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        {bg.sound && <Field label={t('insp.bgVolume')}>{num(t('insp.bgVolume'), bg.volume, 0.1, (v) => set({ backgroundSound: { ...bg, volume: Math.max(0, Math.min(4, v)) } }, 'Background volume', 'scene-bg-vol'))}</Field>}
        <p className="cw-hint">{t('insp.bgSoundHint')}</p>
        <Field label={t('insp.acoustics')}>
          <Switch label={t('insp.acoustics')} checked={doc.settings.acoustics !== false} onChange={(v) => set({ acoustics: v }, v ? 'Realistic sound on' : 'Realistic sound off')} />
        </Field>
        <p className="cw-hint">{t('insp.acousticsHint')}</p>
      </Fold>
      <GameRulesSection />
      <Fold id="surfaceSounds" title={t('ss.title')}>
        <SurfaceSoundsEditor />
      </Fold>
    </>
  );
}

/** A section that folds away (remembered per section). */
function Fold({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const key = `cw-fold-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== '0';
    } catch {
      return true;
    }
  });
  const flip = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key, open ? '0' : '1');
    } catch {
      /* (Not kept.) */
    }
  };
  return (
    <>
      <button type="button" className="cw-sec cw-fold" aria-expanded={open} onClick={flip}>
        <span>
          <span className="cw-fold-a" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          {title}
        </span>
      </button>
      {open && children}
    </>
  );
}

/** Base building: the material each menu section's finished pieces are drawn with (touching pieces are stitched into one). */
function BuildingLooks() {
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.rev);
  const playing = useEditor((s) => !!s.playing);
  if (!doc) return null;
  const building = doc.settings.building ?? {};
  const looks = building.looks ?? {};
  const sections = [...new Set([...buildingCatalog(building).pieces.values()].map((d) => d.category))];
  const set = (section: string, material: string) => {
    if (playing) return;
    const next = { ...looks };
    if (material) next[section] = material;
    else delete next[section];
    useEditor.getState().setSceneSettings({ building: { ...building, looks: next } }, t('insp.buildingLook'));
  };
  return (
    <>
      <p className="cw-hint">{t('insp.buildingLooksHint')}</p>
      {sections.map((sec) => (
        <div key={sec} className="cw-row">
          <MaterialPicker label={sec} value={looks[sec] ?? null} onChange={(m) => set(sec, m)} />
          {looks[sec] && (
            <Button size="sm" onClick={() => set(sec, '')}>
              {t('insp.flatColour')}
            </Button>
          )}
        </div>
      ))}
    </>
  );
}

/** Built-in game systems for the whole project: a building or farming game may want no health or score. */
function GameRulesSection() {
  const project = useEditor((s) => s.session?.project);
  const set = useEditor((s) => s.setGameRule);
  const playing = useEditor((s) => !!s.playing);
  if (!project) return null;
  const rules = gameRules(project.settings);
  return (
    <Fold id="rules" title={t('insp.gameRules')}>
      <p className="cw-hint">{t('insp.gameRulesHint')}</p>
      <Field label={t('insp.health')}>
        <Switch checked={rules.health} label={t('insp.health')} onChange={(on) => !playing && void set('health', on)} />
      </Field>
      {rules.health && (
        <Field label={t('insp.hideHealth')}>
          <Switch checked={rules.hideHealth} label={t('insp.hideHealth')} onChange={(on) => !playing && void set('hideHealth', on)} />
        </Field>
      )}
      <Field label={t('insp.score')}>
        <Switch checked={rules.score} label={t('insp.score')} onChange={(on) => !playing && void set('score', on)} />
      </Field>
      <Field label={t('insp.thirdPerson')}>
        <Switch checked={rules.thirdPerson} label={t('insp.thirdPerson')} onChange={(on) => !playing && void set('thirdPerson', on)} />
      </Field>
      <Field label={t('insp.stamina')}>
        <Switch checked={rules.stamina} label={t('insp.stamina')} onChange={(on) => !playing && void set('stamina', on)} />
      </Field>
      <Field label={t('insp.showFps')}>
        <Switch checked={rules.showFps} label={t('insp.showFps')} onChange={(on) => !playing && void set('showFps', on)} />
      </Field>
      <Field label={t('insp.saveItems')}>
        <Switch checked={rules.saveItems} label={t('insp.saveItems')} onChange={(on) => !playing && void set('saveItems', on)} />
      </Field>
      <Field label={t('insp.saveWorld')}>
        <Switch checked={rules.saveWorld} label={t('insp.saveWorld')} onChange={(on) => !playing && void set('saveWorld', on)} />
      </Field>
      <Field label={t('insp.saveMenu')}>
        <Switch checked={rules.saveMenu} label={t('insp.saveMenu')} onChange={(on) => !playing && void set('saveMenu', on)} />
      </Field>
      <Field label={t('insp.building')}>
        <Switch checked={rules.building} label={t('insp.building')} onChange={(on) => !playing && void set('building', on)} />
      </Field>
      <p className="cw-hint">{t('insp.buildingHint')}</p>
      {rules.building && <BuildingLooks />}
      <p className="cw-hint">{t('insp.progressHint')}</p>
      <Button
        size="sm"
        disabled={playing}
        onClick={() => {
          storeProgress(project.id, null);
          useEditor.getState().log('info', 'Play', t('insp.progressForgotten'));
        }}
      >
        {t('insp.forgetProgress')}
      </Button>
    </Fold>
  );
}

function Vec3Row({ label, value: saved, step, onCommit: commitSaved, onLive: liveSaved, onBegin, name, kind }: { label: string; name: string; value: Vec3; step: number; kind: AxisKind; onBegin: () => void; onLive: (v: Vec3) => void; onCommit: (v: Vec3) => void }) {
  const axes = ['x', 'y', 'z'] as const;
  // (Shown Z-up when set; kept Y-up.)
  const zUp = useEditor((s) => s.zUp);
  const value = shown(saved, kind, zUp);
  const onLive = (v: Vec3) => liveSaved(stored(v, kind, zUp));
  const onCommit = (v: Vec3) => commitSaved(stored(v, kind, zUp));
  return (
    <div className="cw-f3">
      <span>{label}</span>
      {axes.map((a, i) => (
        <NumberField
          key={a}
          axis={a}
          label={a.toUpperCase()}
          ariaLabel={`${name} ${a.toUpperCase()}`}
          step={step}
          value={value[i]!}
          onBegin={onBegin}
          onChange={(v) => {
            const n = [...value] as Vec3;
            n[i] = v;
            onLive(n);
          }}
          onCommit={(v) => {
            const n = [...value] as Vec3;
            n[i] = v;
            onCommit(n);
          }}
        />
      ))}
    </div>
  );
}

/** Position, rotation and scale, relative to the parent when there is one. */
function TransformSection({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  const doc = useEditor((x) => x.doc);
  const grid = useEditor((x) => (x.snap ? (x.session?.project.settings.gridSize ?? 16) : 1));
  const tr = e.transform;
  const key = `insp-${e.id}`;
  const setPart = (part: keyof Transform, v: Vec3, live: boolean) => {
    const next: Transform = { ...tr, [part]: v };
    s.setTransform(e.id, next, live ? `${key}-${part}` : undefined);
  };
  const begin = () => s.begin('Move');
  const end = (part: keyof Transform) => (v: Vec3) => {
    setPart(part, v, true);
    s.commit();
  };
  const parent = e.parent ? doc?.get(e.parent) : undefined;
  return (
    <Section title={t('insp.transform')}>
      <Vec3Row label={t('insp.position')} name="Position" kind="point" value={tr.position} step={grid} onBegin={begin} onLive={(v) => setPart('position', v, true)} onCommit={end('position')} />
      <Vec3Row label={t('insp.rotation')} name="Rotation" kind="turn" value={tr.rotation} step={1} onBegin={begin} onLive={(v) => setPart('rotation', v, true)} onCommit={end('rotation')} />
      <Vec3Row label={t('insp.scale')} name="Scale" kind="size" value={tr.scale} step={0.05} onBegin={begin} onLive={(v) => setPart('scale', v, true)} onCommit={end('scale')} />
      {parent && <p className="cw-hint">{t('insp.relativeTo').replace('{name}', parent.name)}</p>}
    </Section>
  );
}

function EntityInspector({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  return (
    <>
      <input
        className="cw-input"
        aria-label={t('insp.name')}
        key={`${e.id}-${e.name}`}
        defaultValue={e.name}
        onKeyDown={(ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') ev.currentTarget.blur();
        }}
        onBlur={(ev) => s.rename(e.id, ev.currentTarget.value)}
      />
      <PrefabSection e={e} />
      <TransformSection e={e} />
      <PivotSection e={e} />
      {isPlainEmpty(e) && (
        <Field label={t('insp.class')}>
          <select className="cw-input cw-select" aria-label={t('insp.class')} value={e.emptyClass ?? ''} onChange={(ev) => s.setEmptyClass(e.id, (ev.target.value || undefined) as EmptyClass | undefined)}>
            {(['', 'point', 'assetSpawn', 'audioEmitter'] as const).map((c) => (
              <option key={c} value={c}>
                {t(`class.${c || 'none'}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Section title={t('insp.display')}>
        <div className="cw-flagrow">
          <span>{t('insp.visible')}</span>
          <Switch label={t('insp.visible')} checked={e.visible} onChange={(v) => s.setFlag(e.id, 'visible', v)} />
        </div>
        <div className="cw-flagrow">
          <span>{t('insp.locked')}</span>
          <Switch label={t('insp.locked')} checked={e.locked} onChange={(v) => s.setFlag(e.id, 'locked', v)} />
        </div>
        <div className="cw-flagrow">
          <span>{t('insp.clearsGrass')}</span>
          <Switch label={t('insp.clearsGrass')} checked={clearsGrass(e)} onChange={(v) => s.setFlag(e.id, 'keepsGrass', !v)} />
        </div>
      </Section>
      <ComponentsSection e={e} />
    </>
  );
}

/** The point the object turns and scales around (gizmo and scripts). */
function PivotSection({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  const doc = useEditor((x) => x.doc);
  useEditor((x) => x.rev);
  const pivotEdit = useEditor((x) => x.pivotEdit);
  const grid = useEditor((x) => (x.snap ? (x.session?.project.settings.gridSize ?? 16) : 1));
  if (!doc) return null;
  const r = (v: number) => Math.round(v * 100) / 100;
  const p = pivotOf(doc, e.id, brushBounds).map(r) as Vec3;
  const wb = worldBoundsOf(doc, e.id, brushBounds);
  const set = (v: Vec3, live: boolean) => s.setPivot(e.id, v, live ? `pivot-${e.id}` : undefined);
  return (
    <Section title={t('pivot.title')}>
      <Vec3Row
        label={t('pivot.at')}
        name="Pivot"
        kind="point"
        value={p}
        step={grid}
        onBegin={() => s.begin('Move pivot')}
        onLive={(v) => set(v, true)}
        onCommit={(v) => {
          set(v, true);
          s.commit();
        }}
      />
      <div className="cw-row">
        <Button onClick={() => s.setPivot(e.id, null)} disabled={!e.components[PIVOT]}>
          {t('pivot.middle')}
        </Button>
        <Button disabled={!wb} onClick={() => wb && s.setPivot(e.id, [(wb.min[0] + wb.max[0]) / 2, wb.min[1], (wb.min[2] + wb.max[2]) / 2])}>
          {t('pivot.bottom')}
        </Button>
        <Button variant={pivotEdit ? 'primary' : undefined} onClick={() => s.toggle('pivotEdit')} aria-pressed={pivotEdit}>
          {t('pivot.edit')} (O)
        </Button>
      </div>
      <p className="cw-hint">{t('pivot.hint')}</p>
    </Section>
  );
}
