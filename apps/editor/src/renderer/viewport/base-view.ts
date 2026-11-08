/**
 * Base building, drawn: finished pieces solid, blueprints dark and see-through with their % tag over them, and
 * the ghost of the blueprint being placed. Boxes are kept by key and moved in place, so a door swinging makes
 * nothing new; a tag is drawn again only when its % changes.
 */
import * as THREE from 'three';
import type { BaseSystem, BlueprintTag, DrawnPart } from '@cocoaworlds/runtime';
import { assetUrl } from '../assets';
import { stitch, type Box } from './stitch';

const unit = new THREE.BoxGeometry(1, 1, 1);

export class BaseView {
  readonly group = new THREE.Group();
  private boxes = new Map<string, THREE.Mesh>();
  private solids = new Map<string, THREE.Material>();
  private ghosts = new Map<string, THREE.Material>();
  private version = -1;

  constructor(
    private material: (name: string) => THREE.Material,
    base?: BaseSystem,
  ) {
    this.group.name = 'base';
    if (base) this.preload(base);
  }

  /**
   * Every material a piece can be drawn with (finished, blueprint, ghost), on hidden boxes in the group: Play
   * compiles and uploads them before its first frame, so finishing a piece doesn't stall the game.
   */
  private preload(base: BaseSystem): void {
    const warm = new THREE.Group();
    warm.name = 'base-preload';
    warm.visible = false;
    const add = (p: Partial<DrawnPart>) => {
      const m = new THREE.Mesh(unit, this.materialOf({ ghost: false, material: '', color: '#ffffff', opacity: 1, ...p } as DrawnPart));
      m.castShadow = m.receiveShadow = !p.ghost;
      warm.add(m);
    };
    const g = base.config.ghost;
    add({ ghost: true, color: g.color, opacity: g.opacity });
    add({ ghost: true, color: g.placing, opacity: g.placingOpacity });
    add({ ghost: true, color: g.invalid, opacity: g.placingOpacity });
    for (const d of base.pieces.values()) for (const p of d.mesh.parts) add({ color: p.color, material: p.material || base.config.looks[d.category] || '', opacity: p.opacity });
    this.group.add(warm);
  }

