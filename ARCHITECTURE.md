# CocoaWorlds Architecture

> **Status: approved 2026-11-01.** Every decision below (D1–D12) is signed off; see [DECISIONS.md](DECISIONS.md). Implementation starts in Phase 2. Changes to an approved decision are proposed and approved again before they are made.

## 1. The shape of the system

CocoaWorlds is two products that share an engine:

- **The editor** — a desktop application where games are made.
- **The runtime** — the engine that plays a game. It runs inside the editor during Play, and on its own inside every exported game.

The runtime never imports editor code. The editor depends on the runtime, never the reverse.

```
                    ┌──────────────────────── Editor app (Electron) ────────────────────────┐
                    │  main process (Node)            renderer process (Chromium)           │
                    │  ─ project files, autosave      ─ editor UI (React + CocoaCanvas CSS) │
                    │  ─ asset import (workers)       ─ viewport (engine in "edit" mode)    │
                    │  ─ build pipeline               ─ Play mode (engine in "play" mode)   │
                    └───────────────▲─────────────────────────────▲─────────────────────────┘
                                    │ typed IPC                   │ imports
┌──────────────────────────── packages (TypeScript monorepo) ─────┴─────────────────────────┐
│ @cocoaworlds/core      math, ids, events, scheduling, serialization schemas + migrations   │
│ @cocoaworlds/geometry  convex brushes, carve/CSG, mesh + collision generation (worker-safe) │
│ @cocoaworlds/scripting block/graph model, compiler → IR, VM with step limits, debugger API │
│ @cocoaworlds/engine    world, entities, components, systems, render/physics/audio adapters │
│ @cocoaworlds/runtime   boots a built game: loader, input, scene switching, platform shims  │
│ @cocoaworlds/ui        CocoaCanvas tokens + components (editor only)                       │
└────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │ build pipeline packages runtime + game data
              ┌─────────────────────┴───────────────────┐
     Desktop game (Electron runtime shell,         Web game (static folder:
     no editor code, no Node in the page)          runtime bundle + data + wasm)
```

## 2. Choices

### D1. Desktop framework — **Electron**

| | Electron | Tauri 2 |
|---|---|---|
| Rendering engine | Same Chromium on Windows, macOS, Linux | System WebView: WebView2 (Chromium), WKWebView (WebKit), WebKitGTK |
| WebGL2 / WebGPU | Identical everywhere; WebGPU available | Differs per OS; WebKitGTK on Linux is the weakest GPU path |
| Backend language | Node.js (TypeScript end to end) | Rust (second language in the codebase) |
| App size | ~85 MB+ | ~5–15 MB |
| Security model | Must be configured: context isolation, sandbox, no Node in renderer | Capability allow-list by default |

A 3D engine lives or dies on GPU behaviour, and the user's games must look the same on all three systems. Electron removes a whole class of "works on Windows, broken on Linux" bugs and keeps the stack in one language. The size cost is real but acceptable for a development tool. Security is handled by running the renderer sandboxed with context isolation and exposing only a narrow, typed `window.cocoa` API from a preload script.

### D2. Rendering — **Three.js behind a thin adapter**

- Three.js (MIT, r187): lightweight, huge ecosystem, glTF loader, PBR materials, shadows, `BatchedMesh`/instancing, and a WebGPU renderer that falls back to WebGL2.
- Babylon.js (Apache-2.0, v9): more engine-like out of the box (its own scene graph, physics plugins, inspector), heavier, and its scene model would compete with ours.

CocoaWorlds owns the scene; the renderer only draws it. Engine code talks to a small `RenderAdapter` (create mesh, update transform, set material, lights, camera, debug lines), and only `engine/render-three` imports Three.js. Start on the WebGL2 path for predictability; WebGPU becomes an option later.

### D3. Geometry — **Convex brushes as planes, with real carve CSG**

How Hammer-style editing actually works, and what CocoaWorlds does:

