/**
 * Playing an effect from the VFX workspace (no rendering): emitters spawn and move particles, shape animations
 * are read from their keys. Each layer fills flat arrays a renderer draws straight from (one instance per
 * particle). The same seed always plays the same way, so the editor can scrub its timeline by playing again
 * from the start.
 */
import { sampleCurve, sampleGradient, sampleKeys, type VfxEffect, type VfxEmitter, type VfxLayer, type VfxShapeAnim } from '@cocoaworlds/core';
import { seededRandom } from '@cocoaworlds/geometry';

/** Most particles one emitter keeps alive (more are not spawned until some die). */
export const VFX_MAX_PARTICLES = 2000;
const DEG = Math.PI / 180;

/** What one layer draws this frame: `n` instances, in world space. */
export interface VfxLayerOut {
  layer: VfxLayer;
  n: number;
  /** Centre (x, y, z). */
  pos: Float32Array;
  /** Velocity (for lines that point the way they fly). */
  vel: Float32Array;
  /** Size (u), rotation (radians), flipbook frame. */
  srf: Float32Array;
  /** Colour and opacity. */
  rgba: Float32Array;
}

interface EmitterState {
  out: VfxLayerOut;
  // Each live particle (the first `out.n`).
  age: Float32Array;
  life: Float32Array;
  size0: Float32Array;
  spin: Float32Array;
  owed: number;
}

