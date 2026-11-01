/** Bottom workspace: console now; script, assets and diagnostics panels arrive in later phases. */
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useEditor } from '../store';

type Tab = 'console' | 'problems' | 'script' | 'assets';

export function BottomPanel() {
  const [tab, setTab] = useState<Tab>('console');
  const logs = useEditor((s) => s.logs);
  const problems = logs.filter((l) => l.level !== 'info');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: newer Chromium returns a Promise from scrollIntoView, which React would treat as a cleanup.
    end.current?.scrollIntoView({ block: 'end' });
  }, [logs.length, tab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'script', label: t('panel.script') },
    { id: 'assets', label: t('panel.assets') },
    { id: 'console', label: t('panel.console') },
    { id: 'problems', label: `${t('panel.problems')}${problems.length ? ` ${problems.length}` : ''}` },
  ];

  return (
    <section className="cw-bottom" aria-label="Bottom panel">
      <div className="cw-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="cw-console cw-scroll" role="tabpanel">
        {(tab === 'script' || tab === 'assets') && <div className="cw-muted">{t('panel.notYet')}</div>}
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
        {tab === 'problems' && problems.length === 0 && <div className="cw-muted">{t('panel.noProblems')}</div>}
        <div ref={end} />
      </div>
    </section>
  );
}
