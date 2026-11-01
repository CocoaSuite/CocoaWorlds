/**
 * Play mode inside the editor (decision D7): a game world built from a snapshot of the scene, drawn with
 * its own meshes. The editor's scene is never touched; stopping throws all of this away.
 *
 * With a Player start in the scene you play as the player (first person); without one, Play is a physics
 * preview watched with the free camera.
 */
import { SceneDoc, readComponent, type ColliderData, type GameRules, type GameValue, type SceneFile, type SignData } from '@cocoaworlds/core';
import { buildMesh, isInvisibleMaterial, type WorldBrush } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, type BodyInfo, type PlayerInput, type PlayerStatus, type ScriptLog, type TriggerEvent } from '@cocoaworlds/runtime';
import type { Problem, ScriptError } from '@cocoaworlds/scripting';
import * as THREE from 'three';
import { worldBrushes } from '../brush/brushes';
import { buildLevel } from './world-build';
import { toGeometry } from './world-render';
import { buildSign, type SignObject } from './sign';

export interface PlayInfo {
  moving: number;
  triggers: number;
  names: Map<string, string>;
  /** Script problems found when the game was built (stacks with errors don't run). */
  problems: Problem[];
  /** There is a Player start: you play as the player. */
  player: boolean;
}

export interface PlayFrame {
  events: TriggerEvent[];
  logs: ScriptLog[];
  errors: ScriptError[];
  /** What the player used (entity ids). */
  uses: string[];
  /** Health and score news for the console: deaths and score changes. */
  notes: string[];
}

