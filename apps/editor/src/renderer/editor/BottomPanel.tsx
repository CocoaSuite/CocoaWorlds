/** Bottom workspace: the selected object's script (blocks), assets (prefabs), console and problems. */
import { Button, Icon } from '@cocoaworlds/ui';
import { ScriptPanel } from './script/ScriptPanel';
import { compileScript, type Problem, type Script } from '@cocoaworlds/scripting';
import { useEffect, useMemo, useRef } from 'react';
import { t } from '../i18n';
import { sceneInfo } from './script/scene-info';
import { useEditor } from '../store';
import { TextureSwatch } from './TextureSwatch';
import type { AssetKind } from '../../shared/api';

type Tab = 'console' | 'problems' | 'script' | 'assets';

export function BottomPanel() {
  const tab = useEditor((s) => s.bottomTab);
  const setTab = useEditor((s) => s.setBottomTab);
  const logs = useEditor((s) => s.logs);
  const problems = logs.filter((l) => l.level !== 'info');
  const scriptProblemCount = useScriptProblems().length;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: newer Chromium returns a Promise from scrollIntoView, which React would treat as a cleanup.
    end.current?.scrollIntoView({ block: 'end' });
  }, [logs.length, tab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'script', label: t('panel.script') },
    { id: 'assets', label: t('panel.assets') },
    { id: 'console', label: t('panel.console') },
    { id: 'problems', label: `${t('panel.problems')}${problems.length + scriptProblemCount ? ` ${problems.length + scriptProblemCount}` : ''}` },
  ];

  return (
    <section className={`cw-bottom${tab === 'script' ? ' tall' : ''}`} aria-label="Bottom panel">
      <div className="cw-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="cw-console cw-scroll" role="tabpanel">
        {tab === 'script' && <ScriptPanel />}
        {tab === 'assets' && <AssetsPanel />}
        {(tab === 'console' || tab === 'problems') && (
          <div role="log" aria-label={tab === 'console' ? t('panel.console') : t('panel.problems')} aria-live="polite">
            {(tab === 'console' ? logs : problems).map((l, i) => (
              <div key={i} className={`cw-log ${l.level}`}>
                <span className="cw-log-t">{l.at}</span>
                <span className="cw-log-s">{l.source}</span>
                {l.level !== 'info' && <span className={`cw-log-l ${l.level}`}>{l.level}</span>}
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'problems' && <ScriptProblems />}
        {tab === 'problems' && problems.length === 0 && !scriptProblemCount && <div className="cw-muted">{t('panel.noProblems')}</div>}
        <div ref={end} />
      </div>
    </section>
  );
}

/** Assets: the project's prefabs (Place), textures (click to paint with), sounds and models, with Import. */
function AssetsPanel() {
  const prefabs = useEditor((s) => s.prefabs);
  const assets = useEditor((s) => s.assets);
  const place = useEditor((s) => s.placePrefab);
  const st = useEditor.getState();
  const list = [...prefabs.values()].sort((a, b) => a.prefab.name.localeCompare(b.prefab.name));
  const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <div className="cw-assets-all">
      <section className="cw-assets-sec">
        <h3 className="cw-assets-h">{t('assets.prefabs')}</h3>
        <div className="cw-assets" role="list" aria-label={t('assets.prefabs')}>
          {!list.length && <div className="cw-muted">{t('assets.none')}</div>}
          {list.map(({ path, prefab }) => (
            <div key={prefab.id} className="cw-asset" role="listitem" aria-label={prefab.name}>
              <Icon name="cube" />
              <span className="cw-asset-name">{prefab.name}</span>
              <span className="cw-asset-meta mono">{path}</span>
              <span className="cw-asset-meta">{t('assets.objects').replace('{n}', String(prefab.entities.length))}</span>
              <Button size="sm" onClick={() => place(prefab.id)}>
                {t('assets.place')}
              </Button>
            </div>
          ))}
        </div>
      </section>
      <section className="cw-assets-sec">
        <h3 className="cw-assets-h">
          {t('assets.textures')}
          <ImportButton kind="textures" accept=".png,.jpg,.jpeg,.webp" />
        </h3>
        <div className="cw-tex-grid" role="list" aria-label={t('assets.textures')}>
          {!assets.textures.length && <div className="cw-muted">{t('assets.noTextures')}</div>}
          {assets.textures.map((tx) => (
            <button
              key={tx.path}
              type="button"
              role="listitem"
              className="cw-tex"
              aria-label={tx.name}
              title={`${tx.path} — ${t('assets.paintWith')}`}
              onClick={() => {
                st.setPaintMaterial(tx.path);
                st.setTool('paint');
              }}
            >
              <TextureSwatch path={tx.path} className="cw-tex-img" />
              <span className="cw-tex-name">{tx.name}</span>
            </button>
          ))}
        </div>
      </section>
      {(['sounds', 'models'] as const).map((kind) => (
        <section key={kind} className="cw-assets-sec">
          <h3 className="cw-assets-h">
            {t(kind === 'sounds' ? 'assets.sounds' : 'assets.models')}
            <ImportButton kind={kind} accept={kind === 'sounds' ? '.ogg,.mp3,.wav' : '.glb,.gltf'} />
          </h3>
          <div className="cw-assets" role="list" aria-label={t(kind === 'sounds' ? 'assets.sounds' : 'assets.models')}>
            {!assets[kind].length && <div className="cw-muted">{t('assets.noneYet')}</div>}
            {assets[kind].map((a) => (
              <div key={a.path} className="cw-asset" role="listitem" aria-label={a.name}>
                <Icon name={kind === 'sounds' ? 'sound' : 'cube'} />
                <span className="cw-asset-name">{a.name}</span>
                <span className="cw-asset-meta mono">{a.path}</span>
                <span className="cw-asset-meta">{kb(a.bytes)}</span>
                <span />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** “Import…”: the system file chooser; the files are copied into the project. */
function ImportButton({ kind, accept }: { kind: AssetKind; accept: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const label = t('assets.import').replace('{kind}', t(`assets.${kind}` as Parameters<typeof t>[0]).toLowerCase());
  return (
    <>
      <Button size="sm" onClick={() => ref.current?.click()} aria-label={label}>
        {t('assets.importShort')}
      </Button>
      <input
        ref={ref}
        type="file"
        multiple
        accept={accept}
        hidden
        data-testid={`import-${kind}`}
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length) void useEditor.getState().importAssets(kind, files);
        }}
      />
    </>
  );
}

/** Problems in every script of the scene, checked as you edit. */
function useScriptProblems(): Problem[] {
  const doc = useEditor((s) => s.doc);
  const rev = useEditor((s) => s.rev);
  const project = useEditor((s) => s.session?.project);
  return useMemo(() => {
    if (!doc) return [];
    const info = sceneInfo(doc, project);
    const out: Problem[] = [];
    for (const e of doc.entities) {
      const script = e.components.script as unknown as Script | undefined;
      if (script?.handlers) out.push(...compileScript(e.id, script, info).problems);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, rev, project]);
}

function ScriptProblems() {
  const list = useScriptProblems();
  const doc = useEditor((s) => s.doc);
  const st = useEditor.getState();
  if (!list.length) return null;
  return (
    <div role="list" aria-label={t('script.problems')}>
      {list.map((p, i) => (
        <button
          key={i}
          type="button"
          role="listitem"
          className={`cw-log cw-log-btn ${p.severity === 'error' ? 'error' : 'warn'}`}
          onClick={() => {
            st.select([p.owner]);
            st.setBottomTab('script');
          }}
        >
          <span className="cw-log-s">{doc?.get(p.owner)?.name ?? 'Script'}</span>
          <span className={`cw-log-l ${p.severity === 'error' ? 'error' : 'warn'}`}>{p.severity === 'error' ? 'error' : 'warn'}</span>
          <span>{p.message}</span>
        </button>
      ))}
    </div>
  );
}
