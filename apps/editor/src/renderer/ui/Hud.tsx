/** The in-game display (health, score, game values, messages, the use prompt), for Play and exported games. */
import type { UiState } from '@cocoaworlds/runtime';
import { t } from '../i18n';
import type { PlaySession } from '../viewport/play-session';

/** What the in-game display shows. */
export interface Hud {
  showHealth: boolean;
  health: number;
  maxHealth: number;
  /** Shown once the player has any. */
  armour: number;
  /** The weapon in hand and its ammo (null when it needs none). */
  weapon: { name: string; ammo: number | null; ammoName: string } | null;
  score: number;
  showScore: boolean;
  /** Just hurt: flash red. */
  hurt: boolean;
  /** Game values shown on screen. */
  values: { name: string; value: string }[];
  /** Messages in the middle of the screen, oldest first. */
  messages: string[];
  /** Looking at something usable: its prompt word ('' for plain “Use”), else null. */
  use: string | null;
  /** Other keys that do something at what's looked at or held, with their prompt words. */
  keys: { key: string; prompt: string }[];
  /** The screen UI now, and every value texts and bars can show ({Cash}, health, score). */
  ui: UiState;
  allValues: Record<string, unknown>;
}

const keyName = (code: string) => code.replace(/^Key|^Digit/, '');

function formatValue(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return v === null || v === undefined ? '' : String(v);
}

/** What the display shows now. `locked`: the mouse is captured (the use prompt only shows then). */
export function hudOf(play: PlaySession, locked: boolean): Hud {
  const status = play.status();
  const screen = play.screen();
  return {
    showHealth: !!status?.showHealth,
    health: Math.ceil(status?.health ?? 0),
    maxHealth: status?.maxHealth ?? 100,
    armour: Math.floor(status?.armour ?? 0),
    weapon: status?.weapon ?? null,
    score: status?.score ?? 0,
    showScore: !!status?.showScore,
    hurt: (status?.sinceHurt ?? Infinity) < 0.35,
    values: screen.values.filter((v) => v.show).map((v) => ({ name: v.name, value: formatValue(v.value) })),
    messages: screen.messages,
    use: locked ? play.usePrompt() : null,
    keys: locked ? play.keyPrompts() : [],
    ui: play.uiState(),
    allValues: { ...Object.fromEntries(screen.values.map((v) => [v.name, v.value])), health: Math.ceil(status?.health ?? 0), armour: Math.floor(status?.armour ?? 0), score: status?.score ?? 0 },
  };
}

/** Health (and the score, once a script uses it) in the corner of the game view; red flash when hurt. */
export function HudView({ hud }: { hud: Hud }) {
  const low = hud.showHealth && hud.health <= 25;
  return (
    <>
      {(hud.use !== null || hud.keys.length > 0) && (
        <div className="cw-ov cw-use-prompt" data-testid="use-prompt" role="status">
          {hud.use !== null && (
            <div className="cw-use-row">
              <kbd>E</kbd>
              <span>{hud.use || t('hud.use')}</span>
            </div>
          )}
          {hud.keys.map((k) => (
            <div key={k.key} className="cw-use-row">
              <kbd>{keyName(k.key)}</kbd>
              <span>{k.prompt || t('hud.use')}</span>
            </div>
          ))}
        </div>
      )}
      {hud.messages.length > 0 && (
        <div className="cw-ov cw-hud-messages" data-testid="hud-messages" role="status">
          {hud.messages.slice(-3).map((m, i) => (
            <div key={i} className="cw-hud-message">
              {m}
            </div>
          ))}
        </div>
      )}
      {hud.hurt && hud.showHealth && <div className="cw-hurt" aria-hidden="true" />}
      {hud.weapon && (
        <div className="cw-ov cw-hud cw-hud-weapon" data-testid="hud-weapon">
          <div className="cw-hud-item">
            <span className="cw-hud-label">{hud.weapon.ammo === null ? hud.weapon.name : `${hud.weapon.name} · ${hud.weapon.ammoName}`}</span>
            {hud.weapon.ammo !== null && (
              <span className={`cw-hud-value${hud.weapon.ammo === 0 ? ' empty' : ''}`} data-testid="hud-ammo">
                {hud.weapon.ammo}
              </span>
            )}
          </div>
        </div>
      )}
      {(hud.showHealth || hud.showScore || hud.values.length > 0) && (
      <div className="cw-ov cw-hud" data-testid="hud">
        {hud.showHealth && (
          <div className={`cw-hud-item${low ? ' low' : ''}`} role="meter" aria-label={t('hud.health')} aria-valuemin={0} aria-valuemax={hud.maxHealth} aria-valuenow={hud.health}>
            <span className="cw-hud-label">{t('hud.health')}</span>
            <span className="cw-hud-value" data-testid="hud-health">
              {hud.health}
            </span>
            <span className="cw-hud-bar">
              <span style={{ width: `${(100 * hud.health) / hud.maxHealth}%` }} />
            </span>
          </div>
        )}
        {hud.showHealth && hud.armour > 0 && (
          <div className="cw-hud-item armour" role="meter" aria-label={t('hud.armour')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={hud.armour}>
            <span className="cw-hud-label">{t('hud.armour')}</span>
            <span className="cw-hud-value" data-testid="hud-armour">
              {hud.armour}
            </span>
            <span className="cw-hud-bar">
              <span style={{ width: `${hud.armour}%` }} />
            </span>
          </div>
        )}
        {hud.values.map((v) => (
          <div key={v.name} className="cw-hud-item" data-testid={`hud-value-${v.name}`}>
            <span className="cw-hud-label">{v.name}</span>
            <span className="cw-hud-value">{v.value}</span>
          </div>
        ))}
        {hud.showScore && (
          <div className="cw-hud-item">
            <span className="cw-hud-label">{t('hud.score')}</span>
            <span className="cw-hud-value" data-testid="hud-score">
              {hud.score}
            </span>
          </div>
        )}
      </div>
      )}
    </>
  );
}
