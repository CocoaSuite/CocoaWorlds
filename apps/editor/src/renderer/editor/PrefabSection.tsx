/** Inspector section for objects that belong to a prefab copy: what this copy changed, Revert, Apply, Unlink. */
import { diffPaths, linkOf, type EntityData } from '@cocoaworlds/core';
import { Button, Section } from '@cocoaworlds/ui';
import { getLang, t } from '../i18n';
import { copyRootOf, describePath } from '../prefabs';
import { useEditor } from '../store';

export function PrefabSection({ e }: { e: EntityData }) {
  const s = useEditor.getState();
  const doc = useEditor((x) => x.doc);
  const prefabs = useEditor((x) => x.prefabs);
  useEditor((x) => x.rev);
  const lang = getLang();
  const link = linkOf(e);
  if (!doc) return null;
  const root = copyRootOf(doc, e.id);
  if (!link || !root) {
    // Something added inside a copy (not part of the prefab).
    for (let p = e.parent ? doc.get(e.parent) : undefined; p; p = p.parent ? doc.get(p.parent) : undefined) {
      if (linkOf(p)) return <p className="cw-hint">{t('prefab.added')}</p>;
    }
    return null;
  }
  const entry = prefabs.get(link.prefab);
  const src = entry?.prefab.entities.find((x) => x.id === link.entity);
  const changes = src ? diffPaths(e, src, !!link.root) : [];
  return (
    <Section title={t('prefab.section')}>
      <div className="cw-prefab" data-testid="prefab-section">
        <p className="cw-prefab-name">{t('prefab.copyOf').replace('{name}', entry?.prefab.name ?? link.prefab)}</p>
        {!entry && <p className="cw-hint">{t('prefab.missing')}</p>}
        {src && !changes.length && <p className="cw-hint">{t('prefab.same')}</p>}
        {src && changes.length > 0 && (
          <>
            <p className="cw-hint">{t('prefab.changes')}</p>
            <ul className="cw-changes" aria-label={t('prefab.changes')}>
              {changes.map((p) => (
                <li key={p}>
                  <span className="cw-change-dot" />
                  <span className="cw-change-name">{describePath(p, lang)}</span>
                  <Button size="sm" onClick={() => s.revertChange(e.id, p)}>
                    {t('prefab.revert')}
                  </Button>
                  <Button size="sm" onClick={() => void s.applyChange(e.id, p)}>
                    {t('prefab.apply')}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="cw-row cw-wrap">
              <Button onClick={() => s.revertChange(e.id, null)}>{t('prefab.revertAll')}</Button>
              <Button onClick={() => void s.applyChange(e.id, null)}>{t('prefab.applyAll')}</Button>
            </div>
          </>
        )}
        <div className="cw-row cw-wrap">
          {root.id !== e.id && <Button onClick={() => s.select([root.id])}>{t('prefab.selectCopy')}</Button>}
          <Button onClick={() => s.unlinkCopy(e.id)}>{t('prefab.unlink')}</Button>
        </div>
      </div>
    </Section>
  );
}
