/** Mining: money, backpack, where you are and the reset timer in the corner; the Home button; the upgrade menu. */
import type { ForestHud, ForestMenu, MineHud, MineMenu } from '@cocoaworlds/runtime';
import { useLayoutEffect, useRef, useState } from 'react';
import { blockIcons, oreIcons } from '../viewport/mine-view';

/** 1234 → "1,234"; big ones shortened (12.3K, 4.5M…). */
export function money(n: number): string {
  if (n < 100000) return Math.floor(n).toLocaleString('en-US');
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return `${n < 100 ? n.toFixed(1) : Math.floor(n)}${units[u]}`;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const CELL = 70;

function Tree({ menu, onBuy }: { menu: MineMenu; onBuy: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const xs = menu.skills.map((s) => s.at[0]), ys = menu.skills.map((s) => s.at[1]);
  const minX = Math.min(0, ...xs) - 1, maxX = Math.max(0, ...xs) + 1, minY = Math.min(0, ...ys) - 1, maxY = Math.max(0, ...ys) + 1;
  const W = (maxX - minX) * CELL, H = (maxY - minY) * CELL;
  const px = (x: number) => (x - minX) * CELL, py = (y: number) => (y - minY) * CELL;
  const byId = new Map(menu.skills.map((s) => [s.id, s]));
  const color = new Map(menu.branches.map((b) => [b.id, b.color]));
  const shown = hover ? byId.get(hover) : null;
  // (The whole tree fits the space it has.)
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 20) / W, (el.clientHeight - 20) / H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);
  return (
    <div className="cw-mine-tree">
      <div className="cw-mine-tree-fit" ref={box}>
        <div style={{ position: 'relative', width: W, height: H, transform: `scale(${scale})`, flex: 'none' }}>
          <svg width={W} height={H} className="cw-mine-links">
            {menu.skills.flatMap((s) =>
              s.needs.map((n) => {
                const f = byId.get(n);
                if (!f) return null;
                return <line key={`${n}-${s.id}`} x1={px(f.at[0])} y1={py(f.at[1])} x2={px(s.at[0])} y2={py(s.at[1])} stroke={f.level > 0 ? color.get(s.branch) : '#3a3d44'} strokeWidth={3} />;
              }),
            )}
            {menu.skills
              .filter((s) => !s.needs.length)
              .map((s) => (
                <line key={`root-${s.id}`} x1={px(0)} y1={py(0)} x2={px(s.at[0])} y2={py(s.at[1])} stroke={color.get(s.branch)} strokeWidth={3} />
              ))}
          </svg>
          <div className="cw-mine-core" style={{ left: px(0), top: py(0) }} />
          {menu.skills.map((s) => {
            const maxed = s.max > 0 && s.level >= s.max;
            const can = s.open && !maxed && menu.money >= s.cost;
            return (
              <button
                key={s.id}
                type="button"
                className={`cw-mine-node${s.level ? ' owned' : ''}${s.open ? '' : ' locked'}${can ? ' can' : ''}${maxed ? ' maxed' : ''}`}
                style={{ left: px(s.at[0]), top: py(s.at[1]), ['--c' as string]: color.get(s.branch) }}
                onClick={() => onBuy(s.id)}
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover((h) => (h === s.id ? null : h))}
                data-testid={`skill-${s.id}`}
              >
                <span className="cw-mine-node-level">{s.max ? `${s.level}/${s.max}` : s.level}</span>
                <span className="cw-mine-node-name">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="cw-mine-info">
        {shown ? (
          <>
            <strong>{shown.label}</strong>
            <span>{shown.text}</span>
            <span className="cw-mine-cost">{shown.max > 0 && shown.level >= shown.max ? 'Maxed' : shown.open ? `$${money(shown.cost)}` : `Needs ${shown.needs.map((n) => byId.get(n)?.label).join(', ')}`}</span>
          </>
        ) : (
          <span className="cw-mine-dim">Skills</span>
        )}
      </div>
    </div>
  );
}

/** The forest map: rings by region (hazed while cursed), lairs, and where the player is. */
function ForestMap({ map }: { map: ForestMenu['map'] }) {
  const S = 300, k = S / 2 / map.radius;
  return (
    <svg width={S} height={S} className="cw-forest-map">
      {[...map.rings].reverse().map((r, i) => {
        const next = map.rings[map.rings.length - i];
        return <circle key={r.label} cx={S / 2} cy={S / 2} r={(next ? next.from : map.radius) * k} fill={r.color} opacity={r.cursed ? 0.45 : 1} />;
      })}
      {map.rings.map((r) => r.from > 0 && <circle key={`e${r.label}`} cx={S / 2} cy={S / 2} r={r.from * k} fill="none" stroke="rgba(0,0,0,0.35)" />)}
      {map.lairs.map((l) => (
        <g key={l.label} transform={`translate(${S / 2 + l.x * k},${S / 2 + l.z * k})`}>
          <rect x={-4} y={-4} width={8} height={8} fill={l.done ? '#f2c14e' : '#1a1622'} stroke="#f2e8d0" strokeWidth={1.5} />
        </g>
      ))}
      <circle cx={S / 2 + map.at[0] * k} cy={S / 2 + map.at[1] * k} r={4} fill="#fff" stroke="#000" />
    </svg>
  );
}

function ForestUi({ hud, f, menu, onAction }: { hud: MineHud; f: ForestHud; menu: (MineMenu & { forest?: ForestMenu }) | null; onAction: (name: string, arg?: string) => void }) {
  const fm = menu?.forest;
  return (
    <>
      <div className="cw-ov cw-mine-corner" data-testid="mine-hud">
        <div className="cw-forest-region">{f.region}</div>
        {f.curse && <div className="cw-forest-curse">{f.curse}</div>}
        {hud.place && <div className="cw-mine-place">{hud.place}</div>}
        {hud.dynamite > 0 && <div>Dynamite × {hud.dynamite}</div>}
        {f.trophies > 0 && <div className="cw-mine-dim">Trophies {f.trophies}/6</div>}
      </div>
      <div className="cw-ov cw-forest-bar" data-testid="forest-bar">
        {f.slots.map((s, i) => {
          return (
            <button key={i} type="button" className={`cw-forest-slot${f.hand === i ? ' on' : ''}`} title={s.label} onClick={() => onAction('slot', String(i))}>
              {s.kind === 'block' ? s.n > 0 && <img src={blockIcons.get(s.mat)} alt="" /> : <span className={`cw-forest-tool ${s.kind}`} style={{ ['--c' as string]: s.color }} />}
              {s.n > 0 && <span className="cw-forest-n">{s.n}</span>}
            </button>
          );
        })}
      </div>
      {hud.boss && (
        <div className={`cw-ov cw-mine-boss${hud.boss.phase > 1 ? ' angry' : ''}`} data-testid="mine-boss">
          <span>{hud.boss.label}</span>
          <span className="cw-mine-bar">
            <span style={{ width: `${Math.max(0, hud.boss.hp * 100)}%` }} />
          </span>
        </div>
      )}
      {hud.guard && <div key={hud.guard} className={`cw-ov cw-mine-flash ${hud.guard}`} />}
      {hud.aim && !menu && (
        <div className="cw-ov cw-mine-aim">
          <span>{hud.aim.label}</span>
          {hud.aim.needs ? <span className="cw-mine-needs">Needs {hud.aim.needs}</span> : hud.aim.broken > 0 && <span className="cw-mine-bar"><span style={{ width: `${Math.round(hud.aim.broken * 100)}%` }} /></span>}
        </div>
      )}
      {fm && (
        <div className="cw-mine-menu cw-forest-menu" data-testid="mine-menu" onMouseDown={(e) => e.stopPropagation()}>
          <div className="cw-forest-col">
            <h3>Gear</h3>
            <div className="cw-forest-row"><span className="cw-mine-dim">Sword</span><span>{fm.sword}</span></div>
            <div className="cw-forest-row"><span className="cw-mine-dim">Pickaxe</span><span>{fm.pickaxe}</span></div>
            <div className="cw-forest-row"><span className="cw-mine-dim">Armor</span><span>{fm.armor || 'None'}</span></div>
            <div className="cw-forest-row"><span className="cw-mine-dim">Health shards</span><span>{fm.shards}</span></div>
            <h3>Charms</h3>
            {fm.charms.map((c) => (
              <div key={c.label} className={`cw-forest-charm${c.owned ? '' : ' off'}`}>
                <strong>{c.owned ? c.label : '?'}</strong>
                {c.owned && <span>{c.text}</span>}
              </div>
            ))}
          </div>
          <div className="cw-forest-col">
            <h3>Trophies</h3>
            {fm.trophies.map((t) => (
              <div key={t.boss} className={`cw-forest-row${t.done ? '' : ' off'}`}>
                <span>{t.done ? t.boss : '?'}</span>
                <span className="cw-mine-dim">{t.region}</span>
              </div>
            ))}
            <ForestMap map={fm.map} />
          </div>
          <button type="button" className="cw-mine-close" onClick={() => onAction('menu', 'close')} data-testid="mine-close">
            Close
          </button>
        </div>
      )}
    </>
  );
}

export function MineUi({ hud, menu, onAction }: { hud: MineHud; menu: MineMenu | null; onAction: (name: string, arg?: string) => void }) {
  const f = (hud as MineHud & { forest?: ForestHud }).forest;
  if (f) return <ForestUi hud={hud} f={f} menu={menu} onAction={onAction} />;
  return (
    <>
      <div className="cw-ov cw-mine-corner" data-testid="mine-hud">
        <div className="cw-mine-money">${money(hud.money)}</div>
        <div className={`cw-mine-bag${hud.bag >= hud.cap ? ' full' : ''}`}>
          <span>
            Backpack {hud.bag}/{hud.cap}
          </span>
          <span className="cw-mine-bar">
            <span style={{ width: `${Math.min(100, (100 * hud.bag) / Math.max(1, hud.cap))}%` }} />
          </span>
        </div>
        {hud.items.length > 0 && (
          <div className="cw-mine-items">
            {hud.items.map((it) => (
              <div key={it.id} className="cw-mine-item">
                {oreIcons.get(it.id) ? <img src={oreIcons.get(it.id)} alt="" /> : <span className="cw-mine-noicon" />}
                <span>{it.label}</span>
                <span className="cw-mine-grow" />
                <span className="cw-mine-n">{it.n}</span>
              </div>
            ))}
          </div>
        )}
        {hud.atSell && <div className="cw-mine-sell">Sell zone</div>}
        <div className="cw-mine-dim">
          {hud.home ? (hud.surface ? 'Surface' : 'Base') : `${hud.zone} · ${hud.distance}`}
        </div>
        {hud.place && <div className="cw-mine-place">{hud.place}</div>}
        <div className="cw-mine-dim">{hud.pickaxe}</div>
        {hud.dynamite > 0 && <div>Dynamite × {hud.dynamite}</div>}
        <div className="cw-mine-dim">
          {hud.twist} · resets in {clock(hud.regen)}
        </div>
      </div>
      {!hud.home && (
        <button type="button" className="cw-ov cw-mine-home" onClick={() => onAction('home')} data-testid="mine-home">
          Home
        </button>
      )}
      {hud.boss && (
        <div className={`cw-ov cw-mine-boss${hud.boss.phase > 1 ? ' angry' : ''}`} data-testid="mine-boss">
          <span>{hud.boss.label}</span>
          <span className="cw-mine-bar">
            <span style={{ width: `${Math.max(0, hud.boss.hp * 100)}%` }} />
          </span>
        </div>
      )}
      {hud.guard && <div key={hud.guard} className={`cw-ov cw-mine-flash ${hud.guard}`} />}
      {hud.aim && !menu && (
        <div className="cw-ov cw-mine-aim">
          <span>{hud.aim.label}</span>
          {hud.aim.needs ? <span className="cw-mine-needs">Needs {hud.aim.needs}</span> : hud.aim.broken > 0 && <span className="cw-mine-bar"><span style={{ width: `${Math.round(hud.aim.broken * 100)}%` }} /></span>}
        </div>
      )}
      {menu && (
        <div className="cw-mine-menu" data-testid="mine-menu" onMouseDown={(e) => e.stopPropagation()}>
          <div className="cw-mine-panel">
            <div className="cw-mine-head">
              <span className="cw-mine-money">${money(menu.money)}</span>
              <span className="cw-mine-grow" />
              {!menu.home && (
                <button type="button" className="cw-mine-btn" onClick={() => onAction('home')}>
                  Home
                </button>
              )}
              <button type="button" className="cw-mine-btn" onClick={() => onAction('menu', 'close')} aria-label="Close" data-testid="mine-close">
                ×
              </button>
            </div>
            <div className="cw-mine-body">
              <div className="cw-mine-side">
                <div className="cw-mine-card">
                  <div className="cw-mine-swatch" style={{ background: menu.pickaxe.color }} />
                  <div>
                    <strong>{menu.pickaxe.label}</strong>
                    <div className="cw-mine-dim">Power {money(menu.pickaxe.power)}</div>
                  </div>
                </div>
                {menu.pickaxe.next && (
                  <button type="button" className="cw-mine-buy" disabled={menu.money < menu.pickaxe.next.price} onClick={() => onAction('pickaxe')} data-testid="buy-pickaxe">
                    <span className="cw-mine-swatch" style={{ background: menu.pickaxe.next.color }} />
                    <span>
                      {menu.pickaxe.next.label}
                      <span className="cw-mine-dim"> · Power {money(menu.pickaxe.next.power)}</span>
                    </span>
                    <span className="cw-mine-cost">${money(menu.pickaxe.next.price)}</span>
                  </button>
                )}
                <div className="cw-mine-sub">Dynamite × {menu.dynamite.n}</div>
                <div className="cw-mine-row">
                  {[1, 5].map((n) => (
                    <button key={n} type="button" className="cw-mine-buy cw-mine-half" disabled={menu.money < menu.dynamite.price * n} onClick={() => onAction('dynamite', String(n))} data-testid={`buy-dynamite-${n}`}>
                      <span>+{n}</span>
                      <span className="cw-mine-cost">${money(menu.dynamite.price * n)}</span>
                    </button>
                  ))}
                </div>
                <div className="cw-mine-sub">{menu.twist.label}</div>
                <div className="cw-mine-dim">{menu.twist.text}</div>
                <div className="cw-mine-sub">
                  Backpack {menu.bag.reduce((s, b) => s + b.n, 0)}/{menu.cap}
                </div>
                {menu.bag.length ? (
                  menu.bag.map((b) => (
                    <div key={b.id} className="cw-mine-row">
                      {oreIcons.get(b.id) ? <img className="cw-mine-icon" src={oreIcons.get(b.id)} alt="" /> : <span className="cw-mine-dot" style={{ background: b.color }} />}
                      <span>
                        {b.label} × {b.n}
                      </span>
                      <span className="cw-mine-grow" />
                      <span className="cw-mine-dim">${money(b.value)}</span>
                    </div>
                  ))
                ) : (
                  <div className="cw-mine-dim">Empty</div>
                )}
                <div className="cw-mine-dim cw-mine-note">{menu.sellZone ? 'Ores sell in the sell zone.' : `Ores sell when you get back to the ${menu.surface ? 'surface' : 'base'}.`}</div>
              </div>
              <Tree menu={menu} onBuy={(id) => onAction('skill', id)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
