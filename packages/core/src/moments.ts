import type { Text } from './components';

/** What a hunting creature can be seen doing, besides walking, attacking and dying. */
export interface CreatureMoment {
  name: string;
  label: Text;
  /** The Animations role it falls back to when the creature's Moves don't name it. */
  role: 'idle' | 'busy' | 'hurt' | 'attack';
  /** How long it lasts (s) unless Moves say otherwise. */
  seconds: number;
  /** Picked at random while it stands about. */
  idle?: boolean;
}

const m = (name: string, en: string, ru: string, role: CreatureMoment['role'], seconds: number, idle = false): CreatureMoment => ({ name, label: { en, ru }, role, seconds, idle });

export const CREATURE_MOMENTS: CreatureMoment[] = [
  m('scratch', 'scratches its belly', 'чешет живот', 'busy', 2.2, true),
  m('tilt', 'tilts its head', 'наклоняет голову', 'busy', 1.2, true),
  m('lookAround', 'looks around', 'оглядывается', 'idle', 2.5, true),
  m('cluck', 'clucks', 'кудахчет', 'busy', 1, true),
  m('stare', 'stares at something', 'на что-то пялится', 'idle', 3, true),
  m('headShake', 'shakes its head', 'мотает головой', 'hurt', 1, true),
  m('twitch', 'twitches', 'дёргается', 'hurt', 0.6, true),
  m('crouch', 'crouches to look at something', 'приседает что-то разглядеть', 'busy', 2, true),
  m('hear', 'snaps its head towards a sound', 'резко поворачивает голову на звук', 'busy', 0.8),
  m('listen', 'stops to listen', 'прислушивается', 'idle', 1.5),
  m('rummage', 'rummages about', 'роется', 'busy', 2),
  m('spot', 'spots the player', 'замечает игрока', 'hurt', 0.4),
  m('lose', 'gives up the search', 'бросает поиски', 'hurt', 1.2),
  m('empty', 'finds a hiding spot empty', 'находит укрытие пустым', 'idle', 1.5),
  m('knock', 'knocks on a hiding spot', 'стучит по укрытию', 'attack', 1.2),
  m('rattle', 'shakes a hiding spot', 'трясёт укрытие', 'attack', 1.2),
  m('open', 'opens a hiding spot', 'открывает укрытие', 'attack', 0.8),
  m('openSlow', 'slowly opens a hiding spot', 'медленно открывает укрытие', 'attack', 1.8),
  m('lookIn', 'looks inside', 'заглядывает внутрь', 'idle', 1),
  m('lookUnder', 'crouches to look underneath', 'заглядывает под', 'busy', 1.6),
  m('kick', 'kicks a hiding spot', 'пинает укрытие', 'attack', 0.8),
];

export const momentOf = (name: string): CreatureMoment | undefined => CREATURE_MOMENTS.find((x) => x.name === name);

/**
 * A creature's Moves: `moment=animation seconds` pairs separated by semicolons ("scratch=belly_scratch 2.4;
 * tilt=head_tilt"). The seconds are optional.
 */
export function parseMoves(text: string): Map<string, { anim: string; seconds: number | null }> {
  const out = new Map<string, { anim: string; seconds: number | null }>();
  for (const part of String(text ?? '').split(';')) {
    const [name, rest] = part.split('=').map((x) => x?.trim() ?? '');
    if (!name || !rest) continue;
    const [anim, secs] = rest.split(/\s+/);
    const s = Number(secs);
    out.set(name, { anim: anim ?? '', seconds: secs && Number.isFinite(s) && s > 0 ? s : null });
  }
  return out;
}
