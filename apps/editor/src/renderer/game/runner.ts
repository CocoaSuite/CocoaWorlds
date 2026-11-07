/**
 * An exported game (B4): one scene played full-window, with the same game code, controls, display and screen
 * UI as Play in the editor. Saved progress is kept in this browser's storage (a desktop game has its own).
 */
import { SceneReflections, sceneProbes } from '../viewport/reflections';
import { GroundBlend } from '../viewport/ground-blend';
import { SceneDoc, expandRepeats, type GameRules, type GameValue, type MaterialDef, type PlantDef, type SceneFile } from '@cocoaworlds/core';
import { isInvisibleMaterial } from '@cocoaworlds/geometry';
import * as THREE from 'three';
import { brushBounds } from '../brush/brushes';
import { PlaySession } from '../viewport/play-session';
import { AoRenderer } from '../viewport/ao';
import { glassCastsNoShadow } from '../viewport/glass-shadows';
import type { Travel } from '@cocoaworlds/runtime';
import { SceneLighting } from '../viewport/scene-lighting';
import { setProjectMaterials, tickMaterials } from '../viewport/project-materials';
import { setProjectPlants } from '../viewport/plants';
import { sceneMaterial } from '../viewport/world-render';
import { hudOf, type Hud } from '../ui/Hud';
import { GAME_KEYS, inputFromKeys, isScriptKey, lookFromMouse } from './controls';
import { loadProgress, storeProgress } from './progress';

/** What an export writes to `game/game.json`. */
export interface GameData {
  format: 'cocoaworlds.game';
  /** The game's name (the window title) and its project's id (the key its saved progress is kept under). */
  name: string;
  id: string;
  scene: SceneFile;
  rules: GameRules;
  values: GameValue[];
  /** The project's materials (older exports have none). */
  materials?: MaterialDef[];
  /** The project's plants the game uses. */
  plants?: PlantDef[];
  /** Every scene by name, for level changes (older exports have only `scene`), and the start scene's name. */
  scenes?: Record<string, SceneFile>;
  start?: string;
}

export interface RunnerEvents {
  hud(hud: Hud): void;
  /** The mouse is captured (playing), or free (“Click to play”). */
  lock(locked: boolean): void;
  /** A screen freed the mouse for its buttons. */
  uiMouse(free: boolean): void;
  /** A level change brought the player into another scene (its screens replace the last one's). */
  scene?(scene: SceneFile): void;
}

