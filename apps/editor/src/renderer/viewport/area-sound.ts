/**
 * How the game sounds where the player is (Sound areas, under water): one effect chain on the listener that
 * every sound changed by areas goes through, and a plain way out for the ones that aren't (music, UI).
 *
 *   sounds ─▶ listener gain ─▶ lowpass ─┬─▶ dry ───────────────▶ speakers
 *                                       └─▶ echo (convolver) ─▶ wet ─┘     (one echo per effect, faded in and out)
 *   plain sounds ─▶ plain ─▶ speakers
 *
 * The echoes are made in code (decaying noise), so no audio files have to ship. Changing effect fades over
 * FADE seconds so walking through a door doesn't click.
 */
import type { SoundEffect } from '@cocoaworlds/core';
import type * as THREE from 'three';

/** Seconds to fade from one effect (or background sound) to the next. */
export const FADE = 0.3;
/** Wide open: the lowpass lets everything through. */
const OPEN = 20000;

/** What each effect does at full amount: echo length (s) and how fast it dies away, its level, the dry level and the lowpass. */
export const EFFECTS: Record<SoundEffect, { echo: number; decay: number; wet: number; dry: number; lowpass: number }> = {
  none: { echo: 0, decay: 0, wet: 0, dry: 1, lowpass: OPEN },
  room: { echo: 0.5, decay: 4, wet: 0.3, dry: 1, lowpass: OPEN },
  hall: { echo: 1.8, decay: 3, wet: 0.4, dry: 0.9, lowpass: OPEN },
  cave: { echo: 3.5, decay: 2.2, wet: 0.55, dry: 0.85, lowpass: OPEN },
  underwater: { echo: 0.8, decay: 3, wet: 0.25, dry: 0.9, lowpass: 650 },
  outdoors: { echo: 0, decay: 0, wet: 0, dry: 1, lowpass: OPEN },
};

/** The levels an effect at `mix` (0…1) comes to: 0 is no effect at all, 1 the full effect. */
export function effectLevels(effect: SoundEffect, mix: number): { wet: number; dry: number; lowpass: number } {
  const e = EFFECTS[effect] ?? EFFECTS.none;
  const m = Math.max(0, Math.min(1, mix));
  // (The lowpass moves evenly in pitch, not in Hz: half-way from 20 kHz to 650 Hz is about 3.6 kHz.)
  return { wet: e.wet * m, dry: 1 - (1 - e.dry) * m, lowpass: OPEN ** (1 - m) * e.lowpass ** m };
}

/** A stereo echo: noise that dies away over `seconds` (faster with a higher `decay`). Seeded, so it's always the same. */
export function echoSamples(seconds: number, decay: number, rate: number, seed = 1): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.max(1, Math.round(seconds * rate));
  let x = seed >>> 0 || 1;
  const rnd = () => {
    // (xorshift32)
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  };
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const k = (1 - i / n) ** decay;
    out[0][i] = rnd() * k;
    out[1][i] = rnd() * k;
  }
  return out;
}

export class SoundStage {
  private ctx: AudioContext;
  private lowpass: BiquadFilterNode;
  private dry: GainNode;
  /** Sounds that areas don't change go here, straight out. */
  readonly plain: GainNode;
  private echoes = new Map<SoundEffect, { conv: ConvolverNode; wet: GainNode }>();
  /** What it's set to now (for tests and the console). */
  effect: SoundEffect = 'none';
  mix = 1;

  constructor(private listener: THREE.AudioListener) {
    const ctx = (this.ctx = listener.context);
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = OPEN;
    this.lowpass.Q.value = 0.7;
    this.dry = ctx.createGain();
    this.plain = ctx.createGain();
    listener.gain.disconnect();
    listener.gain.connect(this.lowpass);
    this.lowpass.connect(this.dry);
    this.dry.connect(ctx.destination);
    this.plain.connect(ctx.destination);
  }

  /** Fade to an effect at an amount. */
  set(effect: SoundEffect, mix: number): void {
    if (effect === this.effect && mix === this.mix) return;
    this.effect = effect;
    this.mix = mix;
    const lv = effectLevels(effect, mix);
    ramp(this.ctx, this.dry.gain, lv.dry);
    ramp(this.ctx, this.lowpass.frequency, lv.lowpass);
    if (EFFECTS[effect]?.echo && lv.wet > 0) this.echo(effect);
    for (const [k, e] of this.echoes) ramp(this.ctx, e.wet.gain, k === effect ? lv.wet : 0);
  }

  /** Where the levels are heading (for tests). */
  levels(): { effect: SoundEffect; mix: number; dry: number; lowpass: number; wet: number } {
    return { effect: this.effect, mix: this.mix, ...effectLevels(this.effect, this.mix) };
  }

  /** Send a sound out plainly: areas and water don't change it. */
  bypass(audio: THREE.Audio | THREE.PositionalAudio): void {
    audio.gain.disconnect();
    audio.gain.connect(this.plain);
  }

  private echo(effect: SoundEffect): void {
    if (this.echoes.has(effect)) return;
    const e = EFFECTS[effect];
    const rate = this.ctx.sampleRate;
    const [l, r] = echoSamples(e.echo, e.decay, rate, effect.length * 7919);
    const buffer = this.ctx.createBuffer(2, l.length, rate);
    buffer.copyToChannel(l, 0);
    buffer.copyToChannel(r, 1);
    const conv = this.ctx.createConvolver();
    conv.buffer = buffer;
    const wet = this.ctx.createGain();
    wet.gain.value = 0;
    this.lowpass.connect(conv);
    conv.connect(wet);
    wet.connect(this.ctx.destination);
    this.echoes.set(effect, { conv, wet });
  }

  /** Back to how the listener was. */
  dispose(): void {
    for (const e of this.echoes.values()) {
      e.conv.disconnect();
      e.wet.disconnect();
    }
    this.lowpass.disconnect();
    this.dry.disconnect();
    this.plain.disconnect();
    this.listener.gain.disconnect();
    this.listener.gain.connect(this.ctx.destination);
  }
}

/** Glide a setting to `v` over FADE seconds, from wherever it is now. */
export function ramp(ctx: BaseAudioContext, p: AudioParam, v: number, seconds = FADE): void {
  const now = ctx.currentTime;
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.linearRampToValueAtTime(v, now + seconds);
}
