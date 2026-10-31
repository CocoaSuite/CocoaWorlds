<p><img src="assets/brand/cocoaworlds-logo.svg" alt="CocoaWorlds" height="56"></p>

# CocoaWorlds

A desktop 3D game engine and editor from the Cocoa family. Build levels from editable brushes, add behaviour with plain-language blocks, press Play, and export standalone games.

**Status:** Phase 2 — desktop foundation. The editor opens, creates and saves projects, and has a working 3D viewport with selection, transform gizmos and undo. Brushes, scripting and Play arrive in later phases; see [FEATURE_STATUS.md](FEATURE_STATUS.md).

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

[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) · [DECISIONS.md](DECISIONS.md) · [ROADMAP.md](ROADMAP.md) · [FEATURE_STATUS.md](FEATURE_STATUS.md) · [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)
