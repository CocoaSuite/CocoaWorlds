# Building a game (export) and saved progress

## Build…

**Build…** (top bar) saves the project and writes the game into a folder you choose, named after the game:

| Target | What you get |
|---|---|
| Web | `index.html`, the player's scripts, and `game/` (the scene as `game.json` and the assets it uses). Put the folder on any web server: itch.io (upload it zipped), GitHub Pages, your own. Browsers can't open it straight from disk. |
| Windows, macOS, Linux | A folder with the game program (`Game.exe`, `Game.app`, `Game`) and its files. Zip the folder to share it. |

A desktop game for the computer you're on uses the editor's own runtime, so it needs no download; **Play it**
in the dialog starts it. For another system the runtime (Electron, the same version as the editor's) is
downloaded once, about 100 MB, and kept for later exports.

The exported game plays the project's start scene with the same game code, controls, display and screens as
Play: click to capture the mouse, Esc frees it (or pauses a menu), F11 is full screen in desktop games. It needs
a Player start.

How it works: the editor's build includes a second page, the **player** (`player.html`), which reads
`game/game.json` and its assets from beside it. Export copies only the player's files (from Vite's build
manifest), not the editor. A desktop game is the Electron runtime with a small main process (`game-shell`)
that serves the web game from a private `game://` address, so it behaves exactly as on a web server.

## Saved progress

- A game value marked **kept** (Visual script › Game values) is saved: the next game starts with its last value.
- **Keep the player's items** (Inspector, Game rules) saves the inventory too.
- **Forget saved progress** (a block) starts over: kept values go back to their starting values and kept items
  are emptied. **Forget saved progress** in the Inspector does the same for Play in the editor.
- **the time now** is the real clock (seconds since 1970), so things can grow while the game is closed: store
  the time something was planted in a kept value, and compare.

Progress is saved as it changes (at most twice a second) and when the game closes: in the browser's storage for
web games (per web site), in the game's own folder for desktop games, and in the editor's for Play.

## Brushes as a model (GLB)

**Export as GLB…** (File menu, or right-click in the scene tree or the view) writes the selected brushes, and the
brushes inside selected groups, as a glTF binary model:

- What is written is what the level shows: solid brushes after live subtract (every shown subtract brush still cuts
  them, so a doorway stays a doorway). Tool faces (COL, NOGRASS), subtract volumes, trigger and sound zones, water,
  ladders and No Render zones are left out, and so are hidden brushes. Models, lights and other objects are skipped.
- **Units**: metres (39.37 u to a metre, as models are imported) or game units as they are.
- **Origin**: the bottom centre of what is exported (handy for placing it back as a model), or the scene's origin.
- **One mesh**: everything as one mesh with the faces hidden where brushes touch dropped (as in the level).
  Otherwise each brush is its own mesh, under a node for each group, named as in the scene tree; one object
  selected is the file's root.
- Materials: one glTF material per face material and tint, named for people (“Grey”, a project material's name),
  with the maps the view has loaded (colour, normal, roughness, metalness, occlusion, glow, opacity) and their
  texture repeats. Triplanar mapping, wear, bevels and ground blend are drawn by the editor's shaders and aren't in
  the file.

**Save file…** asks where (the file name starts as the one selected object's name, or the scene's); **Add to
project models** writes it to `assets/models` (renamed if taken), ready for Add › Model. Code:
`renderer/viewport/glb-export.ts` (`buildExportScene`, `exportGlb`), `editor/GlbExport.tsx`, main process
`main/model-files.ts` (`CW_MODEL_EXPORT_DIR` skips the dialog in tests). Tests: `apps/editor/test/glb-export.test.ts`,
e2e `test-e2e/glb-export.test.mjs`.