  private materialOf(p: DrawnPart): THREE.Material {
    if (p.ghost) {
      const k = `${p.color}/${p.opacity}`;
      let m = this.ghosts.get(k);
      if (!m) {
        // Flat and see-through: no lighting, no glow.
        m = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: p.opacity, depthWrite: false });
        this.ghosts.set(k, m);
      }
      return m;
    }
    if (p.material) return this.material(p.material);
    // (See-through finished parts, glass: flat colour, no glow.)
    const k = `${p.color}/${p.opacity}`;
    let m = this.solids.get(k);
    if (!m) {
      const clear = p.opacity < 1;
      m = new THREE.MeshStandardMaterial({ color: p.color, roughness: clear ? 0.2 : 0.9, metalness: 0, transparent: clear, opacity: p.opacity, depthWrite: !clear });
      this.solids.set(k, m);
    }
    return m;
  }

  private tags = new Map<string, { sprite: THREE.Sprite; percent: number }>();
  private tagLook: { color: string; text: string; image: HTMLImageElement | null; path: string } = { color: '#1f2a7a', text: '#e8eaff', image: null, path: '' };

  /** The tag's picture (a project image behind the %), loaded once; tags are drawn again when it arrives. */
  private setTagLook(color: string, text: string, path: string): void {
    const l = this.tagLook;
    l.color = color;
    l.text = text;
    if (path === l.path) return;
    l.path = path;
    l.image = null;
    if (!path) return;
    assetUrl(path)
      .then((url) => {
        const img = new Image();
        img.onload = () => {
          if (l.path !== path) return;
          l.image = img;
          for (const t of this.tags.values()) t.percent = -1;
          this.version = -1;
        };
        img.src = url;
      })
      .catch(() => {});
  }

  private drawTag(sprite: THREE.Sprite, percent: number): void {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d')!;
    const l = this.tagLook;
    if (l.image) g.drawImage(l.image, 0, 0, 128, 64);
    else {
      g.fillStyle = l.color;
      g.fillRect(0, 0, 128, 64);
    }
    g.fillStyle = l.text;
    g.font = '600 36px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${percent}%`, 64, 34);
    const old = sprite.material.map;
    sprite.material.map = new THREE.CanvasTexture(c);
    sprite.material.map.colorSpace = THREE.SRGBColorSpace;
    sprite.material.needsUpdate = true;
    old?.dispose();
  }

  private syncTags(list: BlueprintTag[]): void {
    const seen = new Set<string>();
    for (const t of list) {
      seen.add(t.site);
      let e = this.tags.get(t.site);
      if (!e) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false }));
        sprite.scale.set(24, 12, 1);
        sprite.renderOrder = 3;
        e = { sprite, percent: -1 };
        this.tags.set(t.site, e);
        this.group.add(sprite);
      }
      e.sprite.position.set(...t.at);
      if (e.percent !== t.percent) {
        e.percent = t.percent;
        this.drawTag(e.sprite, t.percent);
      }
    }
    for (const [site, e] of this.tags)
      if (!seen.has(site)) {
        e.sprite.removeFromParent();
        e.sprite.material.map?.dispose();
        e.sprite.material.dispose();
        this.tags.delete(site);
      }
  }

  /** Bring the boxes and tags up to date with the base (cheap when nothing changed). */
  sync(base: BaseSystem): void {
    if (base.version === this.version) return;
    this.version = base.version;
    this.setTagLook(base.config.tag.color, base.config.tag.text, base.config.ui.tag);
    this.syncTags(base.tags());
    const seen = new Set<string>();
    const stitched = new Map<string, { part: DrawnPart; boxes: Box[] }>();
    for (const p of base.parts()) {
      // Finished, still, opaque boxes of one look: drawn as one stitched mesh (below).
      if (p.stitch) {
        const k = `${p.material}|${p.material ? '' : p.color}`;
        let g = stitched.get(k);
        if (!g) stitched.set(k, (g = { part: p, boxes: [] }));
        const odd = Math.round(p.yaw / (Math.PI / 2)) % 2 !== 0;
        const h: [number, number, number] = odd ? [p.size[2] / 2, p.size[1] / 2, p.size[0] / 2] : [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
        g.boxes.push({ min: [p.center[0] - h[0], p.center[1] - h[1], p.center[2] - h[2]], max: [p.center[0] + h[0], p.center[1] + h[1], p.center[2] + h[2]] });
        continue;
      }
      const key = `${p.key}${p.ghost ? '~' : ''}`;
      seen.add(key);
      let mesh = this.boxes.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(unit, this.materialOf(p));
        mesh.castShadow = mesh.receiveShadow = !p.ghost;
        mesh.renderOrder = p.ghost ? 2 : 0;
        this.boxes.set(key, mesh);
        this.group.add(mesh);
      }
      mesh.material = this.materialOf(p);
      mesh.position.set(...p.center);
      mesh.rotation.set(0, p.yaw, 0);
      mesh.scale.set(...p.size);
    }
    for (const [key, mesh] of this.boxes)
      if (!seen.has(key)) {
        mesh.removeFromParent();
        this.boxes.delete(key);
      }
    this.syncStitched(stitched);
  }

  /** One mesh per look, rebuilt only when its boxes change. */
  private stitched = new Map<string, { mesh: THREE.Mesh; boxes: string }>();

  private syncStitched(groups: Map<string, { part: DrawnPart; boxes: Box[] }>): void {
    for (const [k, g] of groups) {
      const boxes = JSON.stringify(g.boxes);
      let e = this.stitched.get(k);
      if (e && e.boxes === boxes) continue;
      if (!e) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.materialOf(g.part));
        mesh.castShadow = mesh.receiveShadow = true;
        this.group.add(mesh);
        this.stitched.set(k, (e = { mesh, boxes: '' }));
      }
      e.mesh.geometry.dispose();
      e.mesh.geometry = stitch(g.boxes);
      e.mesh.material = this.materialOf(g.part);
      e.boxes = boxes;
    }
    for (const [k, e] of this.stitched)
      if (!groups.has(k)) {
        e.mesh.removeFromParent();
        e.mesh.geometry.dispose();
        this.stitched.delete(k);
      }
  }

  dispose(): void {
    for (const m of [...this.solids.values(), ...this.ghosts.values()]) m.dispose();
    this.syncStitched(new Map());
    this.syncTags([]);
    this.group.removeFromParent();
  }
}
