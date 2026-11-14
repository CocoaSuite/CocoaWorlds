/**
 * The dev console: ` while playing opens it over the top of the game. Lines typed run as commands
 * (runtime/dev.ts); ↑/↓ bring back earlier ones, Tab completes a command name, ` or Esc closes it.
 */
import { completeDevCommand } from '@cocoaworlds/runtime';
import { useEffect, useRef, useState } from 'react';

/** What was typed and printed, kept between openings (and Plays). */
const log: { text: string; input?: boolean }[] = [{ text: 'Dev console. Type help for the commands.' }];
const history: string[] = [];

export function DevConsole({ onRun, onClose }: { onRun: (line: string) => string[]; onClose: () => void }) {
  const [, redraw] = useState(0);
  const [line, setLine] = useState('');
  const back = useRef(history.length);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    list.current?.scrollTo(0, list.current.scrollHeight);
  });

  const run = () => {
    const t = line.trim();
    setLine('');
    if (!t) return;
    if (history[history.length - 1] !== t) history.push(t);
    back.current = history.length;
    log.push({ text: t, input: true });
    if (t === 'clear') log.length = 0;
    else for (const out of onRun(t)) log.push({ text: out });
    if (log.length > 400) log.splice(0, log.length - 400);
    redraw((n) => n + 1);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.code === 'Backquote') {
      e.preventDefault();
      return onClose();
    }
    if (e.key === 'Enter') return run();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      back.current = Math.max(0, Math.min(history.length, back.current + (e.key === 'ArrowUp' ? -1 : 1)));
      setLine(history[back.current] ?? '');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (line.includes(' ')) return;
      const all = completeDevCommand(line);
      if (all.length === 1) setLine(`${all[0]} `);
      else if (all.length > 1) {
        log.push({ text: all.join('  ') });
        redraw((n) => n + 1);
      }
    }
  };

  return (
    <div className="cw-ov cw-dev-console" data-testid="dev-console" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cw-dev-log" ref={list}>
        {log.map((l, i) => (
          <div key={i} className={l.input ? 'cw-dev-in' : undefined}>
            {l.input ? `] ${l.text}` : l.text}
          </div>
        ))}
      </div>
      <input
        ref={input}
        className="cw-dev-line"
        data-testid="dev-console-input"
        aria-label="Console command"
        spellCheck={false}
        autoComplete="off"
        value={line}
        onChange={(e) => setLine(e.target.value.replace(/`/g, ''))}
        onKeyDown={onKey}
        onKeyUp={(e) => e.stopPropagation()}
      />
    </div>
  );
}