/** A column-major 4×4 matrix (as Three.js keeps them). */
export type Mat4 = ArrayLike<number>;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export class VfxPlayer {
  /** Seconds into the current pass. */
  time = 0;
  /** Passes started (0 for the first). */
  pass = 0;
  /** Off: emitters stop spawning and shapes vanish; what is flying finishes. */
  on = true;
  readonly layers: VfxLayerOut[] = [];
  private emitters = new Map<string, EmitterState>();
  private rnd: () => number;
  private origin: number[] = [...IDENTITY];
  private scale = 1;
  private started = false;

  constructor(
    public effect: VfxEffect,
    private seed = 1,
    /** Play again after each pass, even if the effect doesn't loop. */
    public repeat = false,
  ) {
    this.rnd = seededRandom(seed);
    this.build();
  }

  /** Where the effect plays (world matrix; scale grows sizes, speeds and areas). */
  setOrigin(m: Mat4): void {
    for (let i = 0; i < 16; i++) this.origin[i] = m[i]!;
    this.scale = Math.max(1e-6, Math.hypot(m[0]!, m[1]!, m[2]!));
  }

  /** Change the effect being played (layers kept where their ids match). */
  setEffect(effect: VfxEffect): void {
    this.effect = effect;
    this.build();
  }

  private build(): void {
    const keep = this.emitters;
    this.emitters = new Map();
    this.layers.length = 0;
    for (const layer of this.effect.layers) {
      if (layer.kind === 'emitter') {
        const old = keep.get(layer.id);
        const st = old ?? {
          out: { layer, n: 0, pos: new Float32Array(VFX_MAX_PARTICLES * 3), vel: new Float32Array(VFX_MAX_PARTICLES * 3), srf: new Float32Array(VFX_MAX_PARTICLES * 3), rgba: new Float32Array(VFX_MAX_PARTICLES * 4) },
          age: new Float32Array(VFX_MAX_PARTICLES),
          life: new Float32Array(VFX_MAX_PARTICLES),
          size0: new Float32Array(VFX_MAX_PARTICLES),
          spin: new Float32Array(VFX_MAX_PARTICLES),
          owed: 0,
        };
        st.out.layer = layer;
        this.emitters.set(layer.id, st);
        this.layers.push(st.out);
      } else {
        this.layers.push({ layer, n: 0, pos: new Float32Array(3), vel: new Float32Array(3), srf: new Float32Array(3), rgba: new Float32Array(4) });
      }
    }
  }

  /** Back to the start, nothing flying. */
  reset(): void {
    this.time = 0;
    this.pass = 0;
    this.started = false;
    this.rnd = seededRandom(this.seed);
    for (const st of this.emitters.values()) {
      st.out.n = 0;
      st.owed = 0;
    }
    for (const l of this.layers) if (l.layer.kind === 'shape') l.n = 0;
  }

  /** Play from the start up to `t` seconds (for scrubbing), in small steps. */
  seek(t: number, step = 1 / 60): void {
    this.reset();
    let left = Math.max(0, t);
    this.advance(0);
    while (left > 1e-9) {
      const dt = Math.min(step, left);
      this.advance(dt);
      left -= dt;
    }
    this.readShapes();
  }

  /** Whether everything has finished (a pass that doesn't repeat ended, and nothing is left flying). */
  get done(): boolean {
    if (this.loops && this.on) return false;
    if (this.on && this.time < this.effect.duration) return false;
    for (const st of this.emitters.values()) if (st.out.n) return false;
    return true;
  }

  get loops(): boolean {
    return this.effect.loop || this.repeat;
  }

  /** Move on by `dt` seconds. */
  step(dt: number): void {
    this.advance(Math.min(dt, 0.1));
    this.readShapes();
  }

  private advance(dt: number): void {
    const before = this.time;
    const first = !this.started;
    this.started = true;
    this.time += dt;
    const len = Math.max(0.01, this.effect.duration);
    let wrapped = false;
    if (this.time >= len && this.loops && this.on) {
      this.time -= len;
      this.pass++;
      wrapped = true;
    }
    for (const st of this.emitters.values()) {
      this.move(st, dt);
      if (!this.on) continue;
      const e = st.out.layer as VfxEmitter;
      if (!e.visible) continue;
      if (this.pass > 0 && !this.loops) continue;
      if (e.spawn === 'burst') {
        // Fires when the timeline crosses its start (a start of 0 at the very start, and on every new pass).
        const crossed = wrapped ? before < e.start || this.time >= e.start : (first && e.start <= 0) || (before < e.start && this.time >= e.start);
        if (crossed) this.spawn(st, e, Math.round(e.count));
      } else {
        const overlap = (a: number, b: number) => Math.max(0, Math.min(b, e.start + e.duration) - Math.max(a, e.start));
        st.owed += e.rate * (wrapped ? overlap(before, len) + overlap(0, this.time) : overlap(before, this.time));
        const n = Math.floor(st.owed);
        if (n > 0) {
          st.owed -= n;
          this.spawn(st, e, n);
        }
      }
    }
  }

  private v = [0, 0, 0];
  /** Start `n` particles of an emitter (where the effect is now). */
  private spawn(st: EmitterState, e: VfxEmitter, n: number): void {
    const r = this.rnd, o = this.origin, s = this.scale, out = st.out;
    const lerp = (x: [number, number]) => x[0] + (x[1] - x[0]) * r();
    for (let k = 0; k < n && out.n < VFX_MAX_PARTICLES; k++) {
      const i = out.n++;
      // Where in its area, around the effect's point.
      let px = 0, py = 0, pz = 0;
      const a = e.areaSize;
      if (e.area === 'disc') {
        const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * a;
        px = Math.cos(ang) * rad;
        pz = Math.sin(ang) * rad;
      } else if (e.area === 'sphere') {
        const u = r() * 2 - 1, ang = r() * Math.PI * 2, rad = Math.cbrt(r()) * a, h = Math.sqrt(1 - u * u);
        px = h * Math.cos(ang) * rad;
        py = u * rad;
        pz = h * Math.sin(ang) * rad;
      } else if (e.area === 'box') {
        px = (r() * 2 - 1) * a;
        py = (r() * 2 - 1) * a * 0.1;
        pz = (r() * 2 - 1) * a;
      }
      py += e.rise ?? 0;
      // Which way: up, tipped by up to `spread` degrees.
      const tip = Math.acos(1 - r() * (1 - Math.cos(Math.min(180, Math.max(0, e.spread)) * DEG))), turn = r() * Math.PI * 2;
      const dx = Math.sin(tip) * Math.cos(turn), dy = Math.cos(tip), dz = Math.sin(tip) * Math.sin(turn);
      const speed = lerp(e.speed) * s;
      out.pos[i * 3] = o[0]! * px + o[4]! * py + o[8]! * pz + o[12]!;
      out.pos[i * 3 + 1] = o[1]! * px + o[5]! * py + o[9]! * pz + o[13]!;
      out.pos[i * 3 + 2] = o[2]! * px + o[6]! * py + o[10]! * pz + o[14]!;
      const v = this.v;
      v[0] = (o[0]! * dx + o[4]! * dy + o[8]! * dz) / s;
      v[1] = (o[1]! * dx + o[5]! * dy + o[9]! * dz) / s;
      v[2] = (o[2]! * dx + o[6]! * dy + o[10]! * dz) / s;
      out.vel[i * 3] = v[0]! * speed;
      out.vel[i * 3 + 1] = v[1]! * speed;
      out.vel[i * 3 + 2] = v[2]! * speed;
      st.age[i] = 0;
      st.life[i] = Math.max(0.01, lerp(e.life));
      st.size0[i] = lerp(e.size) * s;
      const spin = lerp(e.spin) * DEG;
      st.spin[i] = r() < 0.5 ? -spin : spin;
      out.srf[i * 3 + 1] = r() * Math.PI * 2 * (e.spin[0] || e.spin[1] ? 1 : 0);
      out.srf[i * 3 + 2] = 0;
      this.paint(st, e, i);
    }
  }

  private rgb: [number, number, number] = [1, 1, 1];
  /** A particle's size, colour, opacity and frame for its age. */
  private paint(st: EmitterState, e: VfxEmitter, i: number): void {
    const out = st.out, k = st.age[i]! / st.life[i]!;
    out.srf[i * 3] = st.size0[i]! * sampleCurve(e.sizeOverLife, k);
    const fb = e.look.style === 'texture' ? e.look.flipbook : undefined;
    if (fb) {
      const frames = Math.max(1, fb.cols * fb.rows);
      out.srf[i * 3 + 2] = fb.fps > 0 ? Math.floor(st.age[i]! * fb.fps) % frames : Math.min(frames - 1, Math.floor(k * frames));
    }
    const c = sampleGradient(e.colourOverLife, k, this.rgb);
    out.rgba[i * 4] = c[0];
    out.rgba[i * 4 + 1] = c[1];
    out.rgba[i * 4 + 2] = c[2];
    out.rgba[i * 4 + 3] = Math.max(0, Math.min(1, sampleCurve(e.opacityOverLife, k)));
  }

  /** Age, move and paint an emitter's particles; the dead are swapped out. */
  private move(st: EmitterState, dt: number): void {
    if (!dt) return;
    const e = st.out.layer as VfxEmitter, out = st.out;
    const g = e.gravity * this.scale, drag = Math.max(0, 1 - e.drag * dt);
    for (let i = 0; i < out.n; ) {
      st.age[i]! += dt;
      if (st.age[i]! >= st.life[i]!) {
        this.kill(st, i);
        continue;
      }
      const k = st.age[i]! / st.life[i]!, sp = sampleCurve(e.speedOverLife, k);
      out.vel[i * 3]! *= drag;
      out.vel[i * 3 + 1] = out.vel[i * 3 + 1]! * drag - g * dt;
      out.vel[i * 3 + 2]! *= drag;
      out.pos[i * 3]! += out.vel[i * 3]! * sp * dt;
      out.pos[i * 3 + 1]! += out.vel[i * 3 + 1]! * sp * dt;
      out.pos[i * 3 + 2]! += out.vel[i * 3 + 2]! * sp * dt;
      out.srf[i * 3 + 1]! += st.spin[i]! * dt;
      this.paint(st, e, i);
      i++;
    }
  }

  private kill(st: EmitterState, i: number): void {
    const out = st.out, j = --out.n;
    if (i === j) return;
    for (const [a, w] of [[out.pos, 3], [out.vel, 3], [out.srf, 3], [out.rgba, 4]] as [Float32Array, number][]) a.copyWithin(i * w, j * w, j * w + w);
    st.age[i] = st.age[j]!;
    st.life[i] = st.life[j]!;
    st.size0[i] = st.size0[j]!;
    st.spin[i] = st.spin[j]!;
  }

  /** Shape animations at the current time. */
  private readShapes(): void {
    const o = this.origin;
    for (const out of this.layers) {
      const l = out.layer;
      if (l.kind !== 'shape') continue;
      const showing = this.on && l.visible && (this.pass === 0 || this.loops);
      const st = showing ? sampleKeys(l as VfxShapeAnim, this.time - l.start) : null;
      if (!st || st.size <= 0) {
        out.n = 0;
        continue;
      }
      out.n = 1;
      const y = st.rise;
      out.pos[0] = o[4]! * y + o[12]!;
      out.pos[1] = o[5]! * y + o[13]!;
      out.pos[2] = o[6]! * y + o[14]!;
      out.srf[0] = st.size * this.scale;
      out.srf[1] = st.rotation * DEG;
      const fb = l.look.style === 'texture' ? l.look.flipbook : undefined;
      out.srf[2] = fb ? Math.floor((this.time - l.start) * Math.max(1, fb.fps || 12)) % Math.max(1, fb.cols * fb.rows) : 0;
      out.rgba[0] = st.colour[0];
      out.rgba[1] = st.colour[1];
      out.rgba[2] = st.colour[2];
      out.rgba[3] = Math.max(0, Math.min(1, st.opacity));
    }
  }

  /** Particles alive now (all layers). */
  get count(): number {
    let n = 0;
    for (const l of this.layers) n += l.n;
    return n;
  }
}
