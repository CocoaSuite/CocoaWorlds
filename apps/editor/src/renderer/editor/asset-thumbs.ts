/**
 * Pictures for the asset library: materials drawn on a lit sphere, models from three-quarters above. One small
 * renderer draws them one at a time and keeps each picture (as a data URL) until what it shows changes.
 */
import { readComponent, type MaterialDef, type ModelData } from '@cocoaworlds/core';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { modelInstance } from '../viewport/models';
import { projectMaterial, releaseMaterial } from '../viewport/project-materials';
import { previewGeometry } from './MaterialsPanel';

const SIZE = 160;
const pictures = new Map<string, string>();
const waiting = new Map<string, Set<(url: string) => void>>();

let stage: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; sphere: THREE.BufferGeometry } | null = null;
function getStage() {
  if (stage) return stage;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(SIZE, SIZE, false);
  r.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x3a3834, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-200, 300, 260);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd2ff, 0.7);
  rim.position.set(260, 60, -300);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, 1, 1, 10000);
  stage = { r, scene, cam, sphere: previewGeometry('sphere') };
  return stage;
}

/** Jobs run one after another (they share the renderer). */
let chain: Promise<void> = Promise.resolve();
function queue(job: () => Promise<void>): void {
  chain = chain.then(job, job).catch(() => {});
}

function publish(key: string, url: string): void {
  pictures.set(key, url);
  for (const fn of waiting.get(key) ?? []) fn(url);
}

function snap(obj: THREE.Object3D): string {
  const s = getStage();
  s.scene.add(obj);
  s.r.render(s.scene, s.cam);
  s.scene.remove(obj);
  return s.r.domElement.toDataURL('image/png');
}

/** A material on a sphere. Drawn again as its images arrive. */
function drawMaterial(key: string, id: string): Promise<void> {
  return new Promise((done) => {
    const s = getStage();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const mesh = new THREE.Mesh(s.sphere);
    mesh.rotation.set(0.25, 0.6, 0);
    const draw = () => {
      s.cam.position.set(0, 0, 330);
      s.cam.lookAt(0, 0, 0);
      publish(key, snap(mesh));
    };
    const m = projectMaterial(id, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(draw, 60);
    });
    mesh.material = m;
    draw();
    // (Images load within a moment; then the material is let go.)
    setTimeout(() => {
      if (timer) clearTimeout(timer);
      draw();
      releaseMaterial(m);
      m.dispose();
      done();
    }, 1500);
  });
}

/** A model from three-quarters above, framed to fit. */
async function drawModel(key: string, path: string): Promise<void> {
  const s = getStage();
  const inst = await modelInstance(readComponent<ModelData>('model', { model: path }));
  const r = Math.max(inst.size.length() / 2, 1);
  const dir = new THREE.Vector3(0.75, 0.45, 1).normalize();
  const dist = r / Math.sin(THREE.MathUtils.degToRad(s.cam.fov / 2)) * 0.92;
  s.cam.position.copy(inst.center).addScaledVector(dir, dist);
  s.cam.near = dist / 100;
  s.cam.far = dist * 10;
  s.cam.updateProjectionMatrix();
  s.cam.lookAt(inst.center);
  publish(key, snap(inst.object));
  inst.dispose();
}

function use(key: string, job: () => Promise<void>): string | null {
  const [url, setUrl] = useState<string | null>(() => pictures.get(key) ?? null);
  useEffect(() => {
    setUrl(pictures.get(key) ?? null);
    let set = waiting.get(key);
    const first = !set;
    if (!set) waiting.set(key, (set = new Set()));
    set.add(setUrl);
    if (first && !pictures.has(key)) queue(job);
    return () => void set.delete(setUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

/** The picture of a material (drawn again whenever the material changes). */
export function useMaterialThumb(def: MaterialDef): string | null {
  const key = `mat:${JSON.stringify(def)}`;
  return use(key, () => drawMaterial(key, def.id));
}

/** The picture of a model file (null until drawn, or if it can't be loaded). */
export function useModelThumb(path: string | null): string | null {
  const key = `model:${path ?? ''}`;
  return use(key, () => (path ? drawModel(key, path).catch(() => {}) : Promise.resolve()));
}

/** Forget pictures (a model file was replaced). */
export function forgetThumbs(prefix: string): void {
  for (const k of [...pictures.keys()]) if (k.startsWith(prefix)) pictures.delete(k);
}
