/**
 * The built-in save menu (Game rules › Save menu): shown when the game is paused. One save; Save and Load do
 * nothing but buzz when scripts block them (or there is nothing to load).
 */
import { useState } from 'react';
import { t } from '../i18n';
import { buzz } from './buzzer';

export interface SaveMenuProps {
  /** Save now: false when it can't (blocked). */
  onSave(): boolean;
  /** Load the save: false when it can't (blocked, or there is none). */
  onLoad(): boolean | Promise<boolean>;
  onResume(): void;
  /** When the save was made (ms since 1970), or null. */
  savedAt: number | null;
}

export function SaveMenu({ onSave, onLoad, onResume, savedAt }: SaveMenuProps) {
  const [at, setAt] = useState(savedAt);
  const when = at ? new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : null;
  return (
    <div className="cw-ov cw-save-menu" data-testid="save-menu" role="dialog" aria-label={t('save.paused')}>
      <strong>{t('save.paused')}</strong>
      <button type="button" data-testid="save-resume" onClick={onResume}>
        {t('save.resume')}
      </button>
      <button
        type="button"
        data-testid="save-save"
        onClick={() => {
          if (onSave()) setAt(Date.now());
          else buzz();
        }}
      >
        {t('save.save')}
      </button>
      <button
        type="button"
        data-testid="save-load"
        onClick={() => {
          void Promise.resolve(onLoad()).then((ok) => !ok && buzz());
        }}
      >
        {t('save.load')}
      </button>
      <span className="cw-save-when">{when ? `${t('save.saved')}\u00a0\u00a0 ${when}` : t('save.none')}</span>
    </div>
  );
}
