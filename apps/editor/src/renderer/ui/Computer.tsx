/**
 * The in-game computer's screen, shown over the game view while the player is at a Computer: a desktop with a
 * changeable picture, Notes, Pictures (not available yet), a Shop (objects with a Shop item component; Buy prints a
 * copy on the 3D printer) and Display settings. What it keeps (notes, picture, theme) is saved with the game.
 */
import type { ComputerView } from '@cocoaworlds/runtime';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { assetUrl } from '../assets';
import islandJpg from '../assets/computer/island.jpg';
import sunsetJpg from '../assets/computer/sunset.jpg';
import winterJpg from '../assets/computer/winter.jpg';

/** What draws the screen talks to (the editor's engine in Play, the runner in an exported game). */
export interface ComputerHost {
  computerAction(action: string, arg?: string): string;
  computerState(id: string): Record<string, unknown> | null;
  setComputerState(id: string, state: Record<string, unknown>): void;
  /** A shop item drawn as the game shows it ('' : nothing to draw). */
  shopPreview(id: string): Promise<string>;
}

type App = 'notes' | 'pictures' | 'shop' | 'display';

interface Note {
  name: string;
  text: string;
}

/** What a computer keeps between visits. */
interface Kept {
  notes: Note[];
  /** A built-in picture's id, or 'custom'. */
  wallpaper: string;
  /** The player's own picture (a data URL; '' : none). */
  custom: string;
  theme: 'dark' | 'light';
  crt: boolean;
}

/** Desktop pictures that come with the computer. */
const WALLPAPERS = [
  { id: 'island', name: 'Island', url: islandJpg },
  { id: 'sunset', name: 'Sunset beach', url: sunsetJpg },
  { id: 'winter', name: 'Winter canal', url: winterJpg },
];

/** The apps: their window's title, size and where it first opens. (Icons: placeholders in `AppIcon` below.) */
const APPS: Record<App, { name: string; w: number; h: number; x: number; y: number }> = {
  notes: { name: 'Notes', w: 390, h: 360, x: 150, y: 36 },
  pictures: { name: 'Pictures', w: 444, h: 124, x: 800, y: 612 },
  shop: { name: 'Shop', w: 672, h: 560, x: 572, y: 36 },
  display: { name: 'Display', w: 390, h: 336, x: 150, y: 416 },
};
const APP_ORDER: App[] = ['notes', 'pictures', 'shop', 'display'];

function keptOf(raw: Record<string, unknown> | null): Kept {
  const notes = Array.isArray(raw?.notes) ? raw.notes.filter((n): n is Note => !!n && typeof n.name === 'string' && typeof n.text === 'string') : [];
  return {
    notes: notes.length ? notes : [{ name: 'note-1.txt', text: '' }],
    wallpaper: typeof raw?.wallpaper === 'string' ? raw.wallpaper : 'island',
    custom: typeof raw?.custom === 'string' ? raw.custom : '',
    theme: raw?.theme === 'light' ? 'light' : 'dark',
    crt: raw?.crt !== false,
  };
}

const two = (n: number) => String(n).padStart(2, '0');

