<p><img src="assets/brand/cocoaworlds-logo.svg" alt="CocoaWorlds" height="56"></p>

# CocoaWorlds

A desktop 3D game engine and editor from the Cocoa family. Build levels from editable brushes, add behaviour with plain-language blocks, press Play, and export standalone games.

**Status:** Phases 5 and 6 in progress — scripting and gameplay. The editor builds levels from brushes (draw, cut, clip, vertex-edit, texture), groups objects with nested transforms, adds components such as Physics and Trigger zones in the Inspector, moves corners freely (with loop cuts), adds behaviour with plain-language blocks, and lets you play the level as the player (F5). Export arrives in a later phase; see [FEATURE_STATUS.md](FEATURE_STATUS.md).

## Run it

Requires Node.js 22 or newer.

```sh
npm install          # also downloads Electron
npm run build        # bundle the editor
npm start            # launch CocoaWorlds
```

During development, `npm run dev` starts the editor with hot reload for the UI.

## Test it

```sh
npm run typecheck    # TypeScript, all packages
npm test             # unit and integration tests (Vitest)
npm run test:e2e     # launches the built editor and drives it (on Linux without a display: xvfb-run -a npm run test:e2e)
```

## Layout

```
apps/editor        Electron app: main process, preload bridge, React UI, viewport
packages/core      ids, math types, project/scene formats, validation, migrations, undo history
packages/ui        CocoaCanvas design tokens and components
```

## Documents

[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) · [DECISIONS.md](DECISIONS.md) · [ROADMAP.md](ROADMAP.md) · [BENCHMARK.md](BENCHMARK.md) · [docs/rendering.md](docs/rendering.md) · [docs/ui.md](docs/ui.md) · [FEATURE_STATUS.md](FEATURE_STATUS.md) · [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)
