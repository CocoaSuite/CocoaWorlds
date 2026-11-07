# Proposal: performance architecture

Status: **proposed** (2026-11-07), for approval. Nothing here is built except step 0 (see below), which changes
no behaviour.

## Where it stands

- One thread does everything in Play: the game world (Rapier physics, creatures and their path search, the block
  VM, triggers, weapons), then the drawing (Three.js, WebGL2). A long world step and a heavy frame add up, and
  either one stalls the other.
- The level mesh is already built in a worker (`world-worker.ts`); everything else runs on the UI thread.
- The optimisation sweep (HANDOFF item 8) removed the known hitches: shader compiles mid-game, light rebuilds,
  per-frame allocations, path searches all landing on one frame. What remains is steady cost, not spikes.
- Foliage tufts and still models that share a file are already instanced (`foliage.ts`, `model-batches.ts`);
  Plant objects are not (one mesh per plant and detail level).

Kept as decided: **Electron (D1)**, Three.js behind the render adapter (D2), Rapier (D4), the block VM (D6).

## Measure first (before step 2)

Every step below is judged by numbers, not by feel:

- A **bench scene** in `tools/` (a big brush level, 40 creatures hunting, 200 physics crates, 2,000 plants, a
  terrain of 4 tiles, blasts) and a script that plays it for 30 s in Electron (Playwright, as the e2e tests do)
  and writes frame times (median, 95th, 99th percentile, worst), world step time and draw time per frame.
- The status line gets the split: world ms, draw ms, draw calls.
- Runs on a real GPU (the e2e display is software, SwiftShader: good for "does it still work", useless for
  speed). Results go into `BENCHMARK.md` with the commit they were taken at.

## Steps, in order

### 0. One frame snapshot (started: HANDOFF item 9)

`PlaySession` reads one compact picture per frame from `GameWorld.snapshot()` instead of calling it object by
object: drawn poses of bodies (16 numbers each), where they are, shown or not, creatures (feet, yaw, alive,
health, state) and the player's view, in typed arrays with a stable index per object. Same thread, same values.

- Risk: low. A value read at a different moment than before (the snapshot is taken right after the step; the
  old calls ran a little later in the frame). Nothing changes the world between the two today.
- Tested: `packages/runtime/test/snapshot.test.ts` compares every field with the old per-object calls over steps
  of many lengths; all unit and e2e tests unchanged.

### 1. The whole frame as messages (same thread)

Everything else `PlaySession`, the HUD and the engine ask the world each frame (`hudOf`: status, UI state, key
and use prompts, game values, messages; `hearing`, `waterAt`, sign texts, light states, switched on, glow,
projectiles, `drainChanges`, events, logs, errors, active blocks, saved progress, travel) goes into one
`FrameOut` object made by the world; what goes in (input, use, keys, UI clicks, hotbar, `giveItem` for tests)
into one `FrameIn`. `PlaySession` talks to a `WorldPort` interface; the first port calls `GameWorld` directly.

- Risk: medium. It is a wide change (every per-frame read); things read rarely (prompts) cost a little more if
  they are computed every frame: compute them only when asked for in `FrameIn`.
- Tested: unit tests for the port (`FrameOut` equals what the direct calls give, as in step 0); all e2e tests.

### 2. The game world in a Web Worker

The port of step 1 posts `FrameIn` to a worker running `GameWorld` (Rapier, creatures, the VM) and gets
`FrameOut` back; the poses arrive in transferred typed arrays (two sets swapped, so nothing is copied or made each
frame). The worker steps on its own clock; the main thread draws the newest snapshot, interpolated as now.

