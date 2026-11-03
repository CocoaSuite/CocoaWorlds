import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { glassCastsNoShadow, glassIn } from '../src/renderer/viewport/glass-shadows';

/** A stand-in renderer whose shadow pass records which materials it could see. */
function fakeRenderer() {
  const seen: boolean[][] = [];
  let mats: THREE.Material[] = [];
  const shadowMap = {
    enabled: true,
    autoUpdate: true,
    needsUpdate: false,
    render: (_l: THREE.Light[], _s: THREE.Object3D, _c: THREE.Camera) => void seen.push(mats.map((m) => m.visible)),
  };
  const r = { shadowMap } as unknown as THREE.WebGLRenderer;
  return { r, seen, watch: (m: THREE.Material[]) => (mats = m) };
}

function scene() {
  const glass = new THREE.MeshPhysicalMaterial({ transmission: 1 });
  const stone = new THREE.MeshPhysicalMaterial();
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(), glass));
  // (Like the level: one mesh, glass as one material group of it.)
  s.add(new THREE.Mesh(new THREE.BoxGeometry(), [stone, glass]));
  return { s, glass, stone };
}

describe('glass casts no shadow', () => {
  it('finds glass by transmission', () => {
    const { s, glass } = scene();
    expect(glassIn(s)).toEqual([glass]);
  });

  it('hides glass for the shadow pass only, and shows it again after', () => {
    const { s, glass, stone } = scene();
    const f = fakeRenderer();
    f.watch([glass, stone]);
    glassCastsNoShadow(f.r);
    f.r.shadowMap.render([new THREE.DirectionalLight()], s, new THREE.PerspectiveCamera());
    expect(f.seen).toEqual([[false, true]]);
    expect(glass.visible).toBe(true);
  });

  it('follows a material that becomes glass later', () => {
    const { s, stone } = scene();
    const f = fakeRenderer();
    f.watch([stone]);
    glassCastsNoShadow(f.r);
    stone.transmission = 0.5;
    f.r.shadowMap.render([new THREE.DirectionalLight()], s, new THREE.PerspectiveCamera());
    expect(f.seen).toEqual([[false]]);
    expect(stone.visible).toBe(true);
  });

  it('leaves glass that is hidden on purpose hidden', () => {
    const { s, glass } = scene();
    glass.visible = false;
    const f = fakeRenderer();
    f.watch([glass]);
    glassCastsNoShadow(f.r);
    f.r.shadowMap.render([new THREE.DirectionalLight()], s, new THREE.PerspectiveCamera());
    expect(glass.visible).toBe(false);
  });
});
