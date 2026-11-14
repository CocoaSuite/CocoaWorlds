/**
 * Mining, drawn: the loaded chunks as block meshes (pixel tiles, corner shading, lit by the player's lamp), the
 * aimed block's outline and cracks, chips flying off, monsters with their template's model, arrows and ore sense.
 */
import * as THREE from 'three';
import { readComponent, type ModelData } from '@cocoaworlds/core';
import { AIR, EDGE, isMat, MAT, oreOf, zoneOf, type Chunk, type MineSystem, type Mob } from '@cocoaworlds/runtime';
import { assetUrl } from '../assets';
import { modelInstance, type ModelInstance } from './models';

import amethystPng from '../assets/mine/amethyst.png';
import azurerockPng from '../assets/mine/azure_rock.png';
import azuritePng from '../assets/mine/azurite.png';
import basaltPng from '../assets/mine/basalt.png';
import coalPng from '../assets/mine/coal.png';
import copperPng from '../assets/mine/copper.png';
import crimsonrockPng from '../assets/mine/crimson_rock.png';
import deepslatePng from '../assets/mine/deepslate.png';
import diamondPng from '../assets/mine/diamond.png';
import emberrockPng from '../assets/mine/ember_rock.png';
import emeraldPng from '../assets/mine/emerald.png';
import fossilPng from '../assets/mine/fossil.png';
import frostrockPng from '../assets/mine/frost_rock.png';
import goldPng from '../assets/mine/gold.png';
import granitePng from '../assets/mine/granite.png';
import ironPng from '../assets/mine/iron.png';
import jadePng from '../assets/mine/jade.png';
import malachitePng from '../assets/mine/malachite.png';
import marblePng from '../assets/mine/marble.png';
import mithrilPng from '../assets/mine/mithril.png';
import moonstonePng from '../assets/mine/moonstone.png';
import obsidianPng from '../assets/mine/obsidian.png';
import opalPng from '../assets/mine/opal.png';
import platinumPng from '../assets/mine/platinum.png';
import prismitePng from '../assets/mine/prismite.png';
import quartzPng from '../assets/mine/quartz.png';
import rubyPng from '../assets/mine/ruby.png';
import sapphirePng from '../assets/mine/sapphire.png';
import shalePng from '../assets/mine/shale.png';
import silverPng from '../assets/mine/silver.png';
import starmetalPng from '../assets/mine/starmetal.png';
import stonePng from '../assets/mine/stone.png';
import sulfurPng from '../assets/mine/sulfur.png';
import sunstonePng from '../assets/mine/sunstone.png';
import topazPng from '../assets/mine/topaz.png';
import voidrockPng from '../assets/mine/void_rock.png';
import voidstonePng from '../assets/mine/voidstone.png';
import beamPng from '../assets/mine/beam.png';
import calcitePng from '../assets/mine/calcite.png';
import carvedstonePng from '../assets/mine/carved_stone.png';
import carvedtemplePng from '../assets/mine/carved_temple.png';
import chestPng from '../assets/mine/chest.png';
import crackedbricksPng from '../assets/mine/cracked_bricks.png';
import crystalblockPng from '../assets/mine/crystal_block.png';
import goldblockPng from '../assets/mine/gold_block.png';
import lanternPng from '../assets/mine/lantern.png';
import lavaPng from '../assets/mine/lava.png';
import planksPng from '../assets/mine/planks.png';
import railPng from '../assets/mine/rail.png';
import stonebricksPng from '../assets/mine/stone_bricks.png';
import templebricksPng from '../assets/mine/temple_bricks.png';
import vaultPng from '../assets/mine/vault.png';
import webPng from '../assets/mine/web.png';
import { BossModel } from './boss-models';

const builtIn: Record<string, string> = { amethyst: amethystPng, azure_rock: azurerockPng, azurite: azuritePng, basalt: basaltPng, coal: coalPng, copper: copperPng, crimson_rock: crimsonrockPng, deepslate: deepslatePng, diamond: diamondPng, ember_rock: emberrockPng, emerald: emeraldPng, fossil: fossilPng, frost_rock: frostrockPng, gold: goldPng, granite: granitePng, iron: ironPng, jade: jadePng, malachite: malachitePng, marble: marblePng, mithril: mithrilPng, moonstone: moonstonePng, obsidian: obsidianPng, opal: opalPng, platinum: platinumPng, prismite: prismitePng, quartz: quartzPng, ruby: rubyPng, sapphire: sapphirePng, shale: shalePng, silver: silverPng, starmetal: starmetalPng, stone: stonePng, sulfur: sulfurPng, sunstone: sunstonePng, topaz: topazPng, void_rock: voidrockPng, voidstone: voidstonePng, beam: beamPng, calcite: calcitePng, carved_stone: carvedstonePng, carved_temple: carvedtemplePng, chest: chestPng, cracked_bricks: crackedbricksPng, crystal_block: crystalblockPng, gold_block: goldblockPng, lantern: lanternPng, lava: lavaPng, planks: planksPng, rail: railPng, stone_bricks: stonebricksPng, temple_bricks: templebricksPng, vault: vaultPng, web: webPng };
const builtInUrl = (id: string) => builtIn[id] ?? '';
const T = 16;

/** Ore icons (picture URLs by ore id) for the backpack, made once the tiles load. */
export const oreIcons = new Map<string, string>();

async function pixels(url: string): Promise<Uint8ClampedArray | null> {
  if (!url) return null;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = T;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, T, T);
    return g.getImageData(0, 0, T, T).data;
  } catch {
    return null;
  }
}

const VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vC;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vC = color;
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Lit blocks (lanterns, crystal, lava) nearest the player that light the rock. */
const NL = 12;

const FRAG = /* glsl */ `
#define NL ${NL}
uniform sampler2D map;
uniform vec3 lamp;
uniform float radius;
uniform float ambient;
uniform float skyY;
uniform float skyFade;
uniform float sky;
uniform vec3 lp[NL];
uniform vec4 lc[NL];
varying vec3 vC;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.002) discard;
  vec3 lit = vec3(0.0);
  for (int i = 0; i < NL; i++) {
    float k = clamp(1.0 - distance(vW, lp[i]) / lc[i].w, 0.0, 1.0);
    lit += lc[i].rgb * k * k;
  }
  float l = clamp(1.0 - distance(vW, lamp) / radius, 0.0, 1.0);
  l = l * l * (3.0 - 2.0 * l);
  // (Daylight near the surface, fading out a few blocks down.)
  l = max(l, sky * smoothstep(skyY - skyFade, skyY, vW.y));
  float glow = 1.0 - t.a;
  gl_FragColor = vec4(t.rgb * vC * (ambient + l * (1.0 - ambient) + lit) + t.rgb * glow * 0.85, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SHADE = [0.8, 1, 0.7];
/** Settings for the held pickaxe model (only its file changes). */
const HAND = readComponent<ModelData>('model', {});
const AO = [0.45, 0.62, 0.8, 1];

export class MineView {
  readonly group = new THREE.Group();
  private atlas: THREE.DataTexture;
  private tiles: number;
  private rows: number;
  /** Rows of rock (the rest of the atlas holds built blocks). */
  private zrows: number;
  private mat: THREE.ShaderMaterial;
  private meshes = new Map<string, { mesh: THREE.Mesh; version: number; chunk: Chunk; lights: number[] }>();
  /** Average colours of each tile (zone × ore), for chips. */
  private colors: THREE.Color[] = [];
  private outline: THREE.LineSegments;
  private cracks: THREE.Mesh;
  private crackTex: THREE.CanvasTexture[];
  private chips: THREE.InstancedMesh;
  private chipState: { p: THREE.Vector3; v: THREE.Vector3; life: number; c: THREE.Color }[] = [];
  private arrows: THREE.InstancedMesh;
  private sense: THREE.InstancedMesh;
  private dark: THREE.Mesh;
  /** The pickaxe in hand (when the pickaxe has a model). */
  private hand = new THREE.Group();
  private handModel = '';
  private handInst: ModelInstance | null = null;
  private local = new THREE.Matrix4();
  private handAt = 0;
  private guardK = 0;
  private senseAt = -1;
  private mobs = new Map<string, { holder: THREE.Group; inst: ModelInstance | null; anim: string }>();
  private seen = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();

  constructor(
    private mine: MineSystem,
    /** The model of the scene object called `name` (a monster's template), if any. */
    private template: (name: string) => ModelData | null,
  ) {
    const c = mine.config;
    this.group.name = 'mine';
    this.tiles = c.ores.length + 1;
    this.zrows = c.zones.length;
    this.rows = this.zrows + Math.ceil(c.materials.length / this.tiles);
    const data = new Uint8Array(this.tiles * T * this.rows * T * 4).fill(255);
    this.atlas = new THREE.DataTexture(data, this.tiles * T, this.rows * T, THREE.RGBAFormat);
    this.atlas.magFilter = this.atlas.minFilter = THREE.NearestFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.needsUpdate = true;
    for (let i = 0; i < this.tiles * this.rows; i++) this.colors.push(new THREE.Color(0x777777));
    void this.loadAtlas();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.atlas }, lamp: { value: new THREE.Vector3() }, radius: { value: 400 }, ambient: { value: c.ambient }, skyY: { value: mine.origin[1] }, skyFade: { value: 5 * mine.B }, sky: { value: c.surface ? 0.9 : 0 }, lp: { value: Array.from({ length: NL }, () => new THREE.Vector3()) }, lc: { value: Array.from({ length: NL }, () => new THREE.Vector4(0, 0, 0, 1)) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    const B = mine.B;
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(B * 1.004, B * 1.004, B * 1.004)), new THREE.LineBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.6 }));
    this.outline.visible = false;
    this.crackTex = crackTextures();
    this.cracks = new THREE.Mesh(new THREE.BoxGeometry(B * 1.006, B * 1.006, B * 1.006), new THREE.MeshBasicMaterial({ map: this.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.cracks.visible = false;
    this.chips = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshBasicMaterial(), 240);
    this.chips.count = 0;
    this.chips.frustumCulled = false;
    this.arrows = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.5, 26), new THREE.MeshBasicMaterial({ color: 0xd8d2c4 }), 32);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.sense = new THREE.InstancedMesh(new THREE.BoxGeometry(B * 0.18, B * 0.18, B * 0.18), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }), 400);
    this.sense.count = 0;
    this.sense.frustumCulled = false;
    this.sense.renderOrder = 10;
    // (Past the loaded chunks there is only dark: no sky through the rock.)
    this.dark = new THREE.Mesh(new THREE.SphereGeometry((mine.config.view + 2) * mine.config.chunk * B * 1.8, 16, 12), new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.dark.frustumCulled = false;
    // (Screen occlusion leaves out what isn't rock.)
    for (const o of [this.dark, this.cracks, this.sense, this.chips, this.arrows]) o.userData.noAo = true;
    this.hand.matrixAutoUpdate = false;
    // The sell zone: a gold square on the ground and a sign over it.
    if (mine.sellAt) {
      const r = mine.config.sellRadius * B, pad = new THREE.Group();
      const gold = new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.85 });
      for (const [w, d, x, z] of [[2 * r, 6, 0, -r], [2 * r, 6, 0, r], [6, 2 * r, -r, 0], [6, 2 * r, r, 0]] as const) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), gold);
        bar.position.set(x, 1, z);
        pad.add(bar);
      }
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.12, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.6;
      pad.add(fill, sign('SELL', B));
      pad.position.set(...mine.sellAt);
      for (const o of pad.children) o.userData.noAo = true;
      this.group.add(pad);
    }
    this.group.add(this.outline, this.cracks, this.chips, this.arrows, this.sense, this.dark, this.hand);
  }

  private async loadAtlas(): Promise<void> {
    const c = this.mine.config;
    const url = async (path: string, id: string) => (path ? await assetUrl(path).catch(() => '') : builtInUrl(id));
    const rocks = await Promise.all(c.zones.map(async (z) => pixels(await url(z.texture, z.id))));
    const ores = await Promise.all(c.ores.map(async (o) => pixels(await url(o.texture, o.id))));
    const W = this.tiles * T, data = this.atlas.image.data as Uint8Array;
    rocks.forEach((rock, row) => {
      for (let col = 0; col < this.tiles; col++) {
        const ore = col ? ores[col - 1] : null, glow = col ? c.ores[col - 1]!.glow : 0;
        const fallback = new THREE.Color(col ? c.ores[col - 1]!.color : '#6e7078');
        let r = 0, g = 0, b = 0, n = 0;
        for (let py = 0; py < T; py++)
          for (let px = 0; px < T; px++) {
            const s = (py * T + px) * 4, d = ((row * T + (T - 1 - py)) * W + col * T + px) * 4;
            let cr = rock ? rock[s]! : fallback.r * 255, cg = rock ? rock[s + 1]! : fallback.g * 255, cb = rock ? rock[s + 2]! : fallback.b * 255, a = 255;
            const oa = ore ? ore[s + 3]! / 255 : 0;
            if (oa > 0) {
              cr += (ore![s]! - cr) * oa;
              cg += (ore![s + 1]! - cg) * oa;
              cb += (ore![s + 2]! - cb) * oa;
              a = Math.max(1, Math.round(255 * (1 - oa * glow)));
              if (oa > 0.9) {
                r += ore![s]!;
                g += ore![s + 1]!;
                b += ore![s + 2]!;
                n++;
              }
            }
            data.set([cr, cg, cb, a], d);
            if (!col) {
              r += cr;
              g += cg;
              b += cb;
              n++;
            }
          }
        if (n) this.colors[row * this.tiles + col]!.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
      }
    });
    // Built blocks: their own tiles. Clear pixels show through; bright ones of glowing blocks glow.
    const mats = await Promise.all(c.materials.map(async (m) => pixels(await url(m.texture, m.id))));
    mats.forEach((px, i) => {
      const row = this.zrows + Math.floor(i / this.tiles), col = i % this.tiles, md = c.materials[i]!, fb = new THREE.Color(0x8a7a66);
      let r = 0, g = 0, b = 0, n = 0;
      for (let py = 0; py < T; py++)
        for (let x = 0; x < T; x++) {
          const s = (py * T + x) * 4, d = ((row * T + (T - 1 - py)) * W + col * T + x) * 4;
          const cr = px ? px[s]! : fb.r * 255, cg = px ? px[s + 1]! : fb.g * 255, cb = px ? px[s + 2]! : fb.b * 255;
          const lum = (0.3 * cr + 0.59 * cg + 0.11 * cb) / 255, w = Math.min(1, Math.max(0, (lum - 0.3) / 0.3));
          const a = px && px[s + 3]! < 128 ? 0 : Math.max(1, Math.round(255 * (1 - md.glow * w)));
          data.set([cr, cg, cb, a], d);
          if (a) {
            r += cr;
            g += cg;
            b += cb;
            n++;
          }
        }
      if (n) this.colors[row * this.tiles + col]!.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
    });
    this.atlas.needsUpdate = true;
    // (Icons: each ore on the first rock.)
    const icon = document.createElement('canvas');
    icon.width = icon.height = T;
    const g = icon.getContext('2d')!;
    c.ores.forEach((o, i) => {
      const img = g.createImageData(T, T);
      for (let py = 0; py < T; py++)
        for (let px = 0; px < T; px++) {
          const d = ((T - 1 - py) * W + (i + 1) * T + px) * 4, o4 = (py * T + px) * 4;
          img.data.set([data[d]!, data[d + 1]!, data[d + 2]!, 255], o4);
        }
      g.putImageData(img, 0, 0);
      oreIcons.set(o.id, icon.toDataURL());
    });
  }

  /** Mesh one chunk: faces next to air (or webs) only. Lit blocks are gathered as lights (a few per chunk). */
  private build(ch: Chunk): { g: THREE.BufferGeometry; lights: number[] } {
    const m = this.mine, b = m.blocks, S = b.size, B = m.B, d = ch.data, mats = m.config.materials;
    const x0 = ch.cx * S, y0 = ch.cy * S, z0 = ch.cz * S;
    const at = (x: number, y: number, z: number) => {
      const lx = x - x0, ly = y - y0, lz = z - z0;
      return lx >= 0 && ly >= 0 && lz >= 0 && lx < S && ly < S && lz < S ? d[lx + S * (lz + S * ly)]! : b.get(x, y, z);
    };
    const solid = (x: number, y: number, z: number) => !b.clear(at(x, y, z));
    const glow = new Map<number, number[]>();
    const pos: number[] = [], uv: number[] = [], col: number[] = [], nrm: number[] = [], idx: number[] = [];
    const [ox, oy, oz] = m.origin;
    const W = this.tiles * T, H = this.rows * T;
    const p = [0, 0, 0], n = [0, 0, 0];
    for (let ly = 0; ly < S; ly++)
      for (let lz = 0; lz < S; lz++)
        for (let lx = 0; lx < S; lx++) {
          const id = d[lx + S * (lz + S * ly)]!;
          if (id === AIR) continue;
          const x = x0 + lx, y = y0 + ly, z = z0 + lz;
          // (The mine's edge looks like darker stone, seen only from inside the mine.)
          const edge = id === EDGE;
          const P = m.config.patch + 1, rim = edge && m.config.surface && y === -1 && Math.max(Math.abs(x), Math.abs(z)) === P;
          const mi = isMat(id) ? id - MAT : -1;
          const tile = edge ? 0 : mi >= 0 ? mi % this.tiles : oreOf(id) + 1, row = edge ? 0 : mi >= 0 ? this.zrows + Math.floor(mi / this.tiles) : Math.min(this.zrows - 1, zoneOf(id));
          const light = mi >= 0 ? mats[mi]!.light : undefined;
          if (light) {
            const k = mi * 4096 + ((x >> 2) & 15) * 256 + ((y >> 2) & 15) * 16 + ((z >> 2) & 15), e = glow.get(k) ?? [0, 0, 0, 0];
            e[0]! += x + 0.5;
            e[1]! += y + 0.5;
            e[2]! += z + 0.5;
            e[3]!++;
            glow.set(k, e);
          }
          const u0 = (tile * T + 0.02) / W, u1 = ((tile + 1) * T - 0.02) / W, v0 = (row * T + 0.02) / H, v1 = ((row + 1) * T - 0.02) / H;
          for (let axis = 0; axis < 3; axis++)
            for (const sign of [1, -1]) {
              n[0] = n[1] = n[2] = 0;
              n[axis] = sign;
              const nb = at(x + n[0]!, y + n[1]!, z + n[2]!);
              if (!b.clear(nb) || nb === id) continue;
              // (Edge faces show only from inside the mine, and on top of the ring just round the patch: its border.)
              if (edge && y + n[1]! >= 0 && !(rim && n[1] === 1)) continue;
              const ua = (axis + 1) % 3, va = (axis + 2) % 3;
              const base = pos.length / 3;
              const corners = sign > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
              const ao: number[] = [];
              for (const [i, j] of corners) {
                p[0] = x;
                p[1] = y;
                p[2] = z;
                p[axis] = p[axis]! + (sign > 0 ? 1 : 0);
                p[ua] = p[ua]! + i!;
                p[va] = p[va]! + j!;
                // (Corner shading: the three blocks in front of this corner.)
                const a = [x + n[0]!, y + n[1]!, z + n[2]!], s1 = [...a], s2 = [...a];
                s1[ua] = s1[ua]! + (i ? 1 : -1);
                s2[va] = s2[va]! + (j ? 1 : -1);
                const c3 = [...s1];
                c3[va] = c3[va]! + (j ? 1 : -1);
                const o1 = solid(s1[0]!, s1[1]!, s1[2]!) ? 1 : 0, o2 = solid(s2[0]!, s2[1]!, s2[2]!) ? 1 : 0, o3 = solid(c3[0]!, c3[1]!, c3[2]!) ? 1 : 0;
                const level = o1 && o2 ? 0 : 3 - o1 - o2 - o3;
                ao.push(level);
                pos.push(ox + (p[0]! - 0.5) * B, oy + p[1]! * B, oz + (p[2]! - 0.5) * B);
                // (Sides keep the tile upright.)
                const tu = axis === 0 ? j! : axis === 2 ? i! : j!, tv = axis === 0 ? i! : axis === 2 ? j! : i!;
                uv.push(tu ? u1 : u0, tv ? v1 : v0);
                const sh = (axis === 1 ? (sign > 0 ? 1 : 0.55) : SHADE[axis]!) * AO[level]! * (edge ? 0.6 : 1);
                col.push(sh, sh, sh);
                nrm.push(n[0]!, n[1]!, n[2]!);
              }
              // (Split along the brighter diagonal so corner shading doesn't streak.)
              if (ao[0]! + ao[2]! >= ao[1]! + ao[3]!) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
              else idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            }
        }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const lights: number[] = [];
    for (const [k, [sx, sy, sz, n]] of glow) {
      const [colour, r] = mats[Math.floor(k / 4096)]!.light!, c = new THREE.Color(colour);
      lights.push(...m.toWorld(sx! / n!, sy! / n!, sz! / n!), c.r, c.g, c.b, r * B * Math.min(1.6, 0.8 + n! * 0.05));
    }
    return { g, lights };
  }

  /** Bring the drawing up to date. `eye`: where the player's lamp is (world). */
  sync(dt: number, eye: [number, number, number], time: number): void {
    const m = this.mine, b = m.blocks, B = m.B;
    this.mat.uniforms.lamp!.value.set(...eye);
    this.dark.position.set(...eye);
    this.mat.uniforms.skyY!.value = m.origin[1];
    this.mat.uniforms.radius!.value = m.lightRadius() * B;
    this.mat.uniforms.ambient!.value = m.config.ambient + m.stat('nightEyes');
    // Chunks: let go of unloaded ones; mesh new and changed ones, nearest first, a few a frame.
    if (b.version !== this.seen) {
      this.seen = b.version;
      for (const [k, e] of this.meshes) {
        if (b.loaded(e.chunk.cx, e.chunk.cy, e.chunk.cz) === e.chunk) continue;
        this.group.remove(e.mesh);
        e.mesh.geometry.dispose();
        this.meshes.delete(k);
      }
    }
    const at = m.toBlock(eye), S = b.size;
    this.dark.visible = !m.config.surface || at[1] < -m.config.crust;
    const pc = [Math.floor(at[0] / S), Math.floor(at[1] / S), Math.floor(at[2] / S)];
    const todo: [number, Chunk][] = [];
    for (const ch of m.chunks()) {
      const k = `${ch.cx},${ch.cy},${ch.cz}`, e = this.meshes.get(k);
      if (e && e.version === ch.version && e.chunk === ch) continue;
      todo.push([(ch.cx - pc[0]!) ** 2 + (ch.cy - pc[1]!) ** 2 + (ch.cz - pc[2]!) ** 2, ch]);
    }
    todo.sort((a, c) => a[0] - c[0]);
    const until = performance.now() + 5;
    for (const [r, ch] of todo) {
      if (performance.now() > until && r > 2) break;
      const k = `${ch.cx},${ch.cy},${ch.cz}`, e = this.meshes.get(k);
      const { g, lights } = this.build(ch);
      this.lightsAt = -1;
      if (e) {
        e.mesh.geometry.dispose();
        e.mesh.geometry = g;
        e.version = ch.version;
        e.chunk = ch;
        e.lights = lights;
      } else {
        const mesh = new THREE.Mesh(g, this.mat);
        mesh.matrixAutoUpdate = false;
        // (Blocks shade their own corners; screen occlusion would blacken every tunnel.)
        mesh.userData.noAo = true;
        this.group.add(mesh);
        this.meshes.set(k, { mesh, version: ch.version, chunk: ch, lights });
      }
    }
    // The aimed block: outline and cracks.
    const a = m.aim;
    this.outline.visible = !!a;
    if (a) {
      const w = m.toWorld(a.x + 0.5, a.y + 0.5, a.z + 0.5);
      this.outline.position.set(...w);
      const crack = m.crack();
      this.cracks.visible = crack > 0;
      if (crack > 0) {
        this.cracks.position.set(...w);
        (this.cracks.material as THREE.MeshBasicMaterial).map = this.crackTex[Math.min(this.crackTex.length - 1, Math.floor(crack * this.crackTex.length))]!;
      }
    } else this.cracks.visible = false;
    for (const f of m.drainFx()) {
      if (f.kind === 'mob') continue;
      if (f.kind === 'boom') {
        this.boom(m.toWorld(f.x, f.y, f.z), f.r * B);
        continue;
      }
      const mi = isMat(f.block) ? f.block - MAT : -1;
      const colour = this.colors[mi >= 0 ? (this.zrows + Math.floor(mi / this.tiles)) * this.tiles + (mi % this.tiles) : Math.min(this.zrows - 1, zoneOf(f.block)) * this.tiles + oreOf(f.block) + 1]!;
      const w = m.toWorld(f.x + 0.5, f.y + 0.5, f.z + 0.5);
      for (let i = 0; i < (f.kind === 'break' ? 14 : 3); i++) this.chip(w, colour, B);
    }
    this.stepChips(dt);
    this.drawMobs(time);
    this.drawArrows();
    this.drawBombs(dt, time);
    this.drawBosses(dt, time, eye);
    if (time - this.lightsAt > 0.25 || time < this.lightsAt) {
      this.lightsAt = time;
      this.pickLights(eye);
    }
    if (time - this.senseAt > 0.5 || time < this.senseAt) {
      this.senseAt = time;
      this.drawSense(at);
    }
  }

  private chip(at: number[], c: THREE.Color, B: number): void {
    const p = new THREE.Vector3(at[0]! + (Math.random() - 0.5) * B * 0.8, at[1]! + (Math.random() - 0.5) * B * 0.8, at[2]! + (Math.random() - 0.5) * B * 0.8);
    const v = new THREE.Vector3((Math.random() - 0.5) * 160, Math.random() * 180 + 40, (Math.random() - 0.5) * 160);
    if (this.chipState.length >= 240) this.chipState.shift();
    this.chipState.push({ p, v, life: 0.5 + Math.random() * 0.4, c });
  }

  private stepChips(dt: number): void {
    this.chipState = this.chipState.filter((c) => (c.life -= dt) > 0);
    this.chipState.forEach((c, i) => {
      c.v.y -= 800 * dt;
      c.p.addScaledVector(c.v, dt);
      const s = Math.min(1, c.life * 3);
      this.m4.compose(c.p, this.q.identity(), this.v.set(s, s, s));
      this.chips.setMatrixAt(i, this.m4);
      this.chips.setColorAt(i, c.c);
    });
    this.chips.count = this.chipState.length;
    this.chips.instanceMatrix.needsUpdate = true;
    if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;
  }

  private drawMobs(time: number): void {
    const m = this.mine, live = new Set<string>();
    for (const mob of m.mobs) {
      live.add(mob.id);
      let v = this.mobs.get(mob.id);
      if (!v) v = this.addMob(mob);
      const w = m.toWorld(mob.pos[0], mob.pos[1], mob.pos[2]);
      v.holder.position.set(...w);
      v.holder.rotation.y = mob.yaw;
      const want = mob.def.anims[mob.state];
      if (v.inst && want && v.anim !== want) {
        v.anim = want;
        v.inst.play(want, mob.state !== 'die' && mob.state !== 'attack');
      }
      if (!v.inst && mob.dead) v.holder.rotation.x = Math.max(-Math.PI / 2, -(time - mob.diedAt) * 6);
    }
    for (const [id, v] of this.mobs) {
      if (live.has(id)) continue;
      this.group.remove(v.holder);
      v.inst?.dispose();
      this.mobs.delete(id);
    }
  }

  private addMob(mob: Mob): { holder: THREE.Group; inst: ModelInstance | null; anim: string } {
    const holder = new THREE.Group();
    const v: { holder: THREE.Group; inst: ModelInstance | null; anim: string } = { holder, inst: null, anim: '' };
    this.group.add(holder);
    this.mobs.set(mob.id, v);
    const data = this.template(mob.def.template);
    if (data) {
      void modelInstance(data)
        .then((inst) => {
          if (!this.mobs.has(mob.id)) return inst.dispose();
          v.inst = inst;
          holder.add(inst.object);
        })
        .catch(() => holder.add(figure(mob)));
    } else holder.add(figure(mob));
    return v;
  }

  private lightsAt = -1;
  private bosses = new Map<string, BossModel>();
  private shots: THREE.InstancedMesh | null = null;

  /** The lit blocks nearest the eye light the rock. */
  private pickLights(eye: [number, number, number]): void {
    const all: number[][] = [];
    for (const e of this.meshes.values()) for (let i = 0; i < e.lights.length; i += 7) all.push(e.lights.slice(i, i + 7));
    all.sort((a, b) => Math.hypot(a[0]! - eye[0], a[1]! - eye[1], a[2]! - eye[2]) - Math.hypot(b[0]! - eye[0], b[1]! - eye[1], b[2]! - eye[2]));
    const lp = this.mat.uniforms.lp!.value as THREE.Vector3[], lc = this.mat.uniforms.lc!.value as THREE.Vector4[];
    for (let i = 0; i < NL; i++) {
      const l = all[i];
      if (l) {
        lp[i]!.set(l[0]!, l[1]!, l[2]!);
        lc[i]!.set(l[3]! * 0.9, l[4]! * 0.9, l[5]! * 0.9, l[6]!);
      } else lc[i]!.set(0, 0, 0, 1);
    }
  }

  /** How lit a point is (0…1), as the rock there would be. */
  private lightAt(w: [number, number, number], eye: [number, number, number]): number {
    const u = this.mat.uniforms, r = u.radius!.value as number;
    let l = Math.max(0, 1 - Math.hypot(w[0] - eye[0], w[1] - eye[1], w[2] - eye[2]) / r);
    l = l * l * (3 - 2 * l);
    const lp = u.lp!.value as THREE.Vector3[], lc = u.lc!.value as THREE.Vector4[];
    for (let i = 0; i < NL; i++) {
      const k = Math.max(0, 1 - lp[i]!.distanceTo(this.v.set(...w)) / lc[i]!.w);
      l += k * k * Math.max(lc[i]!.x, lc[i]!.y, lc[i]!.z);
    }
    return Math.min(1, (u.ambient!.value as number) + l + 0.15);
  }

  private drawBosses(dt: number, time: number, eye: [number, number, number]): void {
    const m = this.mine, live = new Set<string>();
    for (const b of m.bosses) {
      live.add(b.id);
      let v = this.bosses.get(b.id);
      if (!v) {
        v = new BossModel(b, m.B);
        this.bosses.set(b.id, v);
        this.group.add(v.root);
      }
      const w = m.toWorld(b.pos[0], b.pos[1], b.pos[2]);
      v.animate(w, time, dt, this.lightAt([w[0], w[1] + b.h * m.B * 0.5, w[2]], eye));
    }
    for (const [id, v] of this.bosses) {
      if (live.has(id)) continue;
      this.group.remove(v.root);
      v.dispose();
      this.bosses.delete(id);
    }
    // Their shots: glowing cubes in the boss's colour (white once parried back).
    if (!this.shots) {
      this.shots = new THREE.InstancedMesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshBasicMaterial(), 64);
      this.shots.frustumCulled = false;
      this.shots.userData.noAo = true;
      this.group.add(this.shots);
    }
    const list = m.shots.slice(0, 64), c = new THREE.Color();
    list.forEach((s, i) => {
      this.q.setFromEuler(new THREE.Euler(time * 7 + i, time * 5, 0));
      this.m4.compose(this.v.set(...m.toWorld(s.pos[0], s.pos[1], s.pos[2])), this.q, new THREE.Vector3(1, 1, 1));
      this.shots!.setMatrixAt(i, this.m4);
      this.shots!.setColorAt(i, s.back ? c.set(0xfff4c8) : c.set(s.boss.def.color));
    });
    this.shots.count = list.length;
    this.shots.instanceMatrix.needsUpdate = true;
    if (this.shots.instanceColor) this.shots.instanceColor.needsUpdate = true;
  }

  private bombMeshes: THREE.Group[] = [];
  private booms: { mesh: THREE.Mesh; t: number; r: number }[] = [];

  /** Lit sticks: red with a flickering spark on top. */
  private drawBombs(dt: number, time: number): void {
    const m = this.mine;
    while (this.bombMeshes.length < m.bombs.length) {
      const g = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.BoxGeometry(6, 16, 6), new THREE.MeshBasicMaterial({ color: 0xc8352c }));
      const band = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3, 6.4), new THREE.MeshBasicMaterial({ color: 0x3a2a20 }));
      const spark = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
      spark.position.y = 10;
      spark.name = 'spark';
      g.add(stick, band, spark);
      for (const o of g.children) o.userData.noAo = true;
      this.group.add(g);
      this.bombMeshes.push(g);
    }
    this.bombMeshes.forEach((g, i) => {
      const b = m.bombs[i];
      g.visible = !!b;
      if (!b) return;
      g.position.set(...m.toWorld(b.pos[0], b.pos[1], b.pos[2]));
      g.rotation.z = Math.sin(time * 3 + i) * 0.4;
      const s = g.getObjectByName('spark')!;
      s.scale.setScalar(0.6 + Math.abs(Math.sin(time * 40)) * 0.8);
    });
    // Blasts: a quick orange ball that swells and fades.
    this.booms = this.booms.filter((b) => {
      b.t += dt;
      const k = b.t / 0.45;
      if (k >= 1) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        return false;
      }
      b.mesh.scale.setScalar(b.r * (0.4 + k * 0.8));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      return true;
    });
  }

  private boom(at: [number, number, number], r: number): void {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.set(...at);
    mesh.userData.noAo = true;
    this.group.add(mesh);
    this.booms.push({ mesh, t: 0, r });
    const dust = new THREE.Color(0x8a8070);
    for (let i = 0; i < 40; i++) this.chip(at, dust, r);
  }

  private drawArrows(): void {
    const list = this.mine.arrows.slice(0, 32);
    list.forEach((a, i) => {
      const w = this.mine.toWorld(a.pos[0], a.pos[1], a.pos[2]);
      this.v.set(a.vel[0], a.vel[1], a.vel[2]).normalize();
      this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.v);
      this.m4.compose(new THREE.Vector3(...w), this.q, new THREE.Vector3(1, 1, 1));
      this.arrows.setMatrixAt(i, this.m4);
    });
    this.arrows.count = list.length;
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  /** Ores within the sense radius, through the rock. */
  private drawSense(at: [number, number, number]): void {
    const m = this.mine, r = Math.floor(m.stat('oreSense'));
    let n = 0;
    if (r > 0) {
      const cx = Math.floor(at[0]), cy = Math.floor(at[1]), cz = Math.floor(at[2]);
      for (let y = -r; y <= r && n < 400; y++)
        for (let z = -r; z <= r && n < 400; z++)
          for (let x = -r; x <= r && n < 400; x++) {
            if (x * x + y * y + z * z > r * r) continue;
            const id = m.blocks.get(cx + x, cy + y, cz + z);
            const o = id === AIR || id === EDGE || isMat(id) ? -1 : oreOf(id);
            if (o < 0) continue;
            const bx = cx + x, by = cy + y, bz = cz + z, b = m.blocks;
            // (Ores in plain sight need no sensing.)
            if (!b.solid(bx + 1, by, bz) || !b.solid(bx - 1, by, bz) || !b.solid(bx, by + 1, bz) || !b.solid(bx, by - 1, bz) || !b.solid(bx, by, bz + 1) || !b.solid(bx, by, bz - 1)) continue;
            this.m4.makeTranslation(...m.toWorld(cx + x + 0.5, cy + y + 0.5, cz + z + 0.5));
            this.sense.setMatrixAt(n, this.m4);
            this.sense.setColorAt(n, new THREE.Color(m.config.ores[o]!.color));
            n++;
          }
    }
    this.sense.count = n;
    this.sense.instanceMatrix.needsUpdate = true;
    if (this.sense.instanceColor) this.sense.instanceColor.needsUpdate = true;
  }

  /** The pickaxe in hand (Minecraft style: its pixels as little blocks, or the pickaxe's own model), swinging, placed by
   * the camera after it moved. Hidden in third person and while something else is in hand. */
  placeHand(cam: THREE.Camera, time: number, thirdPerson: boolean): void {
    const m = this.mine, p = m.config.pickaxes[m.tier]!, want = p.model ? `model:${p.model}` : `pixels:${p.color}`;
    this.mat.uniforms.lamp!.value.setFromMatrixPosition(cam.matrixWorld);
    this.hand.visible = !thirdPerson && m.handFree && !m.menuOpen;
    if (want !== this.handModel) {
      this.handModel = want;
      this.handInst?.dispose();
      this.handInst = null;
      for (const c of this.hand.children) if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
      this.hand.clear();
      if (p.model)
        void modelInstance({ ...HAND, model: p.model })
          .then((inst) => {
            if (this.handModel !== want) return inst.dispose();
            this.handInst = inst;
            this.hand.add(inst.object);
          })
          .catch(() => {});
      else this.hand.add(pickaxeMesh(p.color));
    }
    const s = (time - m.swungAt) / 0.25, a = s >= 0 && s < 1 ? Math.sin(s * Math.PI) : 0;
    // (Guarding: brought up across the view; a parry knocks it back a little.)
    const dt = Math.min(0.1, Math.max(0, time - this.handAt));
    this.handAt = time;
    this.guardK += ((m.blocking ? 1 : 0) - this.guardK) * Math.min(1, dt * 14);
    const g = this.guardK, kick = m.hud().guard === 'parry' ? 1 : 0;
    // (Handle up from the bottom right corner, leaning in a little; the head arches over the top.)
    const k = p.model ? 1 : 0.5;
    this.local.compose(
      this.v.set((p.model ? 11 : 9.5) - g * 5, -12 - a * 2 + g * 1.5, -15 - a * 3 + kick * 2),
      this.q.setFromEuler(new THREE.Euler(0.1 - a * 1.2 + g * 0.1, -0.3 + a * 0.2 + g * 0.2, (p.model ? -0.1 : 1.08) + g * 0.75 + kick * 0.15, 'YXZ')),
      new THREE.Vector3(k, k, k),
    );
    this.hand.matrix.multiplyMatrices(cam.matrixWorld, this.local);
    this.hand.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    for (const e of this.meshes.values()) e.mesh.geometry.dispose();
    for (const v of this.mobs.values()) v.inst?.dispose();
    for (const v of this.bosses.values()) v.dispose();
    this.mat.dispose();
    this.atlas.dispose();
    for (const t of this.crackTex) t.dispose();
    this.handInst?.dispose();
  }
}

const PICKAXE = [
  '................',
  '....ooooo.......',
  '...ohhllloo.....',
  '....oommlllo....',
  '........oomlo...',
  '.......o2oomlo..',
  '......o32o.omdo.',
  '.....o32o...omo.',
  '....o32o....omo.',
  '...o32o.....odo.',
  '..o32o......odo.',
  '.o32o.......oo..',
  'o32o............',
  'o2o.............',
  '.o..............',
  '................',
];

/** A pickaxe from its pixels: each one a little block, the head in the pickaxe's colour. Grip at the origin. */
function pickaxeMesh(colour: string): THREE.Mesh {
  const c = new THREE.Color(colour), dark = new THREE.Color(0x0a080e), light = new THREE.Color(0xfffaeb);
  const col: Record<string, THREE.Color> = {
    o: c.clone().lerp(dark, 0.75),
    d: c.clone().lerp(dark, 0.4),
    m: c.clone(),
    l: c.clone().lerp(light, 0.3),
    h: c.clone().lerp(light, 0.6),
    '2': new THREE.Color().setRGB(110 / 255, 78 / 255, 44 / 255, THREE.SRGBColorSpace),
    '3': new THREE.Color().setRGB(150 / 255, 112 / 255, 66 / 255, THREE.SRGBColorSpace),
    w: new THREE.Color().setRGB(40 / 255, 26 / 255, 14 / 255, THREE.SRGBColorSpace),
  };
  const at = (x: number, y: number) => (x < 0 || y < 0 || x > 15 || y > 15 ? '.' : PICKAXE[y]![x]!);
  const P = 1.5, pos: number[] = [], rgb: number[] = [], idx: number[] = [];
  const quad = (pts: number[][], k: THREE.Color, shade: number) => {
    const b = pos.length / 3;
    for (const q of pts) {
      pos.push(q[0]! * P, q[1]! * P, q[2]! * P);
      rgb.push(k.r * shade, k.g * shade, k.b * shade);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let ch = at(x, y);
      if (ch === '.') continue;
      if (ch === 'o' && /[23]/.test(at(x - 1, y) + at(x + 1, y))) ch = 'w';
      const k = col[ch]!;
      // (Grip at the origin; y up; half a pixel thick each way.)
      const x0 = x - 2, x1 = x - 1, y0 = 12 - y, y1 = 13 - y, z0 = -0.5, z1 = 0.5;
      quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], k, 1);
      quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], k, 0.75);
      if (at(x, y - 1) === '.') quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], k, 0.95);
      if (at(x, y + 1) === '.') quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], k, 0.55);
      if (at(x + 1, y) === '.') quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], k, 0.85);
      if (at(x - 1, y) === '.') quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], k, 0.7);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.userData.noAo = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** A word on a board that turns to face the camera, hanging over the sell zone. */
function sign(text: string, B: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#f2c14e';
  g.font = `600 58px ${getComputedStyle(document.body).fontFamily}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true }));
  sp.scale.set(B * 2.4, B * 0.9, 1);
  sp.position.y = B * 2.6;
  return sp;
}