- Risks:
  - **Input lag** of up to one frame. Mouse look is applied on the main thread at once (the view's yaw and pitch
    are the main thread's own), only movement waits for the worker.
  - **Models and terrain** the world needs (`ModelMesh`, terrain meshes, trunks) must be sent to the worker at
    start (transferred buffers), and models that load later sent when they load.
  - **Scripts that touch the screen** (sounds, UI, camera views) become messages; ordering must stay exactly as
    today (events in `FrameOut` in the order they happened).
  - **Web export** (D10): a worker works in every browser; `SharedArrayBuffer` would need cross-origin isolation
    (COOP/COEP headers) on the host, so the plan uses transfers, not shared memory.
  - Debugging is harder (two threads): a `CW_WORLD=main` switch keeps the in-thread port for tests and bugs.
- Tested: the whole e2e suite run in both modes (`CW_WORLD=main` and `worker`) until the worker is the only one
  used for a while; a protocol test in Node (`worker_threads`) that plays a scene in both ports and compares the
  `FrameOut` of every frame; the bench (step time no longer in the frame time).

### 3. Batch Plant objects and other repeated draws (instancing)

Plant objects with the same recipe, seed and detail level become one `InstancedMesh` per level per area (the way
`model-batches.ts` does models); the dissolve between levels becomes a per-instance fade attribute. Then: copies
made while playing (Repeat groups, spawned prefabs) of the same brush or model share one instanced mesh;
pooled effects and decals in one instanced mesh each.

- Risks: plants that differ only by seed don't batch (each seed is its own mesh): offer a few seeds per recipe
  as the default; per-instance wind and fade need the plant shader changed; picking in the editor must still find
  the single plant (instance id → entity).
- Tested: unit tests for grouping (same as `model-batches` tests); e2e plants and foliage tests; draw calls in
  the status line drop on the bench scene (asserted in an e2e test: N plants → at most K draws).

This step does not depend on 1–2: it can be done before them if the bench shows draw calls are the cost.

### 4. Rust → WebAssembly: navigation, then voxel meshing

- **Navigation** (`navgrid.ts`: grid measure, A*, straightening) first: it is self-contained (numbers in, numbers
  out), already uses flat typed arrays, and runs in the world (the worker after step 2).
- **Voxel meshing** (`packages/geometry/src/voxels.ts`: surface extraction, seams, `stitchTiles`) next: it runs
  on terrain strokes in the editor and on load in Play.
- Each keeps the TypeScript version until the Rust one has matched it for a while; a switch picks one.
- Risks:
  - A new toolchain (Rust, `wasm-bindgen`/`wasm-pack`) in the build and in every session; crates must come from a
    registry that is reachable (the last sessions had none). The `.wasm` files are built and committed so a build
    without Rust still works.
  - Floating point: Rust and JS give the same results for the same operations in the same order, but a rewrite
    that reorders sums gives slightly different paths or vertices. Tests compare with a tolerance where order
    can differ, exactly where not.
  - Crossing into WASM costs: calls are made per search or per stroke, never per cell; memory is shared through
    typed-array views of WASM memory (careful: views break when WASM memory grows).
  - Gains may be small: V8 already runs typed-array code well. Measured on the bench before committing to the
    next one.
- Tested: Rust unit tests (`cargo test`); the existing `nav.test.ts`, `npc.test.ts`, `hunter.test.ts`,
  `smooth.test.ts` and `voxel-tiles.test.ts` run against both versions (a test matrix), plus a side-by-side test
  on random grids and strokes (same paths, same meshes); e2e navigation, terrain and terrain-tiles tests.

### 5. Rust → WebAssembly: the scripting VM (only if measured)

The VM (`packages/scripting/src/vm.ts`, ~700 lines, step limits, suspendable actions) calls the world for almost
every block (move, show, values, events), so most of its time is in those calls, not in the VM. Moving only the
VM to WASM would add a crossing per world call.

- Do it only if the bench shows the VM itself (not the actions) takes a real share of the step, and then compile
  the typed IR (D6) to a compact bytecode the Rust VM runs, with world calls batched per tick.
- Risks: the highest of all steps (behaviour of every block must stay the same; error messages, step limits and
  suspended actions included); two VMs to keep in step while both exist.
- Tested: every scripting, recipe and block unit test against both VMs; a recorded-game test (scripts' events and
  values each frame) compared between the two; the e2e scripting tests.

### 6. WebGPU renderer, later

Three's `WebGPURenderer` with node materials (TSL), behind the render adapter (D2), WebGL2 kept as the fallback.

- Risks:
  - **Shader patches don't carry over.** The engine changes Three's built-in shaders in many places
    (`onBeforeCompile` and `ShaderChunk` edits: scene lighting and the sun, reflection probes, triplanar and wear,
    googly eyes, foliage and plant wind, terrain, water). Each must be rewritten as node materials: this is most of
    the work.
  - Support: WebGPU in Electron's Chromium is on by default on Windows and macOS; Linux and older GPUs still need
    the WebGL2 path, so both must keep working (two renderers to test).
  - Post-processing (GTAO, bloom, ground blend) and `compile`/`compileAsync` warm-up differ.
- Tested: the e2e suite in both renderers; screenshot comparisons per material and effect (golden images with a
  tolerance) on a real GPU; the bench.
- When: after steps 1–4, and only if the bench shows the draw (not the world) is the limit on target hardware.

## Summary

| Step | What | Risk | Depends on |
|---|---|---|---|
| 0 | Frame snapshot | Low | — |
| 1 | Frame as messages (`FrameIn`/`FrameOut`, `WorldPort`) | Medium | 0 |
| 2 | World in a Web Worker | Medium–high | 1 |
| 3 | Instancing (plants, copies, effects) | Low–medium | — |
| 4 | WASM navigation, then voxel meshing | Medium | bench; 2 for navigation |
| 5 | WASM scripting VM, only if measured | High | 2, bench |
| 6 | WebGPU renderer | High | 1–4, bench |

Decisions to record in `DECISIONS.md` on approval: the world thread (step 2), Rust/WASM for hot code (steps 4–5),
WebGPU as a second renderer (step 6).