export class GameRunner {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(74, 1, 2, 65536);
  private lighting = new SceneLighting();
  private doc: SceneDoc;
  private play: PlaySession | null = null;
  private ao: AoRenderer | null = null;
  private groundBlend: GroundBlend | null = null;
  private reflections: SceneReflections | null = null;
  private lightSeen = 0;
  private probesFor: PlaySession | null = null;
  private materials = new Map<string, THREE.Material>();
  private keys = new Set<string>();
  private raf = 0;
  private last = performance.now();
  private hudKey = '';
  private savedKey = '';
  private saveTimer = 0;
  private uiFree = false;
  private uiPaused = false;
  private resizeObs: ResizeObserver;
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private data: GameData,
    private cb: RunnerEvents,
  ) {
    this.doc = new SceneDoc(expandRepeats(structuredClone(data.scene), brushBounds));
    this.current = data.scene;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setClearColor(0x1f1f1f);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    glassCastsNoShadow(r);
    r.transmissionResolutionScale = 0.5;
    r.domElement.className = 'cw-canvas';
    r.domElement.tabIndex = 0;
    r.domElement.setAttribute('aria-label', data.name);
    host.prepend(r.domElement);
    this.renderer = r;
    this.scene.add(this.lighting.group);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.bind();
  }

  private hidden = new THREE.MeshBasicMaterial({ visible: false });
  /** The Three.js material for a face material (shared by every scene of the game). */
  private materialFor = (name: string): THREE.Material => {
    let m = this.materials.get(name);
    if (!m) {
      m = isInvisibleMaterial(name) ? this.hidden : sceneMaterial(name, () => {});
      this.materials.set(name, m);
    }
    return m;
  };

  /** Load the game (physics, models) and start it. */
  async start(): Promise<void> {
    setProjectMaterials(this.data.materials ?? []);
    setProjectPlants(this.data.plants ?? []);
    await this.begin();
    this.lockPointer();
  }

  /** Start (or start again) from what is saved: a game that keeps the world goes on in the scene it was saved in. */
  private async begin(): Promise<void> {
    const saved = loadProgress(this.data.id);
    const resume = this.data.rules.saveWorld && saved?.scene ? this.data.scenes?.[saved.scene] : undefined;
    const scene = resume ?? this.current;
    if (scene !== this.current) {
      this.current = scene;
      this.doc = new SceneDoc(expandRepeats(structuredClone(scene), brushBounds));
      this.cb.scene?.(scene);
    }
    const play = await PlaySession.start(scene, this.materialFor, this.data.rules, this.data.values, saved);
    if (this.disposed) return play.dispose();
    this.play = play;
    play.setEars(this.cam);
    this.scene.add(play.group);
    this.savedKey = JSON.stringify(play.progress());
    this.last = performance.now();
    this.loop();
  }

  /** The save menu: save now (false: scripts block it). */
  saveGame(): boolean {
    const play = this.play;
    if (!play || play.savingBlocked || this.going) return false;
    play.saveNow();
    this.saveProgress();
    return true;
  }

  /** The save menu: back to the save (false: blocked, or there is none). */
  async loadGame(): Promise<boolean> {
    const play = this.play;
    if (!play || play.savingBlocked || this.going || !loadProgress(this.data.id)) return false;
    this.going = true;
    cancelAnimationFrame(this.raf);
    this.scene.remove(play.group);
    play.dispose();
    this.play = null;
    this.keys.clear();
    await this.begin();
    this.going = false;
    if (this.play) this.send();
    return true;
  }

  /** When the save was made (ms since 1970), or null. */
  get savedAt(): number | null {
    const p = loadProgress(this.data.id);
    return p ? (p.at ?? 0) || null : null;
  }

  get locked(): boolean {
    return document.pointerLockElement === this.renderer.domElement;
  }

  /** “Click to play” (or back from the pause Esc gave a menu). */
  capture(): void {
    if (this.uiFree) {
      if (this.uiPaused) {
        this.uiPaused = false;
        this.cb.uiMouse(true);
      }
      return;
    }
    this.lockPointer();
  }

  clickUi(id: string): void {
    this.play?.clickUi(id);
  }

  pickRow(list: string, row: string): void {
    this.play?.pickRow(list, row);
  }

  private lockPointer(): void {
    this.dropLock = false;
    const el = this.renderer.domElement;
    el.focus();
    try {
      const p = el.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* needs a click first */
    }
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed || !this.play) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const play = this.play;
    play.tick(dt);
    tickMaterials(now);
    const hud = hudOf(play, this.locked);
    this.followUiMouse(hud.ui.freesMouse);
    const key = JSON.stringify(hud);
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.cb.hud(hud);
    }
    // Saved progress: written when it changes (at most twice a second).
    if (now > this.saveTimer) {
      this.saveTimer = now + 500;
      this.saveProgress();
    }
    // (The game's scene never changes: the lights are built again only if what stays put grew.)
    this.lighting.update(this.doc, (id) => this.doc.worldMatrix(id), play.levelBounds(), this.scene, true);
    play.driveLights(this.lighting);
    this.lighting.setDay(play.dayHour);
    this.lighting.applyTo(this.scene);
    this.renderer.shadowMap.enabled = this.lighting.shadows;
    if (play.travel) return void this.go(play.travel);
    if (play.placeCamera(this.cam)) {
      play.applyWater(this.scene, this.cam);
      this.reflections ??= new SceneReflections(this.renderer);
      if (this.probesFor !== play) {
        this.probesFor = play;
        this.reflections.setProbes(sceneProbes(this.doc, play.levelPieces, this.doc.settings.autoProbes !== false));
      }
      // Before its first frame, every shader of the scene is compiled under its lights and reflections (shown or
      // not), and models that load later are compiled in the background before they appear: nothing compiles mid-game.
      if (this.warmed !== play) {
        this.warmed = play;
        this.reflections.prime(this.scene, this.cam.getWorldPosition(new THREE.Vector3()), play.doc.settings.reflections !== false);
        this.renderer.compile(play.group, this.cam, this.scene);
        play.warm = (o) => this.renderer.compileAsync(o, this.cam, this.scene);
      }
      // (The time of day changed the light enough: capture again, easing in.)
      if (this.lighting.dayVersion !== this.lightSeen) {
        this.lightSeen = this.lighting.dayVersion;
        this.reflections.relight();
      }
      this.reflections.update(this.scene, this.cam.getWorldPosition(new THREE.Vector3()), this.play?.doc.settings.reflections !== false);
      (this.groundBlend ??= new GroundBlend()).prepare(this.renderer, this.scene, this.cam);
      if (!(this.ao ??= new AoRenderer(this.renderer)).render(this.scene, this.cam, this.play?.doc.settings)) this.renderer.render(this.scene, this.cam);
    }
  };

  private going = false;
  /** The scene being played. */
  private current!: SceneFile;
  private warmed: PlaySession | null = null;

  /** A level change: the same game goes on in the next scene, from where the last one left the player. */
  private async go(t: Travel): Promise<void> {
    if (this.going) return;
    const next = this.data.scenes?.[t.scene];
    if (!next) {
      console.error(`There is no scene called “${t.scene}” in this game.`);
      return;
    }
    this.going = true;
    cancelAnimationFrame(this.raf);
    this.saveProgress();
    const old = this.play!;
    this.scene.remove(old.group);
    old.dispose();
    this.play = null;
    this.doc = new SceneDoc(expandRepeats(structuredClone(next), brushBounds));
    this.current = next;
    this.cb.scene?.(next);
    const play = await PlaySession.start(next, this.materialFor, this.data.rules, this.data.values, loadProgress(this.data.id), t);
    this.going = false;
    if (this.disposed) return play.dispose();
    this.play = play;
    play.setEars(this.cam);
    this.scene.add(play.group);
    this.send();
    this.last = performance.now();
    this.loop();
  }

  private saveProgress(): void {
    const p = this.play?.progress() ?? null;
    const key = JSON.stringify(p);
    if (key === this.savedKey) return;
    this.savedKey = key;
    storeProgress(this.data.id, p);
  }

  private followUiMouse(free: boolean): void {
    if (free === this.uiFree) return;
    this.uiFree = free;
    this.uiPaused = false;
    this.cb.uiMouse(free);
    if (free) {
      if (this.locked) document.exitPointerLock();
      // (A lock asked for before, still on its way, is let go of when it comes.)
      else this.dropLock = true;
    } else this.lockPointer();
  }

  /** A pointer lock asked for before a screen freed the mouse: let go of it as soon as it arrives. */
  private dropLock = false;

  private send(): void {
    this.play?.setInput(inputFromKeys(this.keys));
  }

  private onKey = (e: KeyboardEvent, down: boolean): void => {
    if (!this.play || !(this.locked || (this.uiFree && !this.uiPaused))) return;
    if (e.key === 'Escape') {
      // Captured: the browser frees the mouse itself. In a menu: pause, as that would.
      if (!this.locked && down) {
        this.uiPaused = true;
        this.keys.clear();
        this.send();
        this.cb.uiMouse(false);
      }
      return;
    }
    if (e.key === 'F11' || e.key === 'F12') return;
    e.preventDefault();
    if (down && /^Digit[1-9]$/.test(e.code)) return this.play.selectSlot(Number(e.code.slice(5)) - 1);
    // R held with something in hand: the mouse turns it instead of the view.
    if (e.code === 'KeyR' && (this.rotating || this.play.holding)) return void (this.rotating = down);
    if (!GAME_KEYS.has(e.code)) {
      if (down && !e.repeat && isScriptKey(e.code)) this.play.pressKey(e.code);
      return;
    }
    if (down && e.code === 'KeyE' && !e.repeat) this.play.use();
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    this.send();
  };

  private keyDown = (e: KeyboardEvent) => this.onKey(e, true);
  private keyUp = (e: KeyboardEvent) => this.onKey(e, false);

  private mouseMove = (e: MouseEvent): void => {
    if (!this.locked || !this.play) return;
    if (this.rotating && this.play.holding) return this.play.rotateHeld(e.movementX, e.movementY);
    const look = lookFromMouse(this.play.look, e.movementX, e.movementY);
    if (look) this.play.setInput(look);
  };

  private mouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || !this.play) return;
    if (this.locked) {
      this.play.useItem();
      this.play.setInput({ fire: true });
    }
    else if (!this.uiFree) this.lockPointer();
  };

  private wheel = (e: WheelEvent): void => {
    if (!this.locked || !this.play || !e.deltaY) return;
    e.preventDefault();
    this.play.selectSlot(this.play.uiState().slot + Math.sign(e.deltaY));
  };

  private mouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.play?.setInput({ fire: false });
  };

  private rotating = false;

  private lockChange = (): void => {
    if (this.locked && this.dropLock) {
      this.dropLock = false;
      document.exitPointerLock();
      return;
    }
    this.rotating = false;
    if (!this.locked) this.play?.setInput({ fire: false });
    if (!this.locked && !this.uiFree) {
      this.keys.clear();
      this.send();
    }
    this.cb.lock(this.locked);
  };

  private pageHide = (): void => this.saveProgress();

  private bind(): void {
    const el = this.renderer.domElement;
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    document.addEventListener('mousemove', this.mouseMove);
    el.addEventListener('mousedown', this.mouseDown);
    window.addEventListener('mouseup', this.mouseUp);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.lockChange);
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.send();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.saveProgress();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('mouseup', this.mouseUp);
    document.removeEventListener('mousemove', this.mouseMove);
    document.removeEventListener('pointerlockchange', this.lockChange);
    window.removeEventListener('pagehide', this.pageHide);
    this.resizeObs.disconnect();
    this.play?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** For tests: the running game. */
  get session(): PlaySession | null {
    return this.play;
  }
}