/** A project image as a URL ('' until loaded, or with no path). */
function useAsset(path: string): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    setUrl('');
    if (path) assetUrl(path).then((u) => live && setUrl(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

/** Placeholder app icons (to be replaced with drawn ones). */
function AppIcon({ app }: { app: App }) {
  const c = '#f2f2f2';
  return (
    <svg aria-hidden="true" width="30" height="30" viewBox="0 0 30 30">
      {app === 'notes' && <><rect x="6" y="3" width="18" height="24" rx="2" fill={c} /><path d="M10 10h10M10 15h10M10 20h6" stroke="#444" strokeWidth="2" /></>}
      {app === 'pictures' && <><rect x="8" y="14" width="14" height="11" rx="2" fill={c} /><path d="M11 14v-4a4 4 0 0 1 8 0v4" fill="none" stroke={c} strokeWidth="2.5" /></>}
      {app === 'shop' && <><path d="M5 10h20l-3 16H8z" fill={c} /><path d="M10 10V8a5 5 0 0 1 10 0v2" fill="none" stroke={c} strokeWidth="2.5" /></>}
      {app === 'display' && <><rect x="3" y="5" width="24" height="16" rx="2" fill={c} /><rect x="12" y="21" width="6" height="3" fill={c} /><rect x="8" y="24" width="14" height="2.5" fill={c} /></>}
    </svg>
  );
}

/** A shop card: the item drawn as the game shows it (or its own picture, if it has one), name, price and Buy. */
function ShopCard({ item, view, host, onBuy }: { item: ComputerView['items'][number]; view: ComputerView; host: ComputerHost; onBuy: () => void }) {
  const picture = useAsset(item.picture);
  const [render, setRender] = useState('');
  useEffect(() => {
    let live = true;
    if (!item.picture) host.shopPreview(item.id).then((u) => live && setRender(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [item.id, item.picture, host]);
  const url = item.picture ? picture : render;
  const printing = view.printing === item.id;
  const poor = view.money !== null && view.money < item.price;
  return (
    <div className="cw-pc-card" data-testid="pc-shop-item">
      <div className="cw-pc-well cw-pc-pic">
        {url ? (
          <img src={url} alt="" draggable={false} />
        ) : (
          <svg aria-hidden="true" width="80" height="80" viewBox="0 0 80 80">
            <polygon points="40,10 68,24 68,56 40,70 12,56 12,24" fill="#d8d8d8" />
            <path d="M12 24l28 14 28-14M40 38v32" stroke="#14161a" strokeWidth="3" fill="none" />
          </svg>
        )}
      </div>
      <b>{item.name}</b>
      <div className="cw-pc-row">
        <span>{item.price > 0 ? `${item.price} cr` : 'Free'}</span>
        {printing ? (
          <span className="cw-pc-muted">Printing… {view.done}%</span>
        ) : (
          <button type="button" className="cw-pc-btn" disabled={view.printer !== 'ready' || poor} onClick={onBuy}>
            Buy
          </button>
        )}
      </div>
    </div>
  );
}

const PRINTER_TEXT: Record<ComputerView['printer'], string> = { none: 'No 3D printer', ready: '3D printer: ready', printing: '3D printer: printing', blocked: '3D printer: take the print out' };
const BUY_TEXT: Record<string, string> = { poor: 'Not enough credits', busy: 'The printer is busy', none: 'No 3D printer' };

export function ComputerScreen({ view, host }: { view: ComputerView; host: ComputerHost }) {
  const [kept, setKept] = useState(() => keptOf(host.computerState(view.id)));
  const keep = (patch: Partial<Kept>) => {
    const next = { ...kept, ...patch };
    setKept(next);
    host.setComputerState(view.id, next as unknown as Record<string, unknown>);
  };
  const screen = useRef<HTMLDivElement>(null);
  /** Open windows, back to front (the last one is in front). */
  const [wins, setWins] = useState<{ app: App; x: number; y: number }[]>([]);
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState(0);
  const [said, setSaid] = useState('');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(''), 2500);
    return () => clearTimeout(timer);
  }, [said]);

  const fit = (app: App, x: number, y: number) => {
    const el = screen.current;
    const a = APPS[app];
    return { app, x: Math.max(0, Math.min(x, (el?.clientWidth ?? 1280) - a.w)), y: Math.max(0, Math.min(y, (el?.clientHeight ?? 800) - 46 - a.h)) };
  };
  const open = (app: App) => {
    setMenu(false);
    setWins((w) => [...w.filter((x) => x.app !== app), w.find((x) => x.app === app) ?? fit(app, APPS[app].x, APPS[app].y)]);
  };
  const close = (app: App) => setWins((w) => w.filter((x) => x.app !== app));
  const front = wins[wins.length - 1]?.app;

  /** Dragging a window by its title bar. */
  const drag = useRef<{ app: App; dx: number; dy: number } | null>(null);
  const grab = (e: PointerEvent, app: App) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const w = wins.find((x) => x.app === app);
    if (!w) return;
    open(app);
    drag.current = { app, dx: e.clientX - w.x, dy: e.clientY - w.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (d) setWins((w) => w.map((x) => (x.app === d.app ? fit(d.app, e.clientX - d.dx, e.clientY - d.dy) : x)));
  };
  const drop = () => void (drag.current = null);

  const wallpaper = kept.wallpaper === 'custom' && kept.custom ? kept.custom : (WALLPAPERS.find((w) => w.id === kept.wallpaper) ?? WALLPAPERS[0]!).url;

  /** The player's own picture, made small enough to keep in a save. */
  const loadPicture = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      keep({ custom: canvas.toDataURL('image/jpeg', 0.8), wallpaper: 'custom' });
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const buy = (id: string) => {
    const r = host.computerAction('buy', id);
    setSaid(BUY_TEXT[r] ?? '');
  };

  const current = kept.notes[Math.min(note, kept.notes.length - 1)]!;
  const noteAt = Math.min(note, kept.notes.length - 1);
  const newNote = () => {
    let n = kept.notes.length + 1;
    while (kept.notes.some((x) => x.name === `note-${n}.txt`)) n++;
    keep({ notes: [...kept.notes, { name: `note-${n}.txt`, text: '' }] });
    setNote(kept.notes.length);
  };
  const deleteNote = () => {
    const notes = kept.notes.filter((_, i) => i !== noteAt);
    keep({ notes: notes.length ? notes : [{ name: 'note-1.txt', text: '' }] });
    setNote(Math.max(0, noteAt - 1));
  };

  const body: Record<App, () => ReactNode> = {
    notes: () => (
      <>
        <div className="cw-pc-notes">
          <div className="cw-pc-well cw-pc-files">
            {kept.notes.map((n, i) => (
              <button key={n.name} type="button" className={`cw-pc-btn ${i === noteAt ? 'on' : 'flat'}`} style={{ textAlign: 'left', padding: '6px 8px' }} onClick={() => setNote(i)}>
                {n.name}
              </button>
            ))}
          </div>
          <textarea
            className="cw-pc-well"
            aria-label="Note text"
            data-testid="pc-note"
            spellCheck={false}
            value={current.text}
            onChange={(e) => keep({ notes: kept.notes.map((n, i) => (i === noteAt ? { ...n, text: e.target.value } : n)) })}
          />
        </div>
        <div className="cw-pc-row" style={{ padding: '0 8px 10px' }}>
          <button type="button" className="cw-pc-btn" onClick={newNote}>+ New</button>
          <button type="button" className="cw-pc-btn" onClick={deleteNote}>Delete</button>
        </div>
      </>
    ),
    pictures: () => (
      <div className="cw-pc-row" style={{ gap: 14, padding: '14px 16px' }}>
        <svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44">
          <polygon points="22,4 42,40 2,40" fill="#9b9b9b" />
          <rect x="20" y="16" width="4" height="12" fill="#14161a" />
          <rect x="20" y="31" width="4" height="4" fill="#14161a" />
        </svg>
        <span style={{ flex: 1 }}>Pictures is UNAVAILABLE.<br />Check back later.</span>
        <button type="button" className="cw-pc-btn" onClick={() => close('pictures')}>OK</button>
      </div>
    ),
    shop: () => (
      <>
        <div className="cw-pc-row" style={{ gap: 16, padding: '12px 14px' }}>
          {view.money !== null && <span>Credits: <b>{view.money}</b></span>}
          <span className="cw-pc-muted" style={{ marginLeft: 'auto' }} role="status">
            {said || (view.printer === 'printing' ? `3D printer: printing ${view.done}%` : PRINTER_TEXT[view.printer])}
          </span>
        </div>
        <div className="cw-pc-shop">
          {view.items.map((item) => <ShopCard key={item.id} item={item} view={view} host={host} onBuy={() => buy(item.id)} />)}
          {view.items.length === 0 && <span className="cw-pc-muted">Nothing for sale yet.</span>}
        </div>
      </>
    ),
    display: () => (
      <div className="cw-pc-pad">
        <span>Desktop image</span>
        <div className="cw-pc-papers">
          {WALLPAPERS.map((w) => (
            <button key={w.id} type="button" aria-label={w.name} className={kept.wallpaper === w.id ? 'on' : ''} style={{ backgroundImage: `url(${w.url})` }} onClick={() => keep({ wallpaper: w.id })} />
          ))}
          {kept.custom && <button type="button" aria-label="Your image" className={kept.wallpaper === 'custom' ? 'on' : ''} style={{ backgroundImage: `url(${kept.custom})` }} onClick={() => keep({ wallpaper: 'custom' })} />}
        </div>
        <label className="cw-pc-btn" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
          Load image...
          <input type="file" accept="image/*" hidden onChange={(e) => { loadPicture(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <div className="cw-pc-row">
          <span style={{ width: 86 }}>Theme</span>
          <button type="button" className={`cw-pc-btn ${kept.theme === 'dark' ? 'on' : ''}`} onClick={() => keep({ theme: 'dark' })}>Dark</button>
          <button type="button" className={`cw-pc-btn ${kept.theme === 'light' ? 'on' : ''}`} onClick={() => keep({ theme: 'light' })}>Light</button>
        </div>
        <div className="cw-pc-row">
          <span style={{ width: 86 }}>CRT filter</span>
          <button type="button" className={`cw-pc-btn ${kept.crt ? 'on' : ''}`} onClick={() => keep({ crt: true })}>On</button>
          <button type="button" className={`cw-pc-btn ${kept.crt ? '' : 'on'}`} onClick={() => keep({ crt: false })}>Off</button>
        </div>
      </div>
    ),
  };

  return (
    <div ref={screen} className={`cw-pc ${kept.crt ? 'cw-pc-crt' : ''}`} data-theme={kept.theme} data-testid="computer" style={{ backgroundImage: `url(${wallpaper})` }} onMouseDown={() => menu && setMenu(false)}>
      <div className="cw-pc-icons">
        {APP_ORDER.map((app) => (
          <button key={app} type="button" className={`cw-pc-icon ${app === 'pictures' ? 'off' : ''}`} data-testid={`pc-open-${app}`} onClick={() => open(app)}>
            <i><AppIcon app={app} /></i>
            {APPS[app].name}
          </button>
        ))}
      </div>

      {wins.map((w, i) => (
        <div key={w.app} className={`cw-pc-win ${w.app === front ? 'on' : ''}`} style={{ left: w.x, top: w.y, width: APPS[w.app].w, height: APPS[w.app].h, zIndex: 10 + i }} onMouseDown={() => w.app !== front && open(w.app)} data-testid={`pc-win-${w.app}`}>
          <div className="cw-pc-bar" onPointerDown={(e) => grab(e, w.app)} onPointerMove={move} onPointerUp={drop} onPointerCancel={drop}>
            <span>{APPS[w.app].name}</span>
            <button type="button" className="cw-pc-btn cw-pc-x" aria-label={`Close ${APPS[w.app].name}`} onClick={() => close(w.app)}>x</button>
          </div>
          {body[w.app]()}
        </div>
      ))}

      {menu && (
        <div className="cw-pc-menu" style={{ zIndex: 60 }} onMouseDown={(e) => e.stopPropagation()}>
          {APP_ORDER.map((app) => (
            <button key={app} type="button" className="cw-pc-btn flat" onClick={() => open(app)}>{APPS[app].name}</button>
          ))}
          <button type="button" className="cw-pc-btn flat" onClick={() => host.computerAction('exit')}>Exit</button>
        </div>
      )}

      <div className="cw-pc-task" style={{ zIndex: 50 }}>
        <button type="button" className="cw-pc-btn cw-pc-start on" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu(!menu)}>Start</button>
        {wins.slice().sort((a, b) => APP_ORDER.indexOf(a.app) - APP_ORDER.indexOf(b.app)).map((w) => (
          <button key={w.app} type="button" className={`cw-pc-btn ${w.app === front ? 'on' : ''}`} onClick={() => open(w.app)}>{APPS[w.app].name}</button>
        ))}
        <span className="cw-pc-muted" style={{ marginLeft: 'auto' }}>{view.printer === 'printing' ? 'Printer: busy' : ''}</span>
        <span style={{ padding: '4px 10px' }}>{view.minute !== null ? `${two(Math.floor(view.minute / 60) % 24)}:${two(view.minute % 60)}` : `${two(now.getHours())}:${two(now.getMinutes())}`}</span>
        <button type="button" className="cw-pc-btn" style={{ minWidth: 0 }} data-testid="pc-exit" onClick={() => host.computerAction('exit')}>Exit</button>
      </div>
    </div>
  );
}
