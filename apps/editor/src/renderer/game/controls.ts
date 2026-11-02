/** The game's controls, shared by Play in the editor and by exported games. */
import type { PlayerInput } from '@cocoaworlds/runtime';

/** Keys the game uses itself while playing (they never reach anything else). */
export const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ControlLeft', 'ControlRight', 'KeyC', 'ShiftLeft', 'ShiftRight', 'KeyE']);

/** Larger single mouse movements (pixels) while playing are glitches, not the player. */
export const MAX_MOUSE_STEP = 300;
const LOOK_SPEED = 0.0022;

/** Movement from the keys held down. */
export function inputFromKeys(keys: Set<string>): Partial<PlayerInput> {
  const on = (...c: string[]) => c.some((x) => keys.has(x));
  return {
    forward: (on('KeyW', 'ArrowUp') ? 1 : 0) - (on('KeyS', 'ArrowDown') ? 1 : 0),
    right: (on('KeyD', 'ArrowRight') ? 1 : 0) - (on('KeyA', 'ArrowLeft') ? 1 : 0),
    jump: on('Space'),
    crouch: on('ControlLeft', 'ControlRight', 'KeyC'),
    walk: on('ShiftLeft', 'ShiftRight'),
    use: on('KeyE'),
  };
}

/** Where the view turns for a mouse movement (null for a glitch to ignore). */
export function lookFromMouse(look: { yaw: number; pitch: number }, dx: number, dy: number): { yaw: number; pitch: number } | null {
  // Browsers sometimes report one huge jump while the mouse is captured (a known pointer-lock glitch).
  if (Math.abs(dx) > MAX_MOUSE_STEP || Math.abs(dy) > MAX_MOUSE_STEP) return null;
  const limit = Math.PI / 2 - 0.01;
  return { yaw: look.yaw - dx * LOOK_SPEED, pitch: Math.max(-limit, Math.min(limit, look.pitch - dy * LOOK_SPEED)) };
}

/** Keys scripts can react to (“When the player presses”): letters the game doesn't use, and Tab. */
export const isScriptKey = (code: string) => /^(Key[A-Z]|Tab)$/.test(code) && !GAME_KEYS.has(code);