/** A plain monster: a block figure its size (red), facing −Z. */
function figure(mob: Mob): THREE.Object3D {
  const [w, h] = mob.def.size;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ color: 0xb4574c, roughness: 0.8 }));
  body.position.y = h / 2;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, Math.min(8, h * 0.2), 4), new THREE.MeshStandardMaterial({ color: 0x1d1f22 }));
  visor.position.set(0, h * 0.82, -w / 2 - 1);
  g.add(body, visor);
  return g;
}

/** Five stages of pixel cracks, each adding to the last. */
function crackTextures(): THREE.CanvasTexture[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lines: [number, number][][] = [];
  for (let k = 0; k < 5; k++) {
    const pts: [number, number][] = [];
    let x = 4 + Math.floor(rnd() * 8), y = 4 + Math.floor(rnd() * 8);
    for (let i = 0; i < 9; i++) {
      pts.push([x, y]);
      x = Math.max(0, Math.min(15, x + Math.round(rnd() * 2 - 1)));
      y = Math.max(0, Math.min(15, y + Math.round(rnd() * 2 - 1)));
    }
    lines.push(pts);
  }
  return lines.map((_, stage) => {
    const c = document.createElement('canvas');
    c.width = c.height = T;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(12,10,10,0.75)';
    for (let k = 0; k <= stage; k++) for (const [x, y] of lines[k]!) g.fillRect(x, y, 1, 1);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}
