/**
 * The Inspector's components: one section per component with fields drawn from its definition, a remove
 * button, and an "Add component" menu listing only what fits this object.
 */
import { addableComponents, componentDef, readComponent, type EntityData, type FieldDef } from '@cocoaworlds/core';
import { Button, ColorField, ContextMenu, IconButton, NumberField, Section, Segmented, Switch } from '@cocoaworlds/ui';
import { useState } from 'react';
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