- **A brush is a convex solid stored as a set of planes**, each plane carrying its face data (material, UV axes, scale, offset, rotation). Vertices, edges and faces are *derived* from the planes, so a brush is always valid and closed.
- **Editing** (move, scale, vertex drag, clip) edits planes or rebuilds them from moved vertices, then re-validates convexity.
- **Subtract (carve)** splits the target brush by each plane of the cutter, keeps the pieces outside the cutter, and discards the inside. Each piece is itself a convex brush that keeps the original face materials and UVs. Result: a real doorway made of editable brushes, not a hidden mesh trick.
- **Union / merge** joins brushes when their combined hull is convex; otherwise they stay as a group. **Intersect** keeps the inside pieces.
- **Render mesh** = all brush faces, minus faces hidden by touching solid brushes, batched per material. Rebuilt per changed region in a worker.
- **Collision** = each brush is already a convex hull, which physics engines handle natively and fast.
- **Spatial index** = a BVH over brushes and entities for picking, culling and queries. We do not need a legacy BSP compiler or visibility (PVS) pass; modern GPUs plus frustum culling cover the levels CocoaWorlds targets. A compiled "baked" level format is still produced at build time (merged meshes, collision, lightmaps later).
- **Numerics:** plane-based math with a fixed epsilon, snapping vertices to a 1/32-unit grid after every operation, and rejecting degenerate (sliver) pieces.

Generic mesh CSG libraries were considered and rejected for brushes: `three-bvh-csg` describes itself as experimental and its output may not be watertight; Manifold (Apache-2.0) is robust but produces triangle meshes, losing editable brush structure. Manifold remains a candidate later for booleans on imported models.

**G3 (approved during Phase 4):** transforms nest. Entity transforms are relative to the parent, and brush faces are stored in the parent's space (see docs/geometry.md, "Spaces"). Scene format 2; format-1 scenes are upgraded on open.

### D4. Physics — **Rapier (3D, WASM)**

Rapier (`@dimforge/rapier3d-compat` 0.21, Apache-2.0) is fast, actively maintained, runs in browsers and Electron, supports convex hulls, sensors (triggers), shape casts and collision groups. Ammo.js (Bullet port) is older, larger and less maintained. Jolt (WASM build) is a strong alternative with heavier integration.

The player controller is **ours**, not Rapier's built-in one: a Source-style move loop (friction → wish direction → ground/air acceleration with the classic air-speed cap → slide-and-step against the world using Rapier shape casts). That is the only way to get real air strafing and momentum feel.

### D5. Entities and components — **entities with plain-data components, systems that run each frame**

- Entity = id, name, transform, parent, tags, layer, scene. Components = plain serializable data (`Light`, `Collider`, `Trigger`, `Door`, `Health`, `Script`, …).
- Systems (Physics, Triggers, Doors, Scripts, Audio, Render sync) iterate the components they care about.
- Brushes are entities with a `Brush` component, so a door can be brush-built.
- Prefabs: a prefab file holds an entity tree. Editing the prefab updates every instance except overridden fields; "Apply" and "Revert" per field. **Amended by P1:** instances are stored in full with the list of fields they changed, so scenes don't depend on prefab files (see docs/prefabs.md).

### D6. Visual scripting — **Blocks first, one script model underneath** 

- Users write **plain-language blocks** ("When the player enters Doorway → If Main door is locked → Show message … Otherwise → Open Main door").
- Blocks and the optional advanced graph are two views of **one script model**, so a script can be opened in either.
- On save and on Play, scripts are **compiled to a small typed intermediate representation (IR)**, validated (types, missing references), and **run by an interpreter (VM)** in the runtime.
- Long actions ("Wait 1.5 seconds", "Open door") suspend the script and resume later, so users never deal with callbacks.
- Safety: per-tick step budget, loop iteration limits, recursion depth limit; a runaway script is stopped and reported, the game keeps running.
- Debugging comes from the VM: highlight the running block, watch values, breakpoints, step.

Why not compile to JavaScript: generated JS is faster but harder to debug block-by-block, harder to limit, and it would mean evaluating code at runtime. An IR + VM is fast enough for gameplay logic and keeps debugging and safety simple. A later optimisation can compile hot IR to JS without changing the user-facing model.

### D7. Runtime and Play mode

- **Play in editor:** the current scene is serialized, and a fresh runtime `World` is built from that snapshot in the same window. The editor's scene is untouched; Stop throws the play world away. "Apply to editor" copies chosen values back deliberately.
- **Play as built:** optionally launch the real standalone runtime in its own window from a quick dev build, to test exactly what players get.

### D8. Project format — **a normal folder of JSON files**

```
MyGame/
  project.cwproj            name, version, settings, start scene, schema version
  scenes/level_01.cwscene   JSON: entities, components, brushes
  scripts/door.cwscript     JSON script model (blocks/graph)
  prefabs/door.cwprefab
  assets/…                  original files (png, glb, ogg) + .meta sidecars (stable id, import settings)
  .cocoaworlds/             caches, autosaves, recovery (safe to delete, not committed to git)
```

