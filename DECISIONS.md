# Decisions

Status values: **Approved** (signed off by the product owner), **Proposed** (recommended, awaiting sign-off), **Deferred**.

| # | Decision | Recommendation | Main alternatives | Status |
|---|---|---|---|---|
| V1 | Editor visual identity | Follow CocoaCanvas tokens and layout; olive `#637F2A` takes the brand-orange role | — | **Approved** (mockups, 2026-11-01) |
| V2 | Scripting presentation | Plain-language blocks as the primary way to script; recipes for common mechanics | Node graph as primary | **Approved** (2026-11-01) |
| V3 | Keep an advanced graph view of the same scripts | Yes, as an optional view | Blocks only | **Approved** (2026-11-01) |
| D1 | Desktop framework | Electron | Tauri 2 | **Approved** (2026-11-01) |
| D2 | Renderer | Three.js behind a render adapter, WebGL2 first | Babylon.js | **Approved** (2026-11-01) |
| D3 | Geometry | Convex plane-based brushes, carve-based CSG, BVH spatial index, no legacy BSP compiler | Mesh CSG (three-bvh-csg, Manifold); classic BSP tree compiler | **Approved** (2026-11-01) |
| D4 | Physics | Rapier 3D; custom Source-style player controller | Jolt (WASM), Ammo.js | **Approved** (2026-11-01) |
| D5 | Entity model | Entities + plain-data components + systems; prefabs with per-field overrides | Archetype ECS; class inheritance | **Approved** (2026-11-01) |
| D6 | Script execution | Compile to typed IR, run in a VM with step limits and suspendable actions | Generate JavaScript; interpret blocks directly | **Approved** (2026-11-01) |
| D7 | Play mode | Fresh runtime world built from a scene snapshot; Stop discards | Diff-and-restore the editor scene | **Approved** (2026-11-01) |
| D8 | Project format | Folder of versioned JSON files, `.meta` sidecars with stable ids, atomic saves | Single binary project file; SQLite | **Approved** (2026-11-01) |
| D9 | Desktop export | Electron runtime shell via electron-builder | Tauri runtime shell (smaller) | **Approved** (2026-11-01) |
| D10 | Web export | Same runtime bundled as static site | Separate web-only runtime | **Approved** (2026-11-01) |
| D11 | Custom JS scripting | Deferred; later in a Worker with a capability API | Unrestricted scripts | **Approved — deferred past v1** (2026-11-01) |
| G1 | Subtract behaviour | Live subtract brushes: a doorway stays an editable brush and solids re-cut instantly; Apply bakes to plain brushes; destructive carve also offered | Destructive carve only (Hammer) | **Approved** (2026-11-01) |
| G2 | Vertex edits that bend a face | Split the bent face into flat triangles; dents still refused | Refuse the move | **Approved** (2026-11-01) |
| G3 | Where brush geometry lives once transforms nest | Brush faces are stored relative to their parent; every entity's transform is local to its parent; moving or rotating a group carries its contents without rewriting them | Keep brushes in world space (Hammer-style) | **Approved** (2026-11-01) |
| P1 | How a placed prefab copy is stored (amends D5) | In full in the scene, with a hidden link per object; on save each object records which values differ from the prefab; editing the prefab updates every copy except those values | Store only the differences and rebuild copies from the prefab file on open | **Approved** (2026-11-01) |
| S1 | Where scripts live | A Script component on the object it controls (“this door”), travelling with copies and prefabs; game-wide rules go on a “Game rules” object | Separate script files that name the objects they control | **Approved** (2026-11-01) |
| S2 | First block set | Core set: events (game starts, enters/leaves a zone, message, every N seconds); actions (move, turn, return to start, show/hide, turn on/off, wait, send message, log, set/change variable); If/Otherwise, Repeat, Repeat forever, Stop; variables, maths, comparisons, random, text | A smaller first set | **Approved** (2026-11-01) |
| D12 | Editor UI stack | React + TypeScript + Zustand + Vite, CocoaCanvas CSS copied into a UI package | Vanilla TS like CocoaCanvas; Svelte | **Approved** (2026-11-01) |

Details and trade-offs for each: [ARCHITECTURE.md](ARCHITECTURE.md).

## Log

- **2026-11-01** — Approved S1 (scripts on objects) and S2 (core block set) at the start of Phase 5.

- **2026-11-01** — Approved P1: prefab copies are stored in full with tracked changes, so scenes open and play without their prefab files. This replaces D5's “instances store only overrides”; the per-field Apply and Revert from D5 stay.

- **2026-11-01** — Routine choices for components and physics (reversible): one component registry in core drives the Inspector and the runtime; long multi-choice fields show as a dropdown so the Inspector never overflows; trigger zones are brushes with a trigger component (amber), and subtract brushes moved to coral so the two never look alike; physics runs in game units with Rapier's `lengthUnit`; an object's own Bounce wins over what it lands on; Rapier 0.21 loads on first Play; the CSP allows WebAssembly compilation only.

- **2026-11-01** — Approved G3 (brushes relative to parent) and the start of Phase 4. Scenes move to format 2: transforms are local to the parent and brush faces are in the parent's space. Format-1 scenes are upgraded on open (with a backup) without moving anything: groups get an identity transform, other children are re-expressed relative to their parent.

- **2026-11-01** — Routine choices for the end of Phase 3 (reversible): polygon outlines are made convex (dents filled in) rather than split into several brushes; levels of 64+ brushes build in a background worker inlined into the bundle as a blob (no extra files to load from disk); while a build runs, only the latest edit is queued. Number fields now derive their text during render instead of copying props into state in an effect, which removed a render loop seen when pasting many objects quickly.

- **2026-11-01** — Routine choices for multi-select, groups, clipboard and snapping (reversible): groups follow CocoaCanvas (a click selects the outermost group, double-click or Enter steps in, Esc steps out); a group's Visible and Locked switches apply to everything inside; each paste is offset one grid step further and a cut pastes back in place; snapping to corners grabs the moving corner nearest the cursor and shows it in the guide colour; grid snapping while moving is relative to the start of the drag.

- **2026-11-01** — Approved G1 (live subtract brushes) and G2 (split bent faces) after reviewing the geometry engine.

- **2026-11-01** — Routine choices made during Phase 2 (reversible, recorded for reference): Y-up coordinates with degrees in YXZ order; esbuild for the main/preload bundles and Vite for the UI; the editor grid is a shader rather than line geometry; editor-only overlays use Three.js directly while game content will go through the render adapter.

- **2026-11-01** — Editor mockups approved. Scripting must be approachable: node-graph-first design replaced by plain-language blocks.
- **2026-11-01** — Approved: Electron (D1), Three.js renderer (D2), convex brushes with carve CSG (D3), Rapier with a custom Source-style controller (D4), IR + VM script execution (D6), advanced graph view kept as an optional view (V3), React + TypeScript editor UI (D12).
- **2026-11-01** — Approved: components + systems with per-field prefab overrides (D5), snapshot-based Play mode plus "Play as built" (D7), folder-of-JSON project format with `.meta` ids and recovery (D8), Electron runtime shell for desktop games (D9), static web export from the same runtime (D10), no custom JavaScript in v1 (D11). Phase 1 complete.
- **2026-11-01** — Found that CocoaCanvas ships as a single bundled HTML file with no component source; components will be reproduced from its stylesheet rather than imported (affects D12).
