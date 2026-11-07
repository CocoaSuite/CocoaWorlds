/**
 * Day and night: where the sun is at an hour, and how the sky, the sun and the ambient light look then. The scene's
 * own settings are the look at full day; dawn and dusk warm the horizon and the sun; at night the moon (the sun's
 * light from the other side, cool and dim) and stars take over.
 */
import * as THREE from 'three';

const NIGHT_TOP = new THREE.Color('#04060d');
const NIGHT_HORIZON = new THREE.Color('#121a2c');
const NIGHT_AMBIENT = new THREE.Color('#2a3858');
const DUSK_HORIZON = new THREE.Color('#f2865a');
const DUSK_SUN = new THREE.Color('#ff9a52');
export const MOON = new THREE.Color('#9db4ff');
/** How high the sun stands at noon, tipped from straight up (radians). */
const TILT = 0.45;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Toward the sun at an hour: up from the east at 6, highest at noon (toward `noon`, a level direction), down in
 * the west at 18, under the ground at night.
 */
export function sunToward(hour: number, noon: THREE.Vector3): THREE.Vector3 {
  const n = new THREE.Vector3(noon.x, 0, noon.z);
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  n.normalize();
  const east = new THREE.Vector3(n.z, 0, -n.x);
  const a = ((hour - 6) / 24) * Math.PI * 2;
  const up = new THREE.Vector3(0, Math.cos(TILT), 0).addScaledVector(n, Math.sin(TILT));
  return east.multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a)).normalize();
}

export interface DayLook {
  /** Toward the sun. */
  toward: THREE.Vector3;
  /** 0–1: full day … full night, and the warm band at dawn and dusk. */
  day: number;
  dusk: number;
  night: number;
  top: THREE.Color;
  horizon: THREE.Color;
  sunColour: THREE.Color;
  /** Sunlight (× the scene's Sun brightness) and moonlight (absolute). */
  sun: number;
  moon: number;
  ambient: THREE.Color;
  /** × the scene's ambient strength. */
  ambientScale: number;
}

/** How things look at an hour, from the scene's daytime look. `night`: how bright the night is (0–1). */
export function dayLook(hour: number, noon: THREE.Vector3, base: { top: string; horizon: string; sun: string; ambient: string }, night: number): DayLook {
  const toward = sunToward(hour, noon);
  const e = toward.y;
  const day = smooth(-0.08, 0.3, e);
  const dusk = Math.max(0, 1 - Math.abs(e - 0.03) / 0.2);
  const dark = 1 - smooth(-0.22, 0, e);
  const top = NIGHT_TOP.clone().lerp(new THREE.Color(base.top), day);
  const horizon = NIGHT_HORIZON.clone().lerp(new THREE.Color(base.horizon), day).lerp(DUSK_HORIZON, dusk * 0.75);
  const sunColour = new THREE.Color(base.sun).lerp(DUSK_SUN, Math.min(1, dusk * 0.9 + (1 - day) * 0.4));
  const lit = 0.15 + 0.85 * Math.max(0, Math.min(1, night));
  return {
    toward,
    day,
    dusk,
    night: dark,
    top,
    horizon,
    sunColour,
    sun: smooth(-0.04, 0.12, e),
    moon: dark * 0.35 * lit,
    ambient: NIGHT_AMBIENT.clone().lerp(new THREE.Color(base.ambient), day),
    ambientScale: 0.12 * lit + (1 - 0.12 * lit) * day,
  };
}
