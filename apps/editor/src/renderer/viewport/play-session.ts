/**
 * Play mode inside the editor (decision D7): a game world built from a snapshot of the scene, drawn with
 * its own meshes. The editor's scene is never touched; stopping throws all of this away.
 *
 * With a Player start in the scene you play as the player (first person); without one, Play is a physics
 * preview watched with the free camera.
 */
import { SceneDoc, expandRepeats, readComponent, type ParticlesData, type ColliderData, type GameRules, type GameValue, type GooglyEyesData, type ModelData, type SceneFile, type SignData, type TerrainData } from '@cocoaworlds/core';
import { buildMesh, isInvisibleMaterial, type Brush, type VoxelField, type WorldBrush } from '@cocoaworlds/geometry';
import { GameWorld, initPhysics, POSE, AT, NPC, type BuildPrompt, type FrameSnapshot, type Hearing, type NavGrid, type BodyInfo, type ModelMesh, type SavedProgress, type Travel, type UiState, type PlayerInput, type PlayerStatus, type ScriptLog, type TriggerEvent } from '@cocoaworlds/runtime';

/** Field-of-view effects, degrees added to the camera's own; ease rates per second. */
const FOV = { sprint: 8, fall: 10, easeIn: 6, easeOut: 4 };
import type { Problem, ScriptError } from '@cocoaworlds/scripting';
import * as THREE from 'three';
import { brushBounds, worldBrushes } from '../brush/brushes';
import { FoliageRenderer } from './foliage';
import { waterLookOf, waterMaterialFor } from './water-look';
import { PlantRenderer, plantById } from './plants';
import { TerrainRenderer, loadTerrain, terrainChunks } from './terrains';
import { linkTerrainTiles } from './terrain-tiles';
import { BATCH_MIN, ModelBatches, batchKey } from './model-batches';
import { WEAR_RING, buildLevel } from './world-build';
import { toGeometry } from './world-render';
import { buildSign, type SignObject } from './sign';
import { buildPoster, type PosterObject } from './poster';
import { buildGooglyEyes, type GooglyEyes } from './googly-eyes';
import { Effects } from './effects';
import { EMITTER_DEFAULTS } from './particles';
import { assetUrl } from '../assets';
import { modelGeometry, modelInstance, type ModelInstance } from './models';
import { SoundStage, ramp } from './area-sound';
import { BaseView } from './base-view';
import type { SceneLighting } from './scene-lighting';

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
  /** The level's solid pieces as built (for finding reflection probes). */
  levelPieces: Brush[] = [];
  private world: GameWorld;
  private foliage = new FoliageRenderer();
  private terrains = new TerrainRenderer();
  private plants = new PlantRenderer();
  /** Still models drawn many at a time (A2c). */
  readonly batches = new ModelBatches();
  /** Grass detail by distance from the camera. */
  updateFoliage(cam: THREE.Camera, unitsPerPixel?: number): void {
    this.foliage.update(cam, unitsPerPixel);
    this.plants.update(cam);
  }

  /** Where the game's creatures can walk. */
  navigation(): NavGrid | null {
    return this.world.navigation();
  }
  /** Objects drawn where their body is: base placement, then the body's motion on top. */
  /** What moves, each with its body's index in the frame's snapshot. */
  private movers: { id: string; i: number; obj: THREE.Object3D; base: THREE.Matrix4 }[] = [];
  readonly info: PlayInfo;
  private shapeMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.8 });
  private uses: string[] = [];
  private notes: string[] = [];
  private signs = new Map<string, { holder: THREE.Group; sign: SignObject; data: SignData }>();
  private signVersion = 0;

  static async start(scene: SceneFile, material: (name: string) => THREE.Material, rules?: GameRules, values?: GameValue[], saved?: SavedProgress | null, arrive?: Travel | null): Promise<PlaySession> {
    await initPhysics();
    // The triangles of models that collide by their own shape (read from the files, which are loaded already).
    const models = new Map<string, ModelMesh>();
    const wanted = new Set<string>();
    for (const e of scene.entities) {
      const m = e.components.model as Partial<ModelData> | undefined;
      if (m?.model && m.collision !== 'none') wanted.add(m.model);
    }
    await Promise.all(
      [...wanted].map((path) =>
        modelGeometry(path)
          .then((g) => void models.set(path, g))
          .catch(() => {}),
      ),
    );
    // Terrains: their surfaces, chunk by chunk, to collide with (the same meshes are drawn).
    // (All loaded first, so tiles side by side are joined before they're meshed: the seams collide as one ground.)
    const terrains = new Map<string, ModelMesh[]>();
    const loaded: [string, string, VoxelField][] = [];
    for (const e of scene.entities) {
      const file = (e.components.terrain as Partial<TerrainData> | undefined)?.file;
      if (!file) continue;
      const f = await loadTerrain(file);
      if (f) loaded.push([e.id, file, f]);
    }
    linkTerrainTiles(new SceneDoc(scene));
    for (const [id, file, f] of loaded) terrains.set(id, terrainChunks(file, f).map(({ mesh }) => ({ positions: mesh.positions, indices: mesh.indices })));
    // Trees' trunks collide (their crowns don't).
    const trunks = new Map<string, { width: number; height: number }>();
    for (const e of scene.entities) {
      const id = (e.components.plant as { plant?: string } | undefined)?.plant;
      const def = id ? plantById(id) : null;
      if (def?.form === 'tree') trunks.set(e.id, { width: Math.max(4, def.trunkWidth * 0.9), height: def.height * Math.max(0.35, def.trunkClear + 0.5) });
    }
    // Invisible colliders (COL) collide but aren't drawn in the game.
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    return new PlaySession(scene, (name) => (isInvisibleMaterial(name) ? hidden : material(name)), rules, values, models, terrains, trunks, saved ?? null, arrive ?? null);
  }

  private constructor(scene: SceneFile, material: (name: string) => THREE.Material, rules: GameRules | undefined, values: GameValue[] | undefined, models: Map<string, ModelMesh>, terrains: Map<string, ModelMesh[]>, trunks: Map<string, { width: number; height: number }>, saved: SavedProgress | null, arrive: Travel | null) {
    this.group.name = 'play';
    this.world = GameWorld.create(scene, { rules, values, models, terrains, trunks, saved, arrive });
    // (Blasts light their surroundings with lights made now: adding lights later would compile every material again.)
    this.effects = new Effects(this.world.hasBlasts ? 2 : 0);
    // The same copies the game world made (Repeat groups).
    const doc = new SceneDoc(expandRepeats(structuredClone(scene), brushBounds));
    const bodies = new Set(this.world.movingBodies().map((b) => b.id));
    const units = new Set(this.world.movingBodies().filter((b) => b.kind === 'unit').map((b) => b.id));

    // The level as players see it: only still brushes (no trigger zones, no subtract volumes, nothing that moves).
    const still: WorldBrush[] = worldBrushes(doc).filter((b) => this.world.levelIds.has(b.id) || (b.role === 'subtract' && !bodies.has(b.id)));
    const level = buildLevel({ seq: 0, brushes: still });
    this.levelPieces = level.pieces.flatMap(([, ps]) => ps);
    if (level.mesh) {
      const m = level.mesh;
      const levelMesh = new THREE.Mesh(toGeometry(m), m.groups.map((g) => material(g.material)));
      levelMesh.castShadow = levelMesh.receiveShadow = true;
      for (const mat of levelMesh.material as THREE.Material[]) mat.shadowSide = THREE.DoubleSide;
      this.group.add(levelMesh);
    }
    // Plants.
    this.plants.sync(doc);
    this.group.add(this.plants.group);
    // Terrains, as the editor shows them.
    this.terrains.sync(doc);
    this.group.add(this.terrains.group);
    // Grass tufts (Foliage): placed from the same scene, seen but never touched.
    this.foliage.sync(doc);
    this.group.add(this.foliage.group);
    // Water, drawn with its own materials (it hides nothing behind it, and casts no shadow).
    for (const b of worldBrushes(doc)) {
      if (b.role !== 'water') continue;
      const m = buildMesh([b.brush]);
      const water = new THREE.Mesh(toGeometry(m), waterMaterialFor(waterLookOf(doc, b.id)));
      water.name = 'water';
      water.receiveShadow = true;
      this.group.add(water);
    }

    this.material = material;
    this.doc = doc;
    // Base building: build sites, ghosts and the plan's preview.
    if (this.world.base) {
      this.baseView = new BaseView(material);
      this.group.add(this.baseView.group);
    }
    for (const b of this.world.movingBodies()) if (doc.get(b.id)) this.addMover(b);

    // Models of objects without a body of their own: still, or carried by the moving object they are inside.
    // Still ones of the same model are drawn together (A2c); the rest one by one.
    const scripted = JSON.stringify(doc.entities.filter((x) => x.components.script).map((x) => x.components.script)) + JSON.stringify(doc.settings.ui ?? '');
    const stillModels = new Map<string, { data: ModelData; copies: { id: string; matrix: THREE.Matrix4 }[] }>();
    for (const e of doc.entities) {
      // (Creatures draw their own model, where they walk.)
      // (A model moved by scripts is a unit of its own: drawn here, carried by its body.)
      if (!e.components.model || (bodies.has(e.id) && !units.has(e.id)) || e.components.npc) continue;
      let shownE = true;
      for (let x = doc.get(e.id); x; x = x.parent ? doc.get(x.parent) : undefined) if (!x.visible) shownE = false;
      const data = this.modelOf(e.id);
      if (!shownE || !data) continue;
      const mover = this.world.bodyOf(e.id);
      // Batched: still for good. No body, or a fixed one that can't break and that no script names (scripts can
      // hide or show it); everything else is drawn by itself so it can change.
      const fixed = !mover || (!bodies.has(mover) && !e.components.breakable && !e.components.script && !scripted.includes(e.id));
      if (fixed) {
        const k = batchKey(data);
        const b = stillModels.get(k) ?? { data, copies: [] };
        b.copies.push({ id: e.id, matrix: new THREE.Matrix4().fromArray(doc.worldMatrix(e.id)) });
        stillModels.set(k, b);
        continue;
      }
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.fromArray(doc.worldMatrix(e.id));
      this.group.add(holder);
      if (mover) this.movers.push({ id: mover, i: this.world.drawn(mover), obj: holder, base: holder.matrix.clone() });
      this.attachModel(holder, data, e.id);
    }
    const alone = (data: ModelData) => (c: { id: string; matrix: THREE.Matrix4 }) => {
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(c.matrix);
      this.group.add(holder);
      this.attachModel(holder, data, c.id);
    };
    for (const { data, copies } of stillModels.values()) {
      if (copies.length >= BATCH_MIN) void this.batches.add(data, copies, alone(data));
      else copies.forEach(alone(data));
    }
    this.group.add(this.batches.group);

    // Creatures: their model, or a plain figure (red enemies, blue friends, grey others) with a visor at the front.
    for (const e of doc.entities) {
      if (!e.components.npc) continue;
      const holder = new THREE.Group();
      const inner = new THREE.Group();
      const s = new THREE.Vector3();
      new THREE.Matrix4().fromArray(doc.worldMatrix(e.id)).decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      inner.scale.copy(s);
      holder.add(inner);
      const model = e.components.model ? readComponent<ModelData>('model', e.components.model) : null;
      if (model?.model) this.attachModel(inner, model, e.id);
      else inner.add(npcFigure(String((e.components.npc as { side?: string }).side ?? 'hostile')));
      this.group.add(holder);
      this.npcViews.set(e.id, { holder, inner, figure: !model?.model });
    }

    // Particle emitters, where they stand (carried by what moves them).
    for (const e of doc.entities) {
      if (!e.components.particles) continue;
      let shownE = true;
      for (let x = doc.get(e.id); x; x = x.parent ? doc.get(x.parent) : undefined) if (!x.visible) shownE = false;
      if (!shownE) continue;
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.fromArray(doc.worldMatrix(e.id));
      this.group.add(holder);
      const body = this.world.bodyOf(e.id);
      if (body) this.movers.push({ id: body, i: this.world.drawn(body), obj: holder, base: holder.matrix.clone() });
      this.emitters.push({ data: readComponent<ParticlesData>('particles', e.components.particles), holder, body, bodyAt: body ? this.world.drawn(body) : -1, owed: 0 });
    }

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

    // Googly eyes on what draws their object: a creature where it walks, or where the object stands (carried
    // by the moving object it is inside). Objects that move by themselves got theirs with their body (addMover).
    for (const e of doc.entities) {
      if (!e.components.googlyEyes || bodies.has(e.id) || !shown(e.id)) continue;
      const npc = this.npcViews.get(e.id);
      if (npc) {
        this.eyesOn(e.id, npc.inner, new THREE.Matrix4());
        continue;
      }
      const world = new THREE.Matrix4().fromArray(doc.worldMatrix(e.id));
      const body = this.world.bodyOf(e.id);
      const mover = body ? this.movers.find((m) => m.id === body) : undefined;
      if (mover) this.eyesOn(e.id, mover.obj, mover.base.clone().invert().multiply(world));
      else this.eyesOn(e.id, this.group, world);
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
    this.world.bus.on('sound', (e) => void this.startSound(e));
    this.group.add(this.effects.group);
    this.world.bus.on('shot', (e) => {
      const yaw = this.world.player?.input.yaw ?? 0;
      this.effects.tracer(e.from, e.to, e.by === 'player', [Math.cos(yaw), 0, -Math.sin(yaw)]);
    });
    this.world.bus.on('explosion', (e) => this.effects.explosion(e.at, e.radius, e.normal));
    // Marks stick to what was hit: the level, or an object that moves (so they move with it).
    this.world.bus.on('impact', (e) => this.effects.impact(e.at, e.normal, e.melee, this.moverObject(e.target)));
    this.world.bus.on('anim', (e) => {
      const inst = this.models.get(e.target);
      if (inst && !inst.play(e.name, e.loop)) {
        // (Once per object and name: creatures ask for their animations again and again.)
        const key = `${e.target}/${e.name}`;
        if (this.missingAnims.has(key)) return;
        this.missingAnims.add(key);
        this.notes.push(`${this.info.names.get(e.target) ?? 'The object'}: its model has no animation called “${e.name}”`);
      }
    });
    this.world.bus.on('sound.stop', (e) => this.stopSounds(e.source));
    this.world.bus.on('break', (e) => void this.notes.push(`${this.info.names.get(e.target.split('#')[0]!) ?? 'Something'} broke`));
    this.world.bus.on('score', (e) => void this.notes.push(`Score: ${e.score} (${e.by > 0 ? '+' : ''}${e.by})`));
  }

  /** Googly eyes in the game, by the object (or body) they are on. */
  private eyes: { id: string; eyes: GooglyEyes }[] = [];
  private eyesById = new Map<string, GooglyEyes>();

  /** Put an object's googly eyes (if it has any) on `parent`, placed by `local` in it. */
  private eyesOn(id: string, parent: THREE.Object3D, local: THREE.Matrix4): void {
    const data = this.doc.get(id.split('#')[0]!)?.components.googlyEyes;
    if (!data) return;
    const eyes = buildGooglyEyes(readComponent<GooglyEyesData>('googlyEyes', data));
    const holder = new THREE.Group();
    holder.name = 'googly-holder';
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(local);
    holder.add(eyes.object);
    parent.add(holder);
    this.eyes.push({ id, eyes });
    this.eyesById.set(id, eyes);
    // (A model already loaded: ride on its bone now. One still loading does it when it arrives.)
    const inst = this.models.get(id);
    if (inst) eyes.rideModel(inst.object);
  }

  /** Lights' starting places, and the body each rides with. */
  private lightAt = new Map<string, { start: THREE.Matrix4; body: string | null; i: number }>();
  private lightNow = new THREE.Matrix4();

  /** Lights follow what carries them and take the changes scripts make. */
  driveLights(lighting: SceneLighting): void {
    for (const id of lighting.lights.keys()) {
      const s = this.world.lightOf(id);
      if (!s) continue;
      let at = this.lightAt.get(id);
      if (!at) {
        const body = this.world.bodyOf(id);
        this.lightAt.set(id, (at = { start: new THREE.Matrix4().fromArray(this.doc.worldMatrix(id)), body, i: body ? this.world.drawn(body) : -1 }));
      }
      let world: THREE.Matrix4 | null = null;
      let on = s.on;
      if (at.body) {
        const f = this.frame;
        if (!f.present(at.i) || !f.visible(at.i)) on = false;
        else world = this.lightNow.fromArray(f.bodyPose, at.i * POSE).multiply(at.start);
      }
      lighting.drive(id, { ...s, on }, world);
    }
  }

  /** Materials made glow by scripts: each model's own copies, with the glow they were made with. */
  private glowMats = new Map<ModelInstance, THREE.MeshStandardMaterial[]>();

  private glowMaterials(inst: ModelInstance): THREE.MeshStandardMaterial[] {
    let list = this.glowMats.get(inst);
    if (list) return list;
    list = [];
    inst.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = (m: THREE.Material) => {
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm.isMeshStandardMaterial || (!sm.emissiveMap && sm.emissive.getHex() === 0)) return m;
        const c = sm.clone();
        c.userData.glow = sm.emissiveIntensity;
        list!.push(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });
    this.glowMats.set(inst, list);
    return list;
  }

  private updateGlow(): void {
    for (const [id, from, to, k] of this.world.glowing()) {
      for (const [mid, inst] of this.models) {
        const base = mid.split('#')[0]!;
        if (mid !== id && base !== id && !this.doc.isAncestor(id, base)) continue;
        for (const m of this.glowMaterials(inst)) {
          const a = from ?? (m.userData.glow as number);
          m.emissiveIntensity = a + (to - a) * k;
        }
      }
    }
  }

  private material: (name: string) => THREE.Material;
  /** The scene being played (read only outside). */
  doc!: SceneDoc;

  // ── Models ──

  private mixers: THREE.AnimationMixer[] = [];
  /** Models whose animation moves collision meshes. */
  private carried: [string, ModelInstance][] = [];
  /** Model copies by the object that shows them (for “Play animation”). */
  readonly models = new Map<string, ModelInstance>();

  /** An object's model settings (copies made while playing use their original's). */
  private modelOf(id: string): ModelData | null {
    const e = this.doc.get(id.split('#')[0]!);
    if (!e?.components.model) return null;
    const m = readComponent<ModelData>('model', e.components.model);
    return m.model ? m : null;
  }

  /**
   * Gets an object ready to draw before it is shown (its shaders compiled in the background, so a model that
   * loads while playing doesn't hold a frame up). Set by what draws the game; by default it is shown at once.
   */
  warm: (obj: THREE.Object3D) => Promise<unknown> = () => Promise.resolve();

  private attachModel(holder: THREE.Group, data: ModelData, id: string): void {
    void modelInstance(data)
      .then(async (inst) => {
        if (this.disposed) return inst.dispose();
        await this.warm(inst.object).catch(() => {});
        if (this.disposed) return inst.dispose();
        holder.add(inst.object);
        // (Googly eyes ride on its head bone now, while it still stands in its rest pose.)
        this.eyesById.get(id)?.rideModel(inst.object);
        if (inst.mixer) this.mixers.push(inst.mixer);
        this.models.set(id, inst);
        if (inst.mixer && inst.movedParts().length) this.carried.push([id, inst]);
      })
      .catch(() => this.notes.push(`Could not load the model ${data.model}`));
  }

  // ── Sound ──

  /** Where the game is heard from (attached to the camera the game is seen through). */
  private listener: THREE.AudioListener | null = null;
  private static buffers = new Map<string, Promise<AudioBuffer>>();
  /** Sounds playing now (for following moving objects and stopping). */
  readonly sounds: { source: string; sound: string; audio: THREE.Audio | THREE.PositionalAudio; follow: string | null; followAt: number; volume: number; plain: boolean; outside: boolean; fire: boolean }[] = [];

  /** How things sound where the ears are (Sound areas, water): the effect chain every changed sound goes through. */
  stage: SoundStage | null = null;
  /** What the ears hear through now (null: not worked out yet, or no ears). */
  hearingNow: Hearing | null = null;
  /** The background sound playing now (the scene's, or the area's in its place), and ones fading out. */
  background: { key: string; sound: string; audio: THREE.Audio | null } | null = null;
  private fading: THREE.Audio[] = [];

  /** Hear the game from this camera. */
  setEars(cam: THREE.Camera): void {
    if (this.listener?.parent === cam) return;
    this.listener?.removeFromParent();
    if (!this.listener) {
      this.listener = new THREE.AudioListener();
      this.stage = new SoundStage(this.listener);
    }
    cam.add(this.listener);
  }

  private static load(sound: string): Promise<AudioBuffer> {
    let p = PlaySession.buffers.get(sound);
    if (!p) {
      p = assetUrl(sound).then((url) => new THREE.AudioLoader().loadAsync(url));
      PlaySession.buffers.set(sound, p);
      p.catch(() => PlaySession.buffers.delete(sound));
    }
    return p;
  }

  private async startSound(e: { sound: string; at: [number, number, number] | null; follow: string | null; volume: number; loop: boolean; range: number; source: string; areaEffects?: boolean }): Promise<void> {
    const listener = this.listener;
    if (!listener || this.disposed) return;
    let buffer: AudioBuffer;
    try {
      buffer = await PlaySession.load(e.sound);
    } catch {
      this.notes.push(`Could not play ${e.sound}`);
      return;
    }
    if (this.disposed) return;
    let audio: THREE.Audio | THREE.PositionalAudio;
    if (e.at || e.follow) {
      const pa = new THREE.PositionalAudio(listener);
      // Full volume within a quarter of its range, fading to silence at the range.
      pa.setDistanceModel('linear');
      pa.setRefDistance(Math.max(1, e.range / 4));
      pa.setMaxDistance(Math.max(2, e.range));
      pa.setRolloffFactor(1);
      if (e.at) pa.position.set(...e.at);
      audio = pa;
    } else audio = new THREE.Audio<GainNode>(listener);
    if (e.areaEffects === false) this.stage?.bypass(audio);
    audio.setBuffer(buffer);
    audio.setLoop(e.loop);
    audio.setVolume(e.volume);
    this.group.add(audio);
    const fireTag = this.world.base?.config.ambience.fireTag ?? '';
    const fire = !!fireTag && !!this.doc.get(e.source)?.tags.includes(fireTag);
    const entry = { source: e.source, sound: e.sound, audio, follow: e.follow, followAt: e.follow ? this.world.drawn(e.follow) : -1, volume: e.volume, plain: e.areaEffects === false, outside: false, fire };
    this.sounds.push(entry);
    // (A fire's loudness follows comfort: set on the next frame.)
    if (fire) this.comfortNow = -1;
    audio.onEnded = () => {
      // (Replacing three's own onEnded, which only does this.)
      (audio as { isPlaying: boolean }).isPlaying = false;
      this.dropSound(entry);
    };
    audio.play();
  }

  private stopSounds(source: string): void {
    for (const s of this.sounds.filter((x) => x.source === source)) {
      if (s.audio.isPlaying) s.audio.stop();
      this.dropSound(s);
    }
  }

  private dropSound(s: (typeof this.sounds)[number]): void {
    const i = this.sounds.indexOf(s);
    if (i >= 0) this.sounds.splice(i, 1);
    s.audio.removeFromParent();
    s.audio.disconnect?.();
  }

  private ears = new THREE.Vector3();
  private baseView: BaseView | null = null;
  private soundAt = new THREE.Vector3();
  private bgOutside = false;
  private comfortNow = -1;

  /** Each frame: the effect and background sound for where the ears are now. */
  private hear(): void {
    const listener = this.listener;
    if (!listener?.parent || !this.stage) return;
    const h = this.world.hearing(listener.getWorldPosition(this.ears));
    this.hearingNow = h;
    this.stage.set(h.effect, h.mix);
    if (h.room !== undefined) this.hearBase(h);
    const key = h.background ? `${h.background.sound}|${h.background.volume}` : '';
    if ((this.background?.key ?? '') === key) return;
    // Same sound, new volume: just glide to it.
    const cur = this.background;
    if (cur?.audio && h.background && cur.sound === h.background.sound) {
      ramp(listener.context, cur.audio.gain.gain, h.background.volume);
      this.background = { ...cur, key };
      return;
    }
    if (cur?.audio) this.fadeOut(cur.audio);
    this.background = h.background ? { key, sound: h.background.sound, audio: null } : null;
    if (h.background) void this.startBackground(key, h.background.sound, h.background.volume);
  }

  /**
   * Base building: in a sealed room, sounds from outside it (and the wind, the background loop) go through the
   * muffle, the wind quieter still; comfort makes music softer and the fire louder. Nothing is shown.
   */
  private hearBase(h: Hearing): void {
    const base = this.world.base!, stage = this.stage!;
    const sealed = !!h.room?.sealed;
    const cfg = base.config;
    stage.setMuffle(sealed ? cfg.seal.lowpass : 20000, sealed ? cfg.seal.outsideVolume : 1);
    if (h.background && sealed) h.background = { ...h.background, volume: h.background.volume * cfg.seal.windVolume };
    for (const s of this.sounds) {
      if (s.plain || !(s.audio instanceof THREE.PositionalAudio)) continue;
      const out = sealed && base.roomAt(s.audio.getWorldPosition(this.soundAt))?.id !== h.room!.id;
      if (out !== s.outside) {
        s.outside = out;
        stage.route(s.audio, out);
      }
    }
    if (this.background?.audio && this.bgOutside !== sealed) {
      this.bgOutside = sealed;
      stage.route(this.background.audio, sealed);
    }
    // (Comfort moves slowly, so this only changes now and then.)
    const comfort = Math.round((h.room?.comfort ?? 0) * 20) / 20;
    if (comfort === this.comfortNow) return;
    this.comfortNow = comfort;
    const ctx = this.listener!.context;
    ramp(ctx, stage.plain.gain, 1 - cfg.ambience.music * comfort, 1.5);
    const fire = 1 + cfg.ambience.fire * (comfort * 2 - 1);
    for (const s of this.sounds) if (s.fire) ramp(ctx, s.audio.gain.gain, s.volume * Math.max(0, fire), 1.5);
  }

  /** A background loop, heard everywhere, fading in. */
  private async startBackground(key: string, sound: string, volume: number): Promise<void> {
    const listener = this.listener!;
    let buffer: AudioBuffer;
    try {
      buffer = await PlaySession.load(sound);
    } catch {
      this.notes.push(`Could not play the background sound ${sound}`);
      if (this.background?.key === key) this.background = null;
      return;
    }
    // (Gone already, or another one wanted by now.)
    if (this.disposed || this.background?.key !== key) return;
    const audio = new THREE.Audio<GainNode>(listener);
    audio.name = 'background-sound';
    audio.setBuffer(buffer);
    audio.setLoop(true);
    audio.gain.gain.value = 0;
    this.group.add(audio);
    audio.play();
    ramp(listener.context, audio.gain.gain, volume);
    this.background.audio = audio;
    // (A new loop starts unmuffled: routed again on the next frame if the room is sealed.)
    this.bgOutside = false;
  }

  private fadeOut(audio: THREE.Audio): void {
    ramp(audio.context, audio.gain.gain, 0);
    this.fading.push(audio);
    setTimeout(() => this.dropBackground(audio), FADE_MS);
  }

  private dropBackground(audio: THREE.Audio): void {
    const i = this.fading.indexOf(audio);
    if (i >= 0) this.fading.splice(i, 1);
    if (audio.isPlaying) audio.stop();
    audio.removeFromParent();
    audio.disconnect();
  }

  private disposed = false;
  private body: THREE.Group | null = null;

  /** The player's body for the third-person camera: a capsule with a visor showing where they face. */
  private makeBody(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fb04a, roughness: 0.6 });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(15, 40, 6, 16), mat);
    capsule.position.y = 35;
    capsule.castShadow = true;
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
      const m = buildMesh(brushes, { wearRing: WEAR_RING });
      obj = new THREE.Mesh(toGeometry(m), m.groups.map((g) => this.material(g.material)));
    } else {
      // A point object with a collision shape: draw its model if it has one, else the shape, placed like the
      // entity (scale in the shape).
      // (A model colliding by its own mesh has no collision shape, only where it started.)
      const poster = this.world.posterOf(b.id);
      if (poster) {
        // A poster or painting: rolled or flat, as the world says it is now.
        const holder = new THREE.Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.fromArray(poster.matrix);
        this.group.add(holder);
        const view = buildPoster(poster.data);
        holder.add(view.object);
        this.posterViews.push({ id: b.id, view, hung: null });
        this.movers.push({ id: b.id, i: this.world.drawn(b.id), obj: holder, base: holder.matrix.clone() });
        this.eyesOn(b.id, holder, this.eyesIn(b.id, holder.matrix));
        return;
      }
      const at = this.world.pointMatrix(b.id);
      const model = this.modelOf(b.id);
      if (model && at) {
        const holder = new THREE.Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.fromArray(at);
        this.group.add(holder);
        this.movers.push({ id: b.id, i: this.world.drawn(b.id), obj: holder, base: holder.matrix.clone() });
        this.attachModel(holder, model, b.id);
        this.eyesOn(b.id, holder, this.eyesIn(b.id, holder.matrix));
        return;
      }
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
    obj.castShadow = obj.receiveShadow = true;
    this.group.add(obj);
    this.movers.push({ id: b.id, i: this.world.drawn(b.id), obj, base });
    if (b.kind !== 'brush' && b.kind !== 'unit') this.eyesOn(b.id, obj, this.eyesIn(b.id, base));
  }

  /** Where a body's own object sits in what draws the body (placed at `base`): exact for objects of the scene. */
  private eyesIn(id: string, base: THREE.Matrix4): THREE.Matrix4 {
    if (!this.doc.get(id)) return new THREE.Matrix4();
    return base.clone().invert().multiply(new THREE.Matrix4().fromArray(this.doc.worldMatrix(id)));
  }

  private motion = new THREE.Matrix4();

  /** Posters and paintings drawn, and whether each was last drawn hung. */
  private posterViews: { id: string; view: PosterObject; hung: boolean | null }[] = [];

  /** How long the world's step took in the last tick (ms). */
  stepMs = 0;

  /** This frame's picture of what is drawn (taken in `tick`, after the step). */
  private snap: FrameSnapshot | null = null;

  /** The frame's snapshot (before the first tick, taken now). */
  private get frame(): FrameSnapshot {
    return (this.snap ??= this.world.snapshot());
  }

  /** Advance the game and move what moved. Returns what happened this frame. */
  tick(dt: number): PlayFrame {
    const t0 = performance.now();
    this.world.step(dt);
    this.stepMs = performance.now() - t0;
    // (One picture of what is drawn this frame: everything below reads it, not the world object by object.)
    this.snap = this.world.snapshot();
    this.effects.syncProjectiles(this.world.projectilesNow());
    this.placeNpcs();
    this.updateGlow();
    this.emit(dt);
    this.effects.tick(dt);
    const changes = this.world.drainChanges();
    for (const b of changes.spawned) this.addMover(b);
    if (changes.removed.length) {
      const gone = new Set(changes.removed);
      for (const m of this.movers.filter((m) => gone.has(m.id))) {
        this.group.remove(m.obj);
        if (m.obj instanceof THREE.Mesh) m.obj.geometry.dispose();
      }
      this.movers = this.movers.filter((m) => !gone.has(m.id));
      for (const p of this.posterViews) if (gone.has(p.id)) p.view.dispose();
      this.posterViews = this.posterViews.filter((p) => !gone.has(p.id));
      for (const x of this.eyes) if (gone.has(x.id)) {
        x.eyes.dispose();
        this.eyesById.delete(x.id);
      }
      this.eyes = this.eyes.filter((x) => !gone.has(x.id));
    }
    const motion = this.motion;
    const f = this.frame;
    for (const m of this.movers) {
      m.obj.visible = f.visible(m.i);
      // (Drawn between the last two physics steps, as the player's view is: smooth at any frame rate.)
      if (!f.present(m.i)) continue;
      m.obj.matrix.copy(motion.fromArray(f.bodyPose, m.i * POSE).multiply(m.base));
      m.obj.matrixWorldNeedsUpdate = true;
    }
    for (const p of this.posterViews) {
      const hung = this.world.posterHung(p.id);
      if (hung === null || hung === p.hung) continue;
      p.hung = hung;
      p.view.setHung(hung);
    }
    if (this.world.signVersion !== this.signVersion) {
      this.signVersion = this.world.signVersion;
      for (const [id, s] of this.signs) {
        const text = this.world.signText(id) ?? s.data.text;
        if (text === s.data.text) continue;
        s.data = { ...s.data, text };
        // (Drawn again in place: the same material, so nothing compiles.)
        s.sign.retext(text);
      }
    }
    if (this.baseView) this.baseView.sync(this.world.base!);
    for (const m of this.mixers) m.update(dt);
    for (const [id, inst] of this.carried) for (const p of inst.movedParts()) this.world.movePart(id, p.part, p.d);
    // Googly eyes' pupils roll about as their objects moved this frame.
    for (const { eyes } of this.eyes) eyes.update(dt);
    this.hear();
    // Sounds that travel with a moving object.
    for (const s of this.sounds) {
      if (!s.follow || !f.present(s.followAt)) continue;
      const a = s.followAt * AT;
      s.audio.position.set(f.bodyAt[a]!, f.bodyAt[a + 1]!, f.bodyAt[a + 2]!);
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

  /** What is kept between sessions now (null: nothing). */
  progress(): SavedProgress | null {
    return this.world.progress();
  }

  /** Save the game now (the save menu, when scripts allow it). */
  saveNow(): void {
    this.world.saveNow();
  }

  /** Scripts blocked saving and loading. */
  get savingBlocked(): boolean {
    return this.world.savingBlocked;
  }

  /** What the screen UI shows now. */
  uiState(): UiState {
    return this.world.uiState();
  }

  /** The player clicked a button on screen. */
  clickUi(id: string): void {
    this.world.clickUi(id);
  }

  /** The player picked a row of a list on screen. */
  pickRow(list: string, row: string): void {
    this.world.pickRow(list, row);
  }

  /** The player pressed a key the game doesn't use itself. */
  pressKey(code: string): void {
    this.world.pressKey(code);
  }

  /** The player clicked with the item in their hand. */
  useItem(): void {
    this.world.useItem();
  }

  /** Pick a hotbar slot (0-based), or move along by `by` slots. */
  selectSlot(slot: number): void {
    this.world.selectSlot(slot);
  }

  /** For tests: give the player items as a script would. */
  giveItem(name: string, n: number): void {
    this.world.giveItem(name, n);
  }

  /** What E (or a click with a plan) would do at the base now, for the HUD (null: nothing). */
  buildPrompt(): BuildPrompt | null {
    return this.world.buildPrompt();
  }

  /** What pressing Use would do now (see GameWorld.usePrompt). */
  usePrompt(): string | null {
    return this.world.usePrompt();
  }

  /** Keys that do something at what the player holds or looks at, with their prompts. */
  keyPrompts(): { key: string; prompt: string }[] {
    return this.world.keyPrompts();
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

  /** The day count. */
  get day(): number {
    return this.world.day;
  }
  /** The time of day (hours). */
  get dayHour(): number {
    return this.world.dayHour;
  }

  /** What the player holds (an object id), or null. */
  get holding(): string | null {
    return this.world.holding;
  }

  rotateHeld(dx: number, dy: number): void {
    this.world.rotateHeld(dx, dy);
  }

  private effects: Effects;
  private missingAnims = new Set<string>();
  private npcViews = new Map<string, { holder: THREE.Group; inner: THREE.Group; figure: boolean }>();

  /** Creatures where they are now; plain figures lie down when dead (models play their dying animation). */
  private placeNpcs(): void {
    const f = this.frame;
    for (let i = 0; i < f.npcCount; i++) {
      const v = this.npcViews.get(f.npcIds[i]!);
      if (!v) continue;
      const k = i * NPC, p = f.npcPose;
      v.holder.position.set(p[k]!, p[k + 1]!, p[k + 2]!);
      v.holder.rotation.set(0, p[k + 3]!, 0);
      if (v.figure && !f.npcAlive[i]) {
        // (Falls backwards, away from where it was facing.)
        v.inner.rotation.x = Math.min(Math.PI / 2, v.inner.rotation.x + 0.12);
        v.inner.position.y = 10;
      }
    }
  }
  private emitters: { data: ParticlesData; holder: THREE.Group; body: string | null; bodyAt: number; owed: number }[] = [];

  private emitAt = new THREE.Vector3();
  private emitQ = new THREE.Quaternion();
  private emitS = new THREE.Vector3();
  private emitDir = new THREE.Vector3();

  /** Emitters put out their particles for this frame (where they are now, if on and shown). */
  private emit(dt: number): void {
    const at = this.emitAt, q = this.emitQ, s = this.emitS;
    for (const em of this.emitters) {
      const on = em.body ? (this.world.switchedOn(em.body) ?? em.data.on) && this.frame.visible(em.bodyAt) : em.data.on;
      if (!on || em.data.rate <= 0) continue;
      em.owed += em.data.rate * dt;
      const n = Math.floor(em.owed);
      if (!n) continue;
      em.owed -= n;
      em.holder.updateMatrixWorld();
      em.holder.matrixWorld.decompose(at, q, s);
      const d = EMITTER_DEFAULTS[em.data.kind] ?? EMITTER_DEFAULTS.smoke;
      this.effects.particles.burst(
        // (A burst's place and direction are copied into each particle.)
        { kind: em.data.kind, at, dir: this.emitDir.set(0, 1, 0).applyQuaternion(q), spread: d.spread, speed: d.speed * em.data.speed, size: d.size * em.data.size, life: d.life },
        Math.min(n, 50),
      );
    }
  }

  private bounds = new THREE.Box3();
  private boundsBox = new THREE.Box3();
  private boundsNow = new THREE.Box3();
  private boundsCalls = 0;

  /**
   * The extent of what stays put (for the sun's shadows). Measured about once a second (models and batches load
   * in), and never from what moves: a crate falling off the edge, a creature or a blast must not make the lights
   * be built again, which would make their shadow maps again.
   */
  levelBounds(): THREE.Box3 {
    if (this.boundsCalls++ % 60) return this.bounds;
    const moving = new Set<THREE.Object3D>(this.movers.map((m) => m.obj));
    for (const v of this.npcViews.values()) moving.add(v.holder);
    moving.add(this.effects.group);
    if (this.body) moving.add(this.body);
    const now = this.boundsNow.makeEmpty();
    for (const o of this.group.children) if (!moving.has(o)) now.union(this.boundsBox.setFromObject(o));
    // (Taken only when it grew by more than a little: each new extent builds the lights and their shadow maps again.)
    if (this.bounds.isEmpty() || !this.boundsBox.copy(this.bounds).expandByScalar(64).containsBox(now)) this.bounds.copy(now);
    return this.bounds;
  }

  /** What draws the moving object `id` is part of (null: it doesn't move, or it isn't an object). */
  private moverObject(id: string | null): THREE.Object3D | null {
    if (!id || id === 'player') return null;
    const body = this.world.bodyOf(id);
    return (body && this.movers.find((m) => m.id === body)?.obj) || null;
  }
  private waterFog: { key: string; fog: THREE.Fog; color: THREE.Color } | null = null;

  /** With the camera under water: the water's colour all round, and only as far as it is clear. */
  applyWater(scene: THREE.Scene, cam: THREE.Camera): void {
    const w = this.world.waterAt(cam.position);
    // (The sky isn't fogged: under water it is hidden.)
    const sky = scene.getObjectByName('sky');
    if (sky) sky.visible = !w;
    if (!w) return;
    const key = `${w.tint}/${w.clearness}`;
    if (this.waterFog?.key !== key) this.waterFog = { key, fog: new THREE.Fog(w.tint, 0, w.clearness), color: new THREE.Color(w.tint) };
    scene.fog = this.waterFog.fog;
    scene.background = this.waterFog.color;
  }

  /** A level change that has begun (the next scene should start from it), or null. */
  get travel(): Travel | null {
    return this.world.travel;
  }

  /** The camera's own field of view, which the effects below widen from. */
  private baseFov: number | null = null;
  private fovKick = 0;
  private fovAt = 0;
  private fovCam: THREE.PerspectiveCamera | null = null;

  /** Give the camera back its own field of view (it outlives this session). */
  private restoreFov(): void {
    const c = this.fovCam;
    if (c && this.baseFov !== null && c.fov !== this.baseFov) {
      c.fov = this.baseFov;
      c.updateProjectionMatrix();
    }
    this.fovCam = null;
    this.fovKick = 0;
    this.fovAt = 0;
  }

  /**
   * Field-of-view effects: the view widens while sprinting and on long falls, easing in and out
   * (framerate-independent).
   */
  private easeFov(cam: THREE.PerspectiveCamera, f: FrameSnapshot): void {
    if (this.fovCam !== cam) {
      this.restoreFov();
      this.fovCam = cam;
      this.baseFov = cam.fov;
    }
    const now = performance.now();
    const dt = this.fovAt ? Math.min(0.1, (now - this.fovAt) / 1000) : 0;
    this.fovAt = now;
    const fall = THREE.MathUtils.clamp((f.fallSpeed - 400) / 500, 0, 1);
    const target = (f.sprinting ? FOV.sprint : 0) + fall * FOV.fall;
    const rate = target > this.fovKick ? FOV.easeIn : FOV.easeOut;
    this.fovKick += (target - this.fovKick) * (1 - Math.exp(-rate * dt));
    const fov = this.baseFov! + this.fovKick;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Place a camera at the player's eyes. Returns false when there is no player. */
  placeCamera(cam: THREE.PerspectiveCamera): boolean {
    const f = this.frame;
    if (!f.hasView) return false;
    const v = f.view;
    cam.position.set(v[0]!, v[1]!, v[2]!);
    cam.rotation.set(v[4]!, v[3]!, 0, 'YXZ');
    cam.updateMatrixWorld();
    this.easeFov(cam, f);
    // Third person: the player is seen, as a simple body turned the way they look.
    if (f.thirdPerson) {
      this.body ??= this.makeBody();
      this.body.visible = true;
      this.body.position.set(v[5]!, v[6]!, v[7]!);
      this.body.rotation.set(0, v[3]!, 0);
      this.body.scale.set(1, f.crouched ? 0.5 : 1, 1);
    } else if (this.body) this.body.visible = false;
    return true;
  }

  activeBlocks(): Map<string, string[]> {
    return this.world.activeBlocks();
  }

  get time(): number {
    return this.world.time;
  }

  dispose(): void {
    this.disposed = true;
    this.restoreFov();
    this.baseView?.dispose();
    this.effects.dispose();
    this.foliage.dispose();
    this.terrains.dispose();
    this.plants.dispose();
    this.batches.dispose();
    for (const m of this.models.values()) m.dispose();
    for (const list of this.glowMats.values()) for (const m of list) m.dispose();
    for (const s of [...this.sounds]) {
      if (s.audio.isPlaying) s.audio.stop();
      this.dropSound(s);
    }
    if (this.background?.audio) this.dropBackground(this.background.audio);
    for (const a of [...this.fading]) this.dropBackground(a);
    this.background = null;
    this.stage?.dispose();
    this.listener?.removeFromParent();
    this.world.dispose();
    for (const s of this.signs.values()) s.sign.dispose();
    for (const p of this.posterViews) p.view.dispose();
    for (const { eyes } of this.eyes) eyes.dispose();
    this.group.traverse((o) => {
      // (Googly eyes share one dome.)
      if (o instanceof THREE.Mesh && o.name !== 'sign' && o.name !== 'googly-eye') o.geometry.dispose();
    });
    this.shapeMat.dispose();
  }
}

/** How long a background sound takes to fade out before it's stopped (ms, a little over the fade). */
const FADE_MS = 400;

/** A plain creature: a capsule 32 × 72 with a dark visor showing which way it faces (−Z). */
function npcFigure(side: string): THREE.Object3D {
  const color = side === 'friendly' ? 0x5a84b6 : side === 'neutral' ? 0x9a9a92 : 0xb4574c;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(16, 40, 6, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  body.position.y = 36;
  body.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.3 }));
  visor.position.set(0, 60, -14);
  g.add(body, visor);
  return g;
}
