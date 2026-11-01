/** Inspector for the selection (CocoaCanvas right panel). Scene settings when nothing is selected. */
import { PIVOT, gameRules, pivotOf, worldBoundsOf, type EntityData, type Transform, type Vec3 } from '@cocoaworlds/core';
import { brushBounds } from '../brush/brushes';
import { Button, Field, NumberField, PanelHeader, Section, Switch } from '@cocoaworlds/ui';
import { t } from '../i18n';
import { BrushInspector, MultiBrushActions } from './BrushInspector';
import { FaceInspector } from './FaceInspector';
import { ComponentsSection } from './ComponentsSection';
import { PrefabSection } from './PrefabSection';
import { isGroup } from '../scene-ops';
import { useSelectedEntities, useEditor } from '../store';

export function Inspector() {
  useEditor((s) => s.rev);
  const sel = useSelectedEntities();
  const faceTool = useEditor((s) => s.tool === 'face');
  const kind = sel.length === 1 ? componentLabel(sel[0]!) : sel.length > 1 ? `${sel.length}` : '';
  return (
    <aside className="cw-side cw-right" aria-label={t('insp.title')}>
      <PanelHeader title={t('insp.title')}>{kind && <span className="cw-ph-note">{kind}</span>}</PanelHeader>
      <div className="cw-insp cw-scroll">
        {faceTool && <FaceInspector />}
        {!faceTool && sel.length === 0 && <SceneSettings />}
        {!faceTool && sel.length === 1 && (sel[0]!.components.brush ? <BrushEntity e={sel[0]!} /> : isGroupEntity(sel[0]!) ? <GroupEntity e={sel[0]!} /> : <EntityInspector e={sel[0]!} />)}
        {!faceTool && sel.length > 1 && (
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
      </Section>
    </>
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
  if (isGroupEntity(e)) return t('insp.group');
  return 'Object';
}

function SceneSettings() {
  const doc = useEditor((s) => s.doc)!;
  return (
    <>
      <p className="cw-empty" style={{ padding: 0 }}>
        {t('insp.nothing')}
      </p>
      <Section title={t('insp.sceneSettings')}>
        <Field label={t('insp.name')}>
          <span>{doc.name}</span>
        </Field>
        <Field label={t('insp.ambient')}>
          <span className="cw-swatch-row">
            <span className="cw-swatch" style={{ background: doc.settings.ambientColor }} />
            <code>{doc.settings.ambientColor}</code>
          </span>
        </Field>
        <Field label={t('insp.background')}>
          <span className="cw-swatch-row">
            <span className="cw-swatch" style={{ background: doc.settings.backgroundColor }} />
            <code>{doc.settings.backgroundColor}</code>
          </span>
        </Field>
        <Field label={t('insp.gravity')}>
          <code>{doc.settings.gravity} u/s²</code>
        </Field>
      </Section>
      <GameRulesSection />
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
    <Section title={t('insp.gameRules')}>
      <p className="cw-hint">{t('insp.gameRulesHint')}</p>
      <Field label={t('insp.health')}>
        <Switch checked={rules.health} label={t('insp.health')} onChange={(on) => !playing && void set('health', on)} />
      </Field>
      <Field label={t('insp.score')}>
        <Switch checked={rules.score} label={t('insp.score')} onChange={(on) => !playing && void set('score', on)} />
      </Field>
    </Section>
  );
}

function Vec3Row({ label, value, step, onCommit, onLive, onBegin, name }: { label: string; name: string; value: Vec3; step: number; onBegin: () => void; onLive: (v: Vec3) => void; onCommit: (v: Vec3) => void }) {
  const axes = ['x', 'y', 'z'] as const;
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
      <Vec3Row label={t('insp.position')} name="Position" value={tr.position} step={grid} onBegin={begin} onLive={(v) => setPart('position', v, true)} onCommit={end('position')} />
      <Vec3Row label={t('insp.rotation')} name="Rotation" value={tr.rotation} step={1} onBegin={begin} onLive={(v) => setPart('rotation', v, true)} onCommit={end('rotation')} />
      <Vec3Row label={t('insp.scale')} name="Scale" value={tr.scale} step={0.05} onBegin={begin} onLive={(v) => setPart('scale', v, true)} onCommit={end('scale')} />
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