export class PlaySession {
  readonly group = new THREE.Group();
  private world: GameWorld;
  /** Objects drawn where their body is: base placement, then the body's motion on top. */
  private movers: { id: string; obj: THREE.Object3D; base: THREE.Matrix4 }[] = [];
  readonly info: PlayInfo;
  private shapeMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.8 });
  private uses: string[] = [];
  private notes: string[] = [];
  private signs = new Map<string, { holder: THREE.Group; sign: SignObject; data: SignData }>();
  private signVersion = 0;

  static async start(scene: SceneFile, material: (name: string) => THREE.Material, rules?: GameRules, values?: GameValue[]): Promise<PlaySession> {
    await initPhysics();
    // Invisible colliders (COL) collide but aren't drawn in the game.
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    return new PlaySession(scene, (name) => (isInvisibleMaterial(name) ? hidden : material(name)), rules, values);
  }

  private constructor(scene: SceneFile, material: (name: string) => THREE.Material, rules?: GameRules, values?: GameValue[]) {
    this.group.name = 'play';
    this.world = GameWorld.create(scene, { rules, values });
    const doc = new SceneDoc(structuredClone(scene));
    const bodies = new Set(this.world.movingBodies().map((b) => b.id));

    // The level as players see it: only still brushes (no trigger zones, no subtract volumes, nothing that moves).
    const still: WorldBrush[] = worldBrushes(doc).filter((b) => this.world.levelIds.has(b.id) || (b.role === 'subtract' && !bodies.has(b.id)));
    const level = buildLevel({ seq: 0, brushes: still });
    if (level.mesh) {
      const m = level.mesh;
      this.group.add(new THREE.Mesh(toGeometry(m), m.groups.map((g) => material(g.material))));
    }

    this.material = material;
    for (const b of this.world.movingBodies()) if (doc.get(b.id)) this.addMover(b);

    // Text signs, where they stand (redrawn when blocks change their text).
    const shown = (id: string) => {
      for (let x = doc.get(id); x; x = x.parent ? doc.get(x.parent) : undefined) if (!x.visible) return false;
      return true;
    };
    for (const e of doc.entities) {
      if (!e.components.sign || !shown(e.id)) continue;
      const data = readComponent<SignData>('sign', e.components.sign);
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.fromArray(doc.worldMatrix(e.id));
      this.group.add(holder);
      const sign = buildSign(data);
      holder.add(sign.object);
      this.signs.set(e.id, { holder, sign, data });
    }

    this.info = {
      moving: bodies.size,
      triggers: this.world.stats.triggers,
      names: new Map([...doc.entities.map((e) => [e.id, e.name] as [string, string]), ['player', 'The player']]),
      problems: this.world.scriptProblems,
      player: !!this.world.player,
    };
    this.world.bus.on('use', (e) => void this.uses.push(e.target));
    this.world.bus.on('player.die', (e) => void this.notes.push(`The player died (${e.cause}) and starts again`));
    this.world.bus.on('break', (e) => void this.notes.push(`${this.info.names.get(e.target.split('#')[0]!) ?? 'Something'} broke`));
    this.world.bus.on('score', (e) => void this.notes.push(`Score: ${e.score} (${e.by > 0 ? '+' : ''}${e.by})`));
  }

  private material: (name: string) => THREE.Material;
  private body: THREE.Group | null = null;

  /** The player's body for the third-person camera: a capsule with a visor showing where they face. */
  private makeBody(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fb04a, roughness: 0.6 });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(15, 40, 6, 16), mat);
    capsule.position.y = 35;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.3 }));
    visor.position.set(0, 58, -13);
    g.add(capsule, visor);
    g.name = 'player-body';
    this.group.add(g);
    return g;
  }

  /** Draw a body: its brushes, or a point object's collision shape. */
  private addMover(b: BodyInfo): void {
    if (b.kind === 'zone') return;
    let obj: THREE.Object3D;
    let base = new THREE.Matrix4();
    if (b.kind === 'brush' || b.kind === 'unit') {
      // Drawn in world space at the start; the body's motion moves it from there.
      const brushes = this.world.bodyBrushes(b.id);
      if (!brushes.length) return;
      const m = buildMesh(brushes);
      obj = new THREE.Mesh(toGeometry(m), m.groups.map((g) => this.material(g.material)));
    } else {
      // A point object with a collision shape: draw the shape, placed like the entity (scale in the shape).
      const shape = this.world.pointShape(b.id);
      if (!shape) return;
      const c = shape.collider;
      const geo =
        c.shape === 'sphere'
          ? new THREE.SphereGeometry(c.size[0] / 2, 24, 16)
          : c.shape === 'capsule'
            ? new THREE.CapsuleGeometry(c.size[0] / 2, Math.max(0, c.size[1] - c.size[0]), 6, 16)
            : new THREE.BoxGeometry(...c.size);
      geo.translate(...c.offset);
      obj = new THREE.Mesh(geo, this.shapeMat);
      base = new THREE.Matrix4().fromArray(shape.matrix);
    }
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(base);
    this.group.add(obj);
    this.movers.push({ id: b.id, obj, base });
  }

  /** Advance the game and move what moved. Returns what happened this frame. */
  tick(dt: number): PlayFrame {
    this.world.step(dt);
    const changes = this.world.drainChanges();
    for (const b of changes.spawned) this.addMover(b);
    if (changes.removed.length) {
      const gone = new Set(changes.removed);
      for (const m of this.movers.filter((m) => gone.has(m.id))) {
        this.group.remove(m.obj);
        if (m.obj instanceof THREE.Mesh) m.obj.geometry.dispose();
      }
      this.movers = this.movers.filter((m) => !gone.has(m.id));
    }
    const motion = new THREE.Matrix4();
    for (const m of this.movers) {
      m.obj.visible = this.world.isVisible(m.id);
      const mm = this.world.motionOf(m.id);
      if (!mm) continue;
      m.obj.matrix.copy(motion.fromArray(mm).multiply(m.base));
      m.obj.matrixWorldNeedsUpdate = true;
    }
    if (this.world.signVersion !== this.signVersion) {
      this.signVersion = this.world.signVersion;
      for (const [id, s] of this.signs) {
        const text = this.world.signText(id) ?? s.data.text;
        if (text === s.data.text) continue;
        s.data = { ...s.data, text };
        s.holder.remove(s.sign.object);
        s.sign.dispose();
        s.sign = buildSign(s.data);
        s.holder.add(s.sign.object);
      }
    }
    const uses = this.uses, notes = this.notes;
    this.uses = [];
    this.notes = [];
    return { events: this.world.drainEvents(), logs: this.world.drainLogs(), errors: this.world.drainScriptErrors(), uses, notes };
  }

  /** Game values (all, with whether each is shown) and the messages on screen now. */
  screen(): { values: { name: string; value: unknown; show: boolean }[]; messages: string[] } {
    return { values: this.world.gameValues(), messages: this.world.screenMessages() };
  }

  /** What pressing Use would do now (see GameWorld.usePrompt). */
  usePrompt(): string | null {
    return this.world.usePrompt();
  }

  /** What a text sign says now. */
  signText(id: string): string | undefined {
    return this.world.signText(id);
  }

  /** Health and score for the screen (null without a player). */
  status(): PlayerStatus | null {
    return this.world.playerStatus();
  }

  /** For tests: hurt the player as a script would. */
  hurt(amount: number): void {
    this.world.hurt(amount, 'a test');
  }

  // ── The player ──

  setInput(input: Partial<PlayerInput>): void {
    this.world.setPlayerInput(input);
  }

  get look(): { yaw: number; pitch: number } {
    const p = this.world.player;
    return p ? { yaw: p.input.yaw, pitch: p.input.pitch } : { yaw: 0, pitch: 0 };
  }

  use(): void {
    this.world.use();
  }

  /** Place a camera at the player's eyes. Returns false when there is no player. */
  placeCamera(cam: THREE.PerspectiveCamera): boolean {
    const v = this.world.playerView();
    if (!v) return false;
    cam.position.set(...v.eye);
    cam.rotation.set(v.pitch, v.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    // Third person: the player is seen, as a simple body turned the way they look.
    if (v.thirdPerson) {
      this.body ??= this.makeBody();
      this.body.visible = true;
      this.body.position.set(...v.feet);
      this.body.rotation.set(0, v.yaw, 0);
      const crouched = this.world.player?.crouched ?? false;
      this.body.scale.set(1, crouched ? 0.5 : 1, 1);
    }
    return true;
  }

  activeBlocks(): Map<string, string[]> {
    return this.world.activeBlocks();
  }

  get time(): number {
    return this.world.time;
  }

  dispose(): void {
    this.world.dispose();
    for (const s of this.signs.values()) s.sign.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name !== 'sign') o.geometry.dispose();
    });
    this.shapeMat.dispose();
  }
}
