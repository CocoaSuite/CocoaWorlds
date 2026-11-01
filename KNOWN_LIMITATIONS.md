# Known Limitations

## Current build

- **Only tested on Linux.** The editor is built on cross-platform pieces (Electron, Three.js) but has not yet been run on Windows or macOS. Packaged installers come in Phase 9.
- **Rotating or scaling a group re-projects world-aligned textures** on the brushes inside it (moving keeps them locked). Non-uniform scale on a rotated parent is stored as the nearest rotation and scale (no shear).
- **No box selection** in the viewport yet.
- **Lights are markers only.** They don't light the scene until materials and lighting land (Phase 7).
- **One scene per project in the UI.** The format supports a scene list; scene management UI comes later.
- **The clipboard is inside the editor.** Copy/paste works across projects within one session, but not with other apps or after a restart.
- **Exported games:** one scene (the start scene); folders rather than installers; programs aren't signed, so Windows SmartScreen and macOS Gatekeeper warn on first start (on macOS: right-click › Open); 64-bit Intel/AMD builds for other systems (Apple Silicon Macs run them through Rosetta); web games need a web server. Exporting for another system needs the internet once. Saved progress holds kept game values and items only, not the world (copies made while playing, moved or removed objects).
- **Play as the player needs a Player start** (new scenes have one). Without it, Play is the physics preview with the free camera. Lighting is real-time (no baked lightmaps yet) and bulb shadows are costly, so use them sparingly; the player has no body or weapon model, and there are no ladders or swimming yet (Phase 6).
- **Pivots apply to one selected object.** With several selected, the gizmo uses the middle of them all; a pivot set on a brush stays put relative to it when moved, but not when it is rotated through its parent group.
- **Health and score are simple:** one player with 100 health, no armour, lives or game-over screen; dying starts again at the Player start straight away, and nothing that moved is put back. The score isn't saved between plays. The console can only be read after Esc frees the mouse.
- **Game values:** renaming one doesn't update the blocks that use it (they show a problem until re-picked), and changes to game values are saved at once and can't be undone with Ctrl+Z. There is no countdown or progress widget yet; show a value instead.
- **Text signs** don't move with an object a script moves, and Show/Hide don't apply to them yet.
- **Copies:** a copy is one body: brushes inside a copied object with Physics are left out unless they have Physics too, text signs inside copies aren't drawn, and trigger zones inside a copy stay where they were made. Only objects in the scene can be copied (hide one to use it as a template); prefab files can't be copied directly yet.
- **Object actions:** a Scale and a Move on the same object at once replace each other (the newer one wins); point objects' collision shapes are rescaled, but their drawn shape isn't. Breakable objects break only from the Damage block (no damage from hits or falls yet), and a broken object stays in the game, invisible and not colliding, so its “When this breaks” stacks can finish.
- **Third-person camera:** a simple capsule body, no animation; Use still aims from the player's eyes.
- **Assets:** GLB files and glTF files with embedded data only (a .gltf with a separate .bin or image files can't be imported yet). Models don't animate in the editor, and models inside copied brush objects aren't drawn. Textures are colour images only (no normal, roughness or emissive maps yet, no material editor). Lighting is real-time; there are no baked lightmaps.
- **Moving platforms carry the player's feet, not their view:** on a turning platform the player goes round with it but keeps facing the same way. While a lift moves the player can't jump.
- **The player is an upright cylinder** (radius 16, 72 tall) rather than Source's box, so they slide round pillars and balls; they also step off a ledge a little sooner at its corners.
- **Screen UI:** one font, no animations or transitions, and no text input boxes; screens belong to the scene (a second scene would need its own); lists hold text rows or the inventory (not other data). The Materials workspace is a placeholder.
- **Player speeds are fixed** (Half-Life 2's: run 190, walk 100, crouch 64 u/s); a per-scene setting comes later.
- **Keys while playing are fixed** (WASD, Space, Ctrl or C, Shift, E); rebinding comes later. While the mouse is captured, editor shortcuts are off; F5 still stops.
- **Scripts:** blocks are rearranged with ↑ ↓ and copy and paste for now; drag-and-drop comes later. A message counts as “stopped coming” after 0.1 s without it, so a loop that sends it less often than that starts and stops it each time. The graph view (V3) comes later in Phase 5.
- **Applying a change to a prefab writes the prefab file straight away.** Undo restores this scene's copies but not the file; apply the old value again to change the prefab back.
- **Prefabs are edited through their copies.** Opening a prefab on its own to edit it, and prefabs inside prefabs, come later.
- **Brushes with Physics move as one solid piece** and aren't cut by subtract brushes while playing.
- **Edited meshes (moved into a dent or twist) aren't cut, clipped, merged or hollowed** until they are convex again, and can't be subtract brushes. Moving ones collide as their convex hull.
- **Loop cut runs across four-sided faces only;** it stops at triangles and other shapes.
- **The vertex tool moves corners with the gizmo only;** dragging a corner handle directly is not supported yet.
- **Materials are built-in development colours** until material assets and textures arrive in Phase 7.
- **Surfaces made by a live cut** (the inside of a doorway) follow the wall around them and can't be selected until the cut is applied.
- **Big levels update a moment after an edit.** From 64 brushes the level is rebuilt in a background worker, so the view can lag an edit by the build time (shown in the stats). Picking uses the last finished build.
- **Brush rotation re-projects textures** (world alignment). Texture lock is exact for moves only.
- **Carving can drop hair-thin slivers** (< 0.5 u thick, ≤ 8 cubic units) left by cutters at very shallow angles; the count is reported.
- **Automated end-to-end tests run on a software renderer** (SwiftShader). Real-GPU behaviour is covered by manual testing only so far.

## Expected limitations of the approved architecture

- **Exported game size.** Desktop games carry an Electron runtime (Chromium), so even a tiny game is roughly 100 MB.
- **macOS distribution.** Signing and notarization need a Mac and an Apple Developer ID. Unsigned macOS builds show a Gatekeeper warning.
- **Windows distribution.** Unsigned builds show a SmartScreen warning until a code-signing certificate is used.
- **Geometry.** Brushes are convex; edited meshes (G4) can take any closed shape but don't take part in carving. Carve results are several convex brushes. Arbitrary mesh booleans on imported models are not planned for v1.
- **Level scale.** No visibility precompilation (PVS); very large, dense levels rely on frustum culling and batching.
- **Web export.** Audio waits for the first click (browser autoplay rules); mouse look needs a click to lock the pointer; large assets download before play.
- **Custom code.** No user JavaScript in v1; behaviour is built with blocks.
- **Platforms.** The editor targets desktop and laptop screens only.

## Known bugs

None open.

## Fixed during development

- Newer Chromium returns a Promise from `scrollIntoView`; an effect that returned it implicitly crashed the editor when the console updated. Effects now never return values implicitly.
- Line-segment grids disappeared near the camera on software renderers; the grid is now drawn by a shader on a single plane.
