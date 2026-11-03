/**
 * The Inspector's components: one section per component with fields drawn from its definition, a remove
 * button, and an "Add component" menu listing only what fits this object.
 */
import { TerrainImport } from './TerrainImport';
import { addableComponents, componentDef, readComponent, type EntityData, type FieldDef } from '@cocoaworlds/core';
import { Button, ColorField, ContextMenu, IconButton, NumberField, Section, Segmented, Switch } from '@cocoaworlds/ui';
import { useEffect, useState } from 'react';
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
              {def.fields
                .filter((f) => !f.when || f.when.is.includes(data[f.when.key]))
                .map((f) => (
                  <FieldEditor key={f.key} entity={e.id} component={name} field={f} value={data[f.key]} />
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={addable.map((c) => ({ label: `${c.label[lang]} — ${c.description[lang]}`, onSelect: () => s.addComponent(e.id, c.name) }))}
        />
      )}
    </>
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
    const v = (Array.isArray(value) ? value : [0, 0, 0]) as number[];
    const min = ty.min ?? -Infinity;
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
              onChange={(n) => set(v.map((x, j) => (j === i ? Math.max(min, n) : x)), true)}
              onCommit={(n) => {
                set(v.map((x, j) => (j === i ? Math.max(min, n) : x)), true);
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
function MaterialSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const materials = useEditor((s) => s.session?.project.settings.materials) ?? [];
  const textures = useEditor((s) => s.assets.textures);
  return (
    <select className="cw-input cw-select" aria-label={label} value={value} onChange={(ev) => onChange(ev.target.value)}>
      <option value="">{t('field.none')}</option>
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

