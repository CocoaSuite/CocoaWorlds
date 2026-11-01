# Known Limitations

## Current build

- **Only tested on Linux.** The editor is built on cross-platform pieces (Electron, Three.js) but has not yet been run on Windows or macOS. Packaged installers come in Phase 9.
- **No nested transforms yet.** Selecting a parent or group and using the gizmo moves everything inside it, but children's positions are stored in world space and a group has no transform of its own. Nested transforms arrive with the runtime scene graph in Phase 4.
- **No box selection** in the viewport yet.
- **Lights are markers only.** They don't light the scene until materials and lighting land (Phase 7).
- **One scene per project in the UI.** The format supports a scene list; scene management UI comes later.
- **The clipboard is inside the editor.** Copy/paste works across projects within one session, but not with other apps or after a restart.
- **Some tools are visible but disabled** (triggers, Play, Build), each labelled with when it arrives.
- **The vertex tool moves corners with the gizmo only;** dragging a corner handle directly is not supported yet.
- **Materials are built-in development colours** until material assets and textures arrive in Phase 7.
- **Surfaces made by a live cut** (the inside of a doorway) follow the wall around them and can't be selected until the cut is applied.
- **Level geometry rebuilds on the main thread.** Fine for hundreds of brushes; very large levels may stutter while editing until the rebuild moves to a worker. Hidden-face removal is O(n²) for now.
- **Brush rotation re-projects textures** (world alignment). Texture lock is exact for moves only.
- **Carving can drop hair-thin slivers** (< 0.5 u thick, ≤ 8 cubic units) left by cutters at very shallow angles; the count is reported.
- **Automated end-to-end tests run on a software renderer** (SwiftShader). Real-GPU behaviour is covered by manual testing only so far.

## Expected limitations of the approved architecture

- **Exported game size.** Desktop games carry an Electron runtime (Chromium), so even a tiny game is roughly 100 MB.
- **macOS distribution.** Signing and notarization need a Mac and an Apple Developer ID. Unsigned macOS builds show a Gatekeeper warning.
- **Windows distribution.** Unsigned builds show a SmartScreen warning until a code-signing certificate is used.
- **Geometry.** Brushes are convex. Concave shapes are made from several brushes (this is how carve results are represented). Arbitrary mesh booleans on imported models are not planned for v1.
- **Level scale.** No visibility precompilation (PVS); very large, dense levels rely on frustum culling and batching.
- **Web export.** Audio waits for the first click (browser autoplay rules); mouse look needs a click to lock the pointer; large assets download before play.
- **Custom code.** No user JavaScript in v1; behaviour is built with blocks.
- **Platforms.** The editor targets desktop and laptop screens only.

## Known bugs

None open.

## Fixed during development

- Newer Chromium returns a Promise from `scrollIntoView`; an effect that returned it implicitly crashed the editor when the console updated. Effects now never return values implicitly.
- Line-segment grids disappeared near the camera on software renderers; the grid is now drawn by a shader on a single plane.
