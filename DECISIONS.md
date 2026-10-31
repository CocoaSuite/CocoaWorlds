# Decisions

Status values: **Approved** (signed off by the product owner), **Proposed** (recommended, awaiting sign-off), **Deferred**.

| # | Decision | Recommendation | Main alternatives | Status |
|---|---|---|---|---|
| V1 | Editor visual identity | Follow CocoaCanvas tokens and layout; olive `#637F2A` takes the brand-orange role | — | **Approved** (mockups, 2026-11-01) |
| V2 | Scripting presentation | Plain-language blocks as the primary way to script; recipes for common mechanics | Node graph as primary | **Approved** (2026-11-01) |
| V3 | Keep an advanced graph view of the same scripts | Yes, as an optional view | Blocks only | Proposed |
| D1 | Desktop framework | Electron | Tauri 2 | Proposed |
| D2 | Renderer | Three.js behind a render adapter, WebGL2 first | Babylon.js | Proposed |
| D3 | Geometry | Convex plane-based brushes, carve-based CSG, BVH spatial index, no legacy BSP compiler | Mesh CSG (three-bvh-csg, Manifold); classic BSP tree compiler | Proposed |
| D4 | Physics | Rapier 3D; custom Source-style player controller | Jolt (WASM), Ammo.js | Proposed |
| D5 | Entity model | Entities + plain-data components + systems; prefabs with per-field overrides | Archetype ECS; class inheritance | Proposed |
| D6 | Script execution | Compile to typed IR, run in a VM with step limits and suspendable actions | Generate JavaScript; interpret blocks directly | Proposed |
| D7 | Play mode | Fresh runtime world built from a scene snapshot; Stop discards | Diff-and-restore the editor scene | Proposed |
| D8 | Project format | Folder of versioned JSON files, `.meta` sidecars with stable ids, atomic saves | Single binary project file; SQLite | Proposed |
| D9 | Desktop export | Electron runtime shell via electron-builder | Tauri runtime shell (smaller) | Proposed |
| D10 | Web export | Same runtime bundled as static site | Separate web-only runtime | Proposed |
| D11 | Custom JS scripting | Deferred; later in a Worker with a capability API | Unrestricted scripts | Proposed (defer) |
| D12 | Editor UI stack | React + TypeScript + Zustand + Vite, CocoaCanvas CSS copied into a UI package | Vanilla TS like CocoaCanvas; Svelte | Proposed |

Details and trade-offs for each: [ARCHITECTURE.md](ARCHITECTURE.md).

## Log

- **2026-11-01** — Editor mockups approved. Scripting must be approachable: node-graph-first design replaced by plain-language blocks.
- **2026-11-01** — Found that CocoaCanvas ships as a single bundled HTML file with no component source; components will be reproduced from its stylesheet rather than imported (affects D12).
