/**
 * Text signs: text drawn to a canvas and shown on a flat plaque (read from its front, +Z side) or on a sprite
 * that always faces the camera. Used by the editor's markers and by Play, so both look the same.
 */
import type { SignData } from '@cocoaworlds/core';
import * as THREE from 'three';

/** Canvas pixels per line of text. */
const LINE_PX = 64;
const PAD_PX = 18;

export interface SignObject {
  object: THREE.Object3D;
  /** Size in world units (width, height). */
  width: number;
  height: number;
  dispose(): void;
}

function draw(data: SignData): { canvas: HTMLCanvasElement; lines: number } {
  const lines = (data.text || ' ').split('\n');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `600 ${LINE_PX * 0.8}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font;
  const w = Math.min(4096, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width), LINE_PX * 0.5)) + PAD_PX * 2);
  const h = lines.length * LINE_PX + PAD_PX * 2;
  canvas.width = w;
  canvas.height = h;
  // (Resizing clears the context.)
  ctx.font = font;
  if (data.background) {
    ctx.fillStyle = 'rgba(16, 16, 16, 0.72)';
    const r = 16;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.fill();
  }
  ctx.fillStyle = data.color || '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!data.background) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 6;
  }
  lines.forEach((l, i) => ctx.fillText(l, w / 2, PAD_PX + LINE_PX * (i + 0.5)));
  return { canvas, lines: lines.length };
}

export function buildSign(data: SignData): SignObject {
  const { canvas } = draw(data);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // World size: one line of text is `size` units tall (padding included proportionally).
  const k = Math.max(1, data.size) / (LINE_PX * 0.8);
  const width = canvas.width * k;
  const height = canvas.height * k;
  let object: THREE.Object3D;
  let material: THREE.Material;
  if (data.faceCamera) {
    material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material as THREE.SpriteMaterial);
    sprite.scale.set(width, height, 1);
    object = sprite;
  } else {
    material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.FrontSide });
    object = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  }
  object.name = 'sign';
  return {
    object,
    width,
    height,
    dispose: () => {
      texture.dispose();
      material.dispose();
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    },
  };
}
