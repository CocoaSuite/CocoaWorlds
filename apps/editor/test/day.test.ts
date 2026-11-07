import { describe, expect, it } from 'vitest';
import { SceneDoc, newEntity, newScene } from '@cocoaworlds/core';
import * as THREE from 'three';
import { dayLook, sunToward } from '../src/renderer/viewport/day';
import { SceneLighting } from '../src/renderer/viewport/scene-lighting';

const noon = new THREE.Vector3(0, 0, 1);
const base = { top: '#4a7fc1', horizon: '#c9dcef', sun: '#fff4e0', ambient: '#ffffff' };

describe('day and night', () => {
  it('the sun rises in the east, is highest at noon and is under the ground at midnight', () => {
    expect(sunToward(6, noon).y).toBeCloseTo(0);
    expect(sunToward(6, noon).x).toBeGreaterThan(0.9);
    expect(sunToward(12, noon).y).toBeGreaterThan(0.85);
    expect(sunToward(18, noon).x).toBeLessThan(-0.9);
    expect(sunToward(0, noon).y).toBeLessThan(-0.85);
  });

  it('night is darker than day, with a moon and a darker sky; dusk warms the horizon', () => {
    const d = dayLook(12, noon, base, 0.25), n = dayLook(0, noon, base, 0.25), dusk = dayLook(18, noon, base, 0.25);
    expect(d.sun).toBe(1);
    expect(d.top.getHexString()).toBe('4a7fc1');
    expect(n.sun).toBe(0);
    expect(n.moon).toBeGreaterThan(0);
    expect(n.ambientScale).toBeLessThan(0.2);
    expect(n.top.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.05);
    expect(dusk.horizon.r).toBeGreaterThan(dusk.horizon.b);
  });

  it('scene lighting moves its sun with the hour (and makes one if the scene has none)', () => {
    const file = newScene('day');
    file.entities = [newEntity('bulb', { light: { kind: 'point', color: '#ffffff', intensity: 1, range: 400, castShadows: false } })];
    file.settings.day = { enabled: true, minutes: 10, startHour: 12, night: 0.25 };
    const doc = new SceneDoc(file);
    const l = new SceneLighting();
    l.update(doc, (id) => doc.worldMatrix(id), new THREE.Box3(new THREE.Vector3(-512, 0, -512), new THREE.Vector3(512, 256, 512)), new THREE.Scene());
    const sun = l.group.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    l.setDay(null);
    expect(sun.position.y).toBeGreaterThan(500);
    const bright = sun.intensity;
    l.setDay(0);
    expect(sun.intensity).toBeLessThan(bright / 3);
    const u = (l as never as { skyMat: THREE.ShaderMaterial }).skyMat.uniforms;
    expect((u.cloudColour!.value as THREE.Color).getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.25);
  });
});
