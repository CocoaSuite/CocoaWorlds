import { describe, expect, it } from 'vitest';
import { SceneDoc, newEntity, newScene } from '@cocoaworlds/core';
import * as THREE from 'three';
import { SceneLighting } from '../src/renderer/viewport/scene-lighting';

function setup(edit: (f: ReturnType<typeof newScene>) => void = () => {}) {
  const file = newScene('lit');
  file.entities = [
    newEntity('bulb', { light: { kind: 'point', color: '#ffcc88', intensity: 2, range: 400, castShadows: false } }, { position: [0, 100, 0] }),
    newEntity('spot', { light: { kind: 'spot', color: '#ffffff', intensity: 1, range: 600, angle: 40, castShadows: true } }, { position: [200, 200, 0], rotation: [-90, 0, 0] }),
    newEntity('sun', { light: { kind: 'directional', color: '#fff4e0', intensity: 2, castShadows: true } }, { position: [0, 500, 0], rotation: [-45, 30, 0] }),
  ];
  edit(file);
  return new SceneDoc(file);
}
const bounds = () => new THREE.Box3(new THREE.Vector3(-512, -16, -512), new THREE.Vector3(512, 256, 512));

describe('scene lighting', () => {
  it('makes a light for each Light object, plus ambient and the sky', () => {
    const doc = setup();
    const l = new SceneLighting();
    const scene = new THREE.Scene();
    l.update(doc, (id) => doc.worldMatrix(id), bounds(), scene);
    const lights = l.group.children.filter((o) => (o as THREE.Light).isLight) as THREE.Light[];
    expect(lights.map((x) => x.type).sort()).toEqual(['DirectionalLight', 'HemisphereLight', 'PointLight', 'SpotLight']);
    const bulb = lights.find((x) => x.type === 'PointLight') as THREE.PointLight;
    expect(bulb.position.y).toBe(100);
    expect(bulb.distance).toBe(400);
    expect(bulb.castShadow).toBe(false);
    const spot = lights.find((x) => x.type === 'SpotLight') as THREE.SpotLight;
    // Pointing down (rotated −90° about X: −Z becomes −Y).
    expect(spot.target.position.y).toBeLessThan(spot.position.y);
    const sun = lights.find((x) => x.type === 'DirectionalLight') as THREE.DirectionalLight;
    expect(sun.castShadow).toBe(true);
    // The sun's shadow covers the level.
    expect(sun.shadow.camera.right).toBeGreaterThanOrEqual(512);
    expect(l.group.getObjectByName('sky')).toBeTruthy();
    expect(l.shadows).toBe(true);
  });

  it('hidden lights are left out; fog and the sky follow the settings; no rebuild when nothing changed', () => {
    const doc = setup((f) => {
      f.entities[0]!.visible = false;
      f.settings.fog = { enabled: true, color: '#808080', near: 100, far: 900 };
      f.settings.sky = { enabled: false, top: '#000', horizon: '#fff', ground: '#111' };
    });
    const l = new SceneLighting();
    const scene = new THREE.Scene();
    l.update(doc, (id) => doc.worldMatrix(id), bounds(), scene);
    expect(l.group.children.some((o) => o.type === 'PointLight')).toBe(false);
    expect(l.group.getObjectByName('sky')).toBeUndefined();
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    const before = l.group.children.slice();
    l.update(doc, (id) => doc.worldMatrix(id), bounds(), scene);
    expect(l.group.children).toEqual(before);
  });
});
