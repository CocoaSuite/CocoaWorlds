/**
 * A positional sound that costs less than three's own:
 *
 * - three's PositionalAudio schedules six panner changes (position and facing) every frame for every sound
 *   playing, moved or not. Game sounds face nowhere (they're heard the same all round), so only the position
 *   is sent, and only when it moved.
 * - It can be heard from somewhere other than where it is (`heardAt`): out along the way it reaches the ears,
 *   round a corner or through a doorway. It glides there rather than jumping.
 * - It starts with the cheap stereo panning; the few loudest sounds get the head-related (HRTF) one, which
 *   sounds more real but costs a convolution per sound (`setHrtf`).
 * - It carries a lowpass and a volume of its own (walls muffle it) between the source and the panner.
 */
import * as THREE from 'three';

export class LeanPositionalAudio extends THREE.PositionalAudio {
  /** Walls dull the highs. */
  readonly muffle: BiquadFilterNode;
  /** And take some volume off. */
  readonly through: GainNode;
  /** Where it's heard from (null: where it is). */
  heardAt: THREE.Vector3 | null = null;
  /** Where the panner was last sent. */
  private sent = new THREE.Vector3(NaN, NaN, NaN);
  private hrtf = false;

  /** `muffled`: give it the lowpass and volume (realistic sound); without, it plays straight into the panner. */
  constructor(listener: THREE.AudioListener, muffled = true) {
    super(listener);
    this.panner.panningModel = 'equalpower';
    this.muffle = this.context.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 22000;
    this.muffle.Q.value = 0.5;
    this.through = this.context.createGain();
    if (muffled) this.setFilters([this.muffle, this.through]);
  }

  setHrtf(on: boolean): void {
    if (on === this.hrtf) return;
    this.hrtf = on;
    this.panner.panningModel = on ? 'HRTF' : 'equalpower';
  }

  get usesHrtf(): boolean {
    return this.hrtf;
  }

  /** Glide the muffle and volume to new settings. */
  muffleTo(cutoff: number, gain: number, seconds = 0.12): void {
    const now = this.context.currentTime;
    for (const [p, v] of [
      [this.muffle.frequency, Math.max(40, Math.min(22000, cutoff))],
      [this.through.gain, Math.max(0, gain)],
    ] as const) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(v, now + seconds);
    }
  }

  /** Set them at once (a sound just starting). */
  muffleNow(cutoff: number, gain: number): void {
    this.muffle.frequency.value = Math.max(40, Math.min(22000, cutoff));
    this.through.gain.value = Math.max(0, gain);
  }

  override updateMatrixWorld(force?: boolean): void {
    THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
    if (this.hasPlaybackControl && !this.isPlaying) return;
    const m = this.matrixWorld.elements;
    const tx = this.heardAt ? this.heardAt.x : m[12]!, ty = this.heardAt ? this.heardAt.y : m[13]!, tz = this.heardAt ? this.heardAt.z : m[14]!;
    const s = this.sent, p = this.panner;
    if (s.x !== s.x) {
      // (Just started: straight there.)
      s.set(tx, ty, tz);
      const now = this.context.currentTime;
      p.positionX.setValueAtTime(s.x, now);
      p.positionY.setValueAtTime(s.y, now);
      p.positionZ.setValueAtTime(s.z, now);
      return;
    }
    {
      // (A jump of more than a little — to or from round a corner — is glided over about a tenth of a second.)
      const d = Math.hypot(tx - s.x, ty - s.y, tz - s.z);
      if (d < 0.5) return;
      const k = d > 48 ? Math.min(1, (this.listener.timeDelta || 1 / 60) * 10) : 1;
      s.set(s.x + (tx - s.x) * k, s.y + (ty - s.y) * k, s.z + (tz - s.z) * k);
    }
    const end = this.context.currentTime + this.listener.timeDelta;
    p.positionX.linearRampToValueAtTime(s.x, end);
    p.positionY.linearRampToValueAtTime(s.y, end);
    p.positionZ.linearRampToValueAtTime(s.z, end);
  }

  override play(delay?: number): this {
    // (Sent afresh: a reused sound must not glide over from where it last played.)
    this.sent.set(NaN, NaN, NaN);
    super.play(delay);
    this.updateMatrixWorld();
    return this;
  }
}
