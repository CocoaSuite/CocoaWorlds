/** Stable identifiers for entities, scenes, assets and projects. */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** A 16-character lowercase id, e.g. `k3f9a0z2m1q8x7c4`. Collision chance is negligible at project scale. */
export function newId(): string {
  let s = '';
  for (const b of randomBytes(16)) s += ALPHABET[b % ALPHABET.length];
  return s;
}

const ID_RE = /^[0-9a-z]{16}$/;

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}
