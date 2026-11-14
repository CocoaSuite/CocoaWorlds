/**
 * The dev console's commands (` while playing): cheats, moving about and poking at the world. Each command
 * takes the words after its name and answers with lines to print.
 */
import type { Value } from '@cocoaworlds/scripting';
import type { GameWorld } from './world';

interface DevCommand {
  args: string;
  help: string;
  run(w: GameWorld, a: string[], rest: string): string[] | string;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const onOff = (word: string | undefined, now: boolean): boolean => {
  const w = word?.toLowerCase();
  if (w === '1' || w === 'on' || w === 'true') return true;
  if (w === '0' || w === 'off' || w === 'false') return false;
  return !now;
};

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/** A value typed in: a number, true/false, or text (quotes optional). */
function valueOf(s: string): Value {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = Number(t);
  if (t !== '' && Number.isFinite(n)) return n;
  return t.replace(/^"(.*)"$/, '$1');
}

/** The one object called `name` (exact match first), or an error line. */
function oneNamed(w: GameWorld, name: string): { id: string; name: string } | string {
  if (!name) return 'Name an object.';
  const all = w.objectsNamed(name);
  const exact = all.filter((o) => o.name.toLowerCase() === name.toLowerCase());
  const pick = exact.length ? exact : all;
  if (!pick.length) return `No object called “${name}”.`;
  if (pick.length > 1 && !exact.length) return `“${name}” matches ${pick.length} objects: ${pick.slice(0, 6).map((o) => o.name).join(', ')}${pick.length > 6 ? '…' : ''}`;
  return pick[0]!;
}

export const DEV_COMMANDS: Record<string, DevCommand> = {
  help: {
    args: '[command]',
    help: 'List the commands, or explain one.',
    run: (_w, a) => {
      if (a[0]) {
        const c = DEV_COMMANDS[a[0].toLowerCase()];
        return c ? `${a[0].toLowerCase()} ${c.args} — ${c.help}` : `No command “${a[0]}”.`;
      }
      return Object.entries(DEV_COMMANDS).map(([k, c]) => `${k} ${c.args}`.trimEnd().padEnd(26) + c.help);
    },
  },
  god: {
    args: '[on|off]',
    help: 'Nothing hurts the player.',
    run: (w, a) => `God mode ${(w.dev.god = onOff(a[0], w.dev.god)) ? 'on' : 'off'}.`,
  },
  noclip: {
    args: '[on|off]',
    help: 'Fly through walls (Space up, Ctrl down, Shift faster).',
    run: (w, a) => {
      if (!w.player) return 'There is no player.';
      w.player.noclip = onOff(a[0], w.player.noclip);
      return `Noclip ${w.player.noclip ? 'on' : 'off'}.`;
    },
  },
  speed: {
    args: '<times>',
    help: 'Player speed multiplier (1: normal).',
    run: (w, a) => {
      const n = num(a[0]);
      if (n === null) return `Speed is ×${fmt(w.dev.speed)}.`;
      w.dev.speed = Math.max(0.05, Math.min(20, n));
      return `Speed ×${fmt(w.dev.speed)}.`;
    },
  },
  timescale: {
    args: '<times>',
    help: 'How fast the game runs (1: normal, 0: frozen).',
    run: (w, a) => {
      const n = num(a[0]);
      if (n === null) return `Time scale is ×${fmt(w.dev.timeScale)}.`;
      w.dev.timeScale = Math.max(0, Math.min(8, n));
      return `Time scale ×${fmt(w.dev.timeScale)}.`;
    },
  },
  heal: {
    args: '[amount]',
    help: 'Give health back (all of it by default).',
    run: (w, a) => {
      w.heal(num(a[0]) ?? w.maxHealth);
      return `Health ${fmt(w.playerStatus()?.health ?? 0)}.`;
    },
  },
  hurt: {
    args: '<amount>',
    help: 'Hurt the player.',
    run: (w, a) => {
      const n = num(a[0]);
      if (n === null) return 'Usage: hurt <amount>';
      w.hurt(n, 'the console');
      return `Health ${fmt(w.playerStatus()?.health ?? 0)}.`;
    },
  },
  armour: {
    args: '<amount>',
    help: 'Give armour (up to 100).',
    run: (w, a) => {
      w.giveArmour(num(a[0]) ?? 100);
      return `Armour ${fmt(w.playerStatus()?.armour ?? 0)}.`;
    },
  },
  kill: { args: '', help: 'The player dies.', run: (w) => (w.killPlayer(), 'Killed.') },
  give: {
    args: '<item> [count]',
    help: 'Give the player items.',
    run: (w, a) => {
      if (!a[0]) return 'Usage: give <item> [count]';
      const last = num(a[a.length - 1]);
      const n = a.length > 1 && last !== null ? last : 1;
      const name = (a.length > 1 && last !== null ? a.slice(0, -1) : a).join(' ');
      w.giveItem(name, n);
      return `Gave ${n} × ${name}.`;
    },
  },
  items: {
    args: '',
    help: 'What the player carries.',
    run: (w) => {
      const all = w.items();
      return all.length ? all.map(([k, n]) => `${n} × ${k}`) : 'No items.';
    },
  },
  score: {
    args: '<amount>',
    help: 'Add to the score.',
    run: (w, a) => {
      const n = num(a[0]);
      if (n === null) return `Score ${w.playerStatus()?.score ?? 0}.`;
      w.addScore(n);
      return `Score ${w.playerStatus()?.score ?? 0}.`;
    },
  },
  pos: {
    args: '',
    help: 'Where the player stands and looks.',
    run: (w) => {
      const v = w.playerView();
      if (!v) return 'There is no player.';
      return `Feet ${v.feet.map(fmt).join(' ')}  yaw ${fmt((v.yaw * 180) / Math.PI)}°  pitch ${fmt((v.pitch * 180) / Math.PI)}°`;
    },
  },
  tp: {
    args: '<x y z | object>',
    help: 'Teleport the player to a place or an object.',
    run: (w, a, rest) => {
      const p = w.player;
      if (!p) return 'There is no player.';
      const xyz = a.length === 3 ? a.map(num) : null;
      if (xyz && xyz.every((n) => n !== null)) {
        p.teleport({ x: xyz[0]!, y: xyz[1]!, z: xyz[2]! });
        return `Teleported to ${xyz.join(' ')}.`;
      }
      const o = oneNamed(w, rest);
      if (typeof o === 'string') return o;
      const at = w.positionOf(o.id);
      if (!at) return `${o.name} has no place.`;
      p.teleport({ x: at[0], y: at[1], z: at[2] });
      return `Teleported to ${o.name}.`;
    },
  },
  find: {
    args: '<name>',
    help: 'List objects whose name has this in it, with where they are.',
    run: (w, _a, rest) => {
      const all = w.objectsNamed(rest);
      if (!all.length) return 'Nothing found.';
      const lines = all.slice(0, 20).map((o) => {
        const at = w.positionOf(o.id);
        return `${o.name}${at ? `  @ ${at.map(fmt).join(' ')}` : ''}`;
      });
      if (all.length > 20) lines.push(`…and ${all.length - 20} more.`);
      return lines;
    },
  },
  spawn: {
    args: '<object>',
    help: 'Copy an object to where you are looking.',
    run: (w, _a, rest) => {
      const o = oneNamed(w, rest);
      if (typeof o === 'string') return o;
      const id = w.spawn(o.id, 'aim') ?? w.spawn(o.id, { ref: 'player' });
      return id ? `Spawned ${o.name}.` : `Couldn't place ${o.name}.`;
    },
  },
  remove: {
    args: '<object>',
    help: 'Take an object out of the game.',
    run: (w, _a, rest) => {
      const o = oneNamed(w, rest);
      if (typeof o === 'string') return o;
      w.remove(o.id);
      return `Removed ${o.name}.`;
    },
  },
  hour: {
    args: '<0–24>',
    help: 'Set the time of day.',
    run: (w, a) => {
      const n = num(a[0]);
      if (n === null) return `It is ${fmt(w.dayHour)}h, day ${w.day}.`;
      w.setHour(n);
      return `It is ${fmt(w.dayHour)}h.`;
    },
  },
  day: {
    args: '<n>',
    help: 'Set the day.',
    run: (w, a) => {
      const n = num(a[0]);
      if (n === null) return `Day ${w.day}.`;
      w.setDay(n);
      return `Day ${w.day}.`;
    },
  },
  skip: {
    args: '<hours>',
    help: 'Pass time (days roll over).',
    run: (w, a) => {
      const n = num(a[0]);
      if (n === null || n <= 0) return 'Usage: skip <hours>';
      w.passHours(n);
      return `It is ${fmt(w.dayHour)}h, day ${w.day}.`;
    },
  },
  values: {
    args: '',
    help: 'Every game value.',
    run: (w) => {
      const all = w.gameValues();
      return all.length ? all.map((v) => `${v.name} = ${JSON.stringify(v.value)}`) : 'No game values.';
    },
  },
  set: {
    args: '<value> <to>',
    help: 'Set a game value.',
    run: (w, a, rest) => {
      const name = a[0];
      if (!name || a.length < 2) return 'Usage: set <value> <to>';
      if (!w.gameValues().some((v) => v.name === name)) return `No game value “${name}”. Try: values`;
      w.setValue(name, valueOf(rest.slice(name.length)));
      return `${name} = ${JSON.stringify(w.gameValues().find((v) => v.name === name)?.value)}`;
    },
  },
  say: { args: '<text>', help: 'Show a message on screen.', run: (w, _a, rest) => (w.say(rest, 4), []) },
  scene: {
    args: '<scene> [landmark]',
    help: 'Go to another scene.',
    run: (w, a) => {
      if (!a[0]) return 'Usage: scene <scene> [landmark]';
      w.changeScene(a[0], a[1] ?? '');
      return `Going to ${a[0]}…`;
    },
  },
  save: { args: '', help: 'Save progress now.', run: (w) => (w.saveNow(), 'Saved.') },
};

/** Words of a command line; "quoted words" stay together. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

/** Run one line typed in the console; what to print back. */
export function runDevCommand(w: GameWorld, line: string): string[] {
  const t = line.trim();
  if (!t) return [];
  const [head = '', ...a] = words(t);
  const c = DEV_COMMANDS[head.toLowerCase()];
  if (!c) return [`Unknown command “${head}”. Type help.`];
  const rest = t.slice(t.indexOf(head) + head.length).trim();
  try {
    const out = c.run(w, a, rest.replace(/^"(.*)"$/, '$1'));
    return typeof out === 'string' ? [out] : out;
  } catch (e) {
    return [`Error: ${(e as Error).message}`];
  }
}

/** Command names starting with `prefix`, for Tab. */
export function completeDevCommand(prefix: string): string[] {
  const p = prefix.toLowerCase();
  return Object.keys(DEV_COMMANDS).filter((k) => k.startsWith(p));
}
