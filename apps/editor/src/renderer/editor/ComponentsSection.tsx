/**
 * The Inspector's components: one section per component with fields drawn from its definition, a remove
 * button, and an "Add component" menu listing only what fits this object.
 */
import { shown, stored, type AxisKind } from '../axes';
import type { Vec3 } from '@cocoaworlds/core';
import { TerrainImport } from './TerrainImport';
import { addableComponents, componentDef, readComponent, type EntityData, type FieldDef } from '@cocoaworlds/core';
import { Button, ColorField, IconButton, NumberField, Section, Segmented, Switch } from '@cocoaworlds/ui';
import { Fragment, useEffect, useRef, useState } from 'react';
import { modelSlots } from '../viewport/models';
import { getLang, t } from '../i18n';
import { useEditor } from '../store';

export function ComponentsSection({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  const lang = getLang();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const isBrush = !!e.components.brush;
  const shown = Object.keys(e.components).filter((n) => !componentDef(n)?.internal);
  const addable = addableComponents(e.components, isBrush);

  return (
    <>
      {shown.map((name) => {
        const def = componentDef(name);
        if (!def) return <UnknownComponent key={name} name={name} data={e.components[name]!} />;
        const data = readComponent(name, e.components[name]);
        return (
          <Section
            key={name}
            title={def.label[lang]}
            action={<IconButton icon="close" label={`${t('comp.remove')} ${def.label[lang]}`} className="cw-sec-btn" onClick={() => s.removeComponent(e.id, name)} />}
          >
            <div className="cw-comp-fields" role="group" aria-label={def.label[lang]}>
              {grouped(def.fields.filter((f) => !f.when || f.when.is.includes(data[f.when.key])), lang).map(([head, list]) => (
                <Fragment key={head || '-'}>
                  {head && <div className="cw-comp-group">{head}</div>}
                  {list.map((f) => (
                    <FieldEditor key={f.key} entity={e.id} component={name} field={f} value={data[f.key]} />
                  ))}
                </Fragment>
              ))}
              {!def.fields.length && <p className="cw-hint">{def.description[lang]}</p>}
              {name === 'model' && typeof data.model === 'string' && data.model && <ModelMaterials entity={e.id} path={data.model} value={(data.materials ?? {}) as Record<string, string>} />}
              {name === 'terrain' && typeof data.file === 'string' && data.file && <TerrainImport file={data.file} />}
              {name === 'script' && (
                <div className="cw-row">
                  <span className="cw-muted">{t('script.stacks').replace('{n}', String(((e.components.script as { handlers?: unknown[] }).handlers ?? []).length))}</span>
                  <span className="cw-sp" />
                  <Button onClick={() => s.setBottomTab('script')}>{t('script.edit')}</Button>
                </div>
              )}
            </div>
          </Section>
        );
      })}
      <div className="cw-row cw-add-comp">
        <Button
          disabled={!addable.length}
          onClick={(ev) => {
            const r = ev.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          {t('comp.add')}
        </Button>
        <Button onClick={() => s.openDialog('recipes')}>{t('recipe.open')}</Button>
      </div>
      {menu && <AddMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={addable.map((c) => ({ name: c.label[lang], about: c.description[lang], pick: () => s.addComponent(e.id, c.name) }))} />}
    </>
  );
}

/** Fields under their headings, each heading where its first field is. */
function grouped(fields: FieldDef[], lang: 'en' | 'ru'): [string, FieldDef[]][] {
  const out = new Map<string, FieldDef[]>();
  for (const f of fields) {
    const h = f.group?.[lang] ?? '';
    out.set(h, [...(out.get(h) ?? []), f]);
  }
  return [...out];
}

/** Add component: a menu with a search box (type to narrow it, Enter adds the first, Esc closes). */
function AddMenu({ x, y, items, onClose }: { x: number; y: number; items: { name: string; about: string; pick: () => void }[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (ev: PointerEvent) => !box.current?.contains(ev.target as Node) && onClose();
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.about.toLowerCase().includes(needle));
  const left = Math.max(8, Math.min(x, window.innerWidth - 372));
  const top = Math.min(y, window.innerHeight - 420);
  return (
    <div ref={box} className="cw-add-menu" style={{ left, top }}>
      <input
        className="cw-input"
        type="search"
        autoFocus
        placeholder={t('comp.search')}
        aria-label={t('comp.search')}
        value={q}
        onChange={(ev) => setQ(ev.currentTarget.value)}
        onKeyDown={(ev) => {
          ev.stopPropagation();
          if (ev.key === 'Escape') onClose();
          if (ev.key === 'Enter' && shown[0]) {
            shown[0].pick();
            onClose();
          }
        }}
      />
      <div role="menu" aria-label={t('comp.add')} className="cw-add-list">
        {shown.map((i) => (
          <button
            key={i.name}
            type="button"
            role="menuitem"
            aria-label={`${i.name} — ${i.about}`}
            onClick={() => {
              i.pick();
              onClose();
            }}
          >
            <strong>{i.name}</strong>
            <span>{i.about}</span>
          </button>
        ))}
        {!shown.length && <span className="cw-muted">{t('comp.none')}</span>}
      </div>
    </div>
  );
}

function FieldEditor({ entity, component, field, value }: { entity: string; component: string; field: FieldDef; value: unknown }) {
  const s = useEditor.getState();
  const assets = useEditor((st) => st.assets);
  const lang = getLang();
  const label = field.label[lang];
  const set = (v: unknown, live = false) => s.setComponentField(entity, component, field.key, v, live ? `${entity}-${component}-${field.key}` : undefined);
  const begin = () => s.begin(label);
  const done = () => s.commit();
  const ty = field.type;
  let input;
  if (ty.kind === 'number') {
    const clamp = (v: number) => Math.min(ty.max ?? Infinity, Math.max(ty.min ?? -Infinity, v));
    input = (
      <NumberField
        label={ty.unit ?? '#'}
        ariaLabel={label}
        value={Number(value)}
        step={ty.step ?? 1}
        onBegin={begin}
        onChange={(v) => set(clamp(v), true)}
        onCommit={(v) => {
          set(clamp(v), true);
          done();
        }}
      />
    );
  } else if (ty.kind === 'boolean') {
    input = <Switch label={label} checked={!!value} onChange={(v) => set(v)} />;
  } else if (ty.kind === 'effect') {
    input = <EffectSelect label={label} value={String(value ?? '')} onChange={(v) => set(v)} />;
  } else if (ty.kind === 'plant') {
    input = <PlantSelect label={label} value={String(value ?? '')} onChange={(v) => set(v)} />;
  } else if (ty.kind === 'material') {
    input = <MaterialSelect label={label} value={String(value ?? '')} onChange={(v) => set(v)} />;
  } else if (ty.kind === 'enum') {
    const options = ty.options.map((o) => ({ value: o.value, label: o.label[lang] }));
    // Short choices fit as segmented buttons; longer ones become a dropdown so the Inspector never overflows.
    const fits = options.reduce((n, o) => n + o.label.length, 0) <= 14;
    input = fits ? (
      <Segmented<string> label={label} value={String(value)} onChange={(v) => set(v)} options={options} />
    ) : (
      <select className="cw-input cw-select" aria-label={label} value={String(value)} onChange={(ev) => set(ev.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (ty.kind === 'color') {
    input = <ColorField label={label} value={String(value)} onChange={(v) => set(v, true)} />;
  } else if (ty.kind === 'vec3') {
    const raw = (Array.isArray(value) ? value : [0, 0, 0]) as Vec3;
    const min = ty.min ?? -Infinity;
    // (Shown Z-up when set; kept Y-up. A field with a lower limit is a size: its axes swap without a sign.)
    const kind: AxisKind = ty.min !== undefined && ty.min >= 0 ? 'size' : 'point';
    const zUp = useEditor.getState().zUp;
    const v = shown(raw, kind, zUp) as number[];
    const set3 = (n: number[], live: boolean) => set(stored(n as Vec3, kind, zUp), live);
    return (
      <>
        <div className="cw-f3">
          <span>{label}</span>
          {(['x', 'y', 'z'] as const).map((a, i) => (
            <NumberField
              key={a}
              axis={a}
              label={a.toUpperCase()}
              ariaLabel={`${label} ${a.toUpperCase()}`}
              value={v[i]!}
              step={ty.step ?? 1}
              onBegin={begin}
              onChange={(n) => set3(v.map((x, j) => (j === i ? Math.max(min, n) : x)), true)}
              onCommit={(n) => {
                set3(v.map((x, j) => (j === i ? Math.max(min, n) : x)), true);
                done();
              }}
            />
          ))}
        </div>
        {field.hint && <p className="cw-hint">{field.hint[lang]}</p>}
      </>
    );
  } else if (ty.kind === 'asset') {
    const list = assets[ty.asset];
    const v = String(value ?? '');
    input = (
      <select className="cw-input cw-select" aria-label={label} value={v} onChange={(ev) => set(ev.target.value)}>
        <option value="">{t('assets.pick')}</option>
        {v && !list.some((a) => a.path === v) && <option value={v}>{v} ?</option>}
        {list.map((a) => (
          <option key={a.path} value={a.path}>
            {a.name}
          </option>
        ))}
      </select>
    );
  } else if (ty.kind === 'scene') {
    const v = String(value ?? '');
    const names = (useEditor.getState().session?.project.scenes ?? []).map((p) => p.split('/').pop()!.replace(/\.cwscene$/, ''));
    input = (
      <select className="cw-input cw-select" aria-label={label} value={v} onChange={(ev) => set(ev.target.value)}>
        <option value="">{t('insp.noObject')}</option>
        {v && !names.includes(v) && <option value={v}>{v} ?</option>}
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    );
  } else if (ty.kind === 'object') {
    const v = String(value ?? '');
    const doc = useEditor.getState().doc;
    const list = (doc?.entities ?? []).filter((x) => !ty.component || x.components[ty.component] !== undefined);
    input = (
      <select className="cw-input cw-select" aria-label={label} value={v} onChange={(ev) => set(ev.target.value)}>
        <option value="">{t('insp.noObject')}</option>
        {v && !list.some((x) => x.id === v) && <option value={v}>{t('insp.missingObject')}</option>}
        {list.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    );
  } else {
    input = (
      <input
        className="cw-input"
        aria-label={label}
        defaultValue={String(value ?? '')}
        key={String(value ?? '')}
        onKeyDown={(ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') ev.currentTarget.blur();
        }}
        onBlur={(ev) => set(ev.currentTarget.value)}
      />
    );
  }
  return (
    <>
      <div className="cw-f">
        <span>{label}</span>
        {input}
      </div>
      {field.hint && <p className="cw-hint">{field.hint[lang]}</p>}
    </>
  );
}

/** Data the editor has no definition for (from a newer version or a hand edit): shown read-only. */
function UnknownComponent({ name, data }: { name: string; data: Record<string, unknown> }) {
  return (
    <Section title={name}>
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="cw-f">
          <span>{k}</span>
          <code>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</code>
        </div>
      ))}
    </Section>
  );
}

/**
 * A model's material slots, each painted with the file's own material or a project material (the parts of a
 * chicken: feathers, beak, comb …). The Paint tool can do the same by clicking a part of the model.
 */
function ModelMaterials({ entity, path, value }: { entity: string; path: string; value: Record<string, string> }) {
  const [slots, setSlots] = useState<string[] | null>(null);
  const materials = useEditor((st) => st.session?.project.settings.materials) ?? [];
  useEffect(() => {
    let live = true;
    setSlots(null);
    modelSlots(path).then(
      (x) => live && setSlots(x),
      () => live && setSlots([]),
    );
    return () => {
      live = false;
    };
  }, [path]);
  if (!slots?.length) return null;
  const set = (slot: string, id: string) => {
    const next = { ...value };
    if (id) next[slot] = id;
    else delete next[slot];
    useEditor.getState().setComponentField(entity, 'model', 'materials', Object.keys(next).length ? next : undefined);
  };
  return (
    <div className="cw-model-mats" role="group" aria-label={t('model.materials')}>
      <div className="cw-model-mats-h">{t('model.materials')}</div>
      {slots.map((slot) => {
        const v = value[slot] ?? '';
        return (
          <div className="cw-f" key={slot}>
            <span title={slot}>{slot}</span>
            <select className="cw-input cw-select" aria-label={`${t('model.material')} ${slot}`} value={v} onChange={(ev) => set(slot, ev.target.value)}>
              <option value="">{t('model.asInFile')}</option>
              {v && !materials.some((m) => m.id === v) && <option value={v}>{t('model.missing')}</option>}
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <p className="cw-hint">{materials.length ? t('model.materialsHint') : t('model.noMaterials')}</p>
    </div>
  );
}

/** A project material or texture, or none: a compact dropdown (the full picker is in the Paint tool). */
export function MaterialSelect({ label, value, onChange, none }: { label: string; value: string; onChange: (v: string) => void; none?: string }) {
  const materials = useEditor((s) => s.session?.project.settings.materials) ?? [];
  const textures = useEditor((s) => s.assets.textures);
  return (
    <select className="cw-input cw-select" aria-label={label} value={value} onChange={(ev) => onChange(ev.target.value)}>
      <option value="">{none ?? t('field.none')}</option>
      {materials.length > 0 && (
        <optgroup label={t('assets.materials')}>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      )}
      {textures.length > 0 && (
        <optgroup label={t('assets.textures')}>
          {textures.map((x) => (
            <option key={x.path} value={x.path}>
              {x.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/** A project effect (VFX workspace), or none. */
function EffectSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const effects = useEditor((s) => s.session?.project.settings.effects) ?? [];
  return (
    <span className="cw-row-pick">
      <select className="cw-input cw-select" aria-label={label} value={value} onChange={(ev) => onChange(ev.target.value)}>
        <option value="">{t('field.none')}</option>
        {effects.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={() => useEditor.getState().setWorkspace('vfx')}>
        {getLang() === 'ru' ? 'Изменить' : 'Edit'}
      </Button>
    </span>
  );
}

/** A project plant, or none. */
function PlantSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const plants = useEditor((s) => s.session?.project.settings.plants) ?? [];
  return (
    <select className="cw-input cw-select" aria-label={label} value={value} onChange={(ev) => onChange(ev.target.value)}>
      <option value="">{t('field.none')}</option>
      {plants.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