- Every file carries `schemaVersion`; migrations upgrade old files on open and keep a backup of the original.
- References use stable ids from `.meta` files, so moving or renaming an asset does not break scenes.
- Saving writes to a temp file then renames (atomic). Autosave goes to `.cocoaworlds/autosave/`, and recovery is offered after a crash, never applied silently.
- Text JSON keeps projects diff-friendly and git-friendly.

### D9. Desktop export — **Electron runtime shell, packaged per platform**

- The build pipeline bundles `@cocoaworlds/runtime` and the baked game data into a minimal Electron app with no editor code and no Node access in the page, then packages it with electron-builder: Windows `.exe` (NSIS or portable), Linux AppImage, macOS `.app`/`.dmg`.
- Honest limits: macOS signing/notarization needs a Mac and an Apple Developer ID; unsigned Windows builds trigger SmartScreen warnings; each exported game is ~100 MB because it carries Chromium.
- Alternative to evaluate later: a Tauri-based runtime shell for much smaller games, at the cost of per-OS WebView differences.

### D10. Web export — **static folder from the same runtime package**

The same runtime is bundled for browsers (Vite), plus game data and Rapier's WASM, into a folder that can be hosted anywhere. Platform shims replace file-system loading with fetch. Limits: browser autoplay rules for audio, pointer lock requires a click, larger levels load over the network.

### D11. Custom code scripting — **deferred**

No user JavaScript in v1. When added, scripts run in a Worker with a capability API (entities, math, events) and no file system or network access, under the same step limits as the VM.

### D12. Editor UI stack — **React + TypeScript + Zustand, styled with copied CocoaCanvas CSS**

CocoaCanvas ships as one vanilla JS file, so its components cannot be imported. The CocoaCanvas stylesheet tokens and class rules are copied into `@cocoaworlds/ui` and wrapped as typed components. React handles the far more complex panel state of a 3D editor; Zustand holds editor state; all scene edits go through a command bus (`do`/`undo`) so every change is undoable. Vite builds the renderer; Vitest and Playwright test it.

## 3. How a change flows

1. User drags a brush face → viewport tool emits `ResizeBrush` command → command applies to the editor scene model and records its inverse.
2. Scene model notifies → geometry worker rebuilds that brush's mesh and hull → render adapter swaps buffers; physics (in edit mode) updates the collider for picking.
3. Debounced autosave writes the scene JSON to `.cocoaworlds/autosave/`.

## 4. Repository layout

Built so far:

```
apps/editor          Electron main (src/main), preload bridge (src/preload), React UI (src/renderer)
packages/core        ids, math, file formats, validation, migrations, History, SceneDoc + commands
packages/geometry    convex brushes, primitives, carve/intersect/merge, vertex editing, mesh + hull output (docs/geometry.md)
packages/scripting   visual scripting: block model, checker, compiler to IR, VM (docs/scripting.md)
packages/runtime     the game world: Rapier physics built from a scene, fixed-step simulation, trigger events (no rendering)
packages/materials   Cocoa Materials: graph model, node set, GLSL per node, GPU evaluator (docs/materials.md)
packages/ui          CocoaCanvas tokens (styles.css) and React components
```

Implementation notes:

- **Coordinates:** Y-up, right-handed (same as glTF, Three.js and Rapier). Rotations are stored as degrees in YXZ order. Default grid 16 units; a standing player is 72 units.
- **Editor overlays use Three.js directly** (grid shader, gizmo, markers, camera rig) because they exist only in the editor. Game content will be drawn through the `RenderAdapter` in `@cocoaworlds/engine` when that package arrives (Phase 3–4), so the runtime stays renderer-agnostic.
- **The UI never touches the file system.** All disk access is in `apps/editor/src/main/project-fs.ts`, which only accepts paths inside the open project.
- **On-demand rendering:** the viewport draws a frame only after something changes, so an idle editor uses no GPU time (Play mode draws every frame).
- **Components** are defined once in `packages/core/src/components.ts` (fields, defaults, labels, what they attach to). The Inspector draws from it and the runtime reads data through `readComponent`, which fills defaults.
- **Physics units:** the world runs in game units (1 u ≈ 1 inch); Rapier's `lengthUnit` is 39.37 so its tolerances match. Gravity comes from the scene settings (800 u/s²).
- **Security:** the renderer's CSP allows `wasm-unsafe-eval` so Rapier's WebAssembly can compile; JavaScript `eval` stays blocked. Physics loads on the first Play, in its own chunk.

Full planned layout:

```
apps/editor          Electron main + preload + renderer (React)
apps/player          Electron shell template for exported games
packages/core | geometry | scripting | engine | runtime | ui
examples/facility-demo
docs/                deeper design notes per system
```
