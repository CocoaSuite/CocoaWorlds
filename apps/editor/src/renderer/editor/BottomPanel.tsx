/** Bottom workspace: the selected object's script (blocks), assets (prefabs), console and problems. */
import { ScriptPanel } from './script/ScriptPanel';
import { compileScript, type Problem, type Script } from '@cocoaworlds/scripting';
import { useEffect, useMemo, useRef } from 'react';
import { t } from '../i18n';
import { sceneInfo } from './script/scene-info';
import { useEditor } from '../store';
import { AssetLibrary } from './AssetLibrary';

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
    <section className={`cw-bottom${tab === 'script' ? ' tall' : tab === 'assets' ? ' lib' : ''}`} aria-label="Bottom panel">
      <div className="cw-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className={`cw-console cw-scroll${tab === 'assets' ? ' lib' : ''}`} role="tabpanel">
        {tab === 'script' && <ScriptPanel />}
        {tab === 'assets' && <AssetLibrary />}
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
