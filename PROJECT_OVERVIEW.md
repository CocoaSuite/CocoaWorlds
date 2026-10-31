# CocoaWorlds — Project Overview

## Purpose

CocoaWorlds is a desktop 3D game engine and editor in the Cocoa family. It makes building a 3D game feel as approachable as designing in CocoaCanvas:

1. Open CocoaWorlds and create a project.
2. Build levels from simple solid brushes — rooms, corridors, doorways — with precise, grid-snapped editing.
3. Place entities: player spawn, lights, doors, triggers, pickups, buttons.
4. Describe behaviour with plain-language blocks ("When the player enters… open the door").
5. Press Play and walk around with responsive, Source-inspired first-person movement.
6. Build a standalone game for Windows, macOS or Linux, or a web version.

## Pillars

- **Brush-based level building** that stays editable, with real subtract/union/intersect.
- **Approachable visual scripting** that is still a real programming system underneath.
- **A real runtime**, separate from the editor, that ships inside exported games.
- **One coherent Cocoa interface**, consistent with CocoaCanvas.

## Current capabilities

The desktop editor runs: create and open projects, edit a scene in a 3D viewport with four views, select and transform objects with a gizmo, organise them in a hierarchy, undo everything, save safely with autosave and recovery, in English or Russian. Brushes, scripting, Play and export are next. Details: [FEATURE_STATUS.md](FEATURE_STATUS.md), plan: [ROADMAP.md](ROADMAP.md).

## Documents

| File | What it holds |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Engine architecture and technical choices |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | CocoaCanvas design reference and CocoaWorlds UI rules |
| [DECISIONS.md](DECISIONS.md) | Decisions, alternatives and approval status |
| [ROADMAP.md](ROADMAP.md) | Phases and progress |
| [FEATURE_STATUS.md](FEATURE_STATUS.md) | What works, what is partial, what is planned |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | Limits, known bugs, deferred work |
