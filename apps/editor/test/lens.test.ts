import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_LENS, LENS_PRESETS, lensOf, lensOn, type LensSettings } from '@cocoaworlds/core';
import { LensPasses, MAX_BLUR_PX } from '../src/renderer/viewport/lens';

const cam = new THREE.PerspectiveCamera(70, 16 / 9, 4, 8000);
const with_ = (l: Partial<LensSettings>) => ({ ...DEFAULT_LENS, ...l });

describe('lens settings', () => {
  it('are all off in a scene that has none, and in older files', () => {
    expect(lensOn(lensOf(undefined))).toBe(false);
    expect(lensOn(lensOf({}))).toBe(false);
    expect(lensOf({ lens: { vignette: 0.4 } })).toMatchObject({ vignette: 0.4, grain: 0, enabled: true });
  });

  it('any one effect turns them on; the main switch turns them all off', () => {
    for (const l of [{ vignette: 0.1 }, { grain: 0.1 }, { scanlines: 0.1 }, { flicker: 0.1 }, { distortion: -0.2 }, { aberration: 0.1 }, { dof: true }])
      expect(lensOn(with_(l))).toBe(true);
    expect(lensOn(with_({ vignette: 1, grain: 1, enabled: false }))).toBe(false);
    // (Depth of field with no blur shows nothing.)
    expect(lensOn(with_({ dof: true, blur: 0 }))).toBe(false);
  });

  it('every look but Clean shows something; Clean shows nothing', () => {
    for (const p of LENS_PRESETS) expect(lensOn(with_(p.lens))).toBe(p.id !== 'none');
    expect(new Set(LENS_PRESETS.map((p) => p.id)).size).toBe(LENS_PRESETS.length);
  });
});

describe('lens passes', () => {
  it('only the passes in use run', () => {
    const p = new LensPasses();
    p.update(with_({}), cam, 1280, 720, 1, 0);
    expect([p.dof.enabled, p.lens.enabled, p.noise.enabled]).toEqual([false, false, false]);
    p.update(with_({ vignette: 0.5 }), cam, 1280, 720, 1, 0);
    expect([p.dof.enabled, p.lens.enabled, p.noise.enabled]).toEqual([false, true, false]);
    p.update(with_({ grain: 0.2, dof: true }), cam, 1280, 720, 1, 0);
    expect([p.dof.enabled, p.lens.enabled, p.noise.enabled]).toEqual([true, false, true]);
    p.update(with_({ grain: 0.2, dof: true, vignette: 1, enabled: false }), cam, 1280, 720, 1, 0);
    expect([p.dof.enabled, p.lens.enabled, p.noise.enabled]).toEqual([false, false, false]);
    p.dispose();
  });

  it('keeps numbers in range and scales pixel sizes with the pixel ratio', () => {
    const p = new LensPasses();
    p.update(with_({ dof: true, blur: 5, distortion: -3, vignette: 2, grain: 9, grainSize: 50, scanlines: 0.5, scanlineSize: 1 }), cam, 2560, 1440, 2, 0);
    expect(p.dof.uniforms.maxBlur!.value).toBe(MAX_BLUR_PX * 2);
    expect(p.lens.uniforms.distortion!.value).toBe(-1);
    expect(p.lens.uniforms.vignette!.value).toBe(1);
    expect(p.lens.uniforms.aspect!.value).toBeCloseTo(16 / 9);
    expect(p.noise.uniforms.grain!.value).toBe(1);
    expect(p.noise.uniforms.cell!.value).toBe(16);
    expect(p.noise.uniforms.lineSize!.value).toBe(4);
    p.dispose();
  });

  it('the grain changes as often as asked, and stays still at 0', () => {
    const p = new LensPasses();
    const seedAt = (speed: number, time: number) => {
      p.update(with_({ grain: 0.5, grainSpeed: speed }), cam, 640, 360, 1, time);
      return p.noise.uniforms.seed!.value as number;
    };
    const a = seedAt(10, 1.0);
    expect(seedAt(10, 1.05)).toBe(a);
    expect(seedAt(10, 1.15)).not.toBe(a);
    const still = seedAt(0, 3);
    expect(seedAt(0, 9)).toBe(still);
    p.dispose();
  });

  it('full-screen passes never write depth (depth of field reads it)', () => {
    const p = new LensPasses();
    for (const m of [p.dof.material, p.lens.material, p.noise.material]) {
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(false);
    }
    p.dispose();
  });
});
