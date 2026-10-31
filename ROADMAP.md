# Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Inspect CocoaCanvas, design system, technology research, architecture proposal, decisions | **Done** |
| 2 | Desktop foundation: Electron app, CocoaCanvas-style shell, projects, viewport, scene model, selection, transforms, undo | **In progress** |
| 3 | Brush geometry: creation, manipulation, grid/snap, vertex and face editing, materials per face, carve/union/intersect, validation | Not started |
| 4 | Entities and physics: components, Rapier, colliders, triggers, inspector, interaction infrastructure | Not started |
| 5 | Visual scripting: blocks editor, script model, compiler, VM, events, debugging, recipes | Not started |
| 6 | Gameplay: Source-style controller, player, interaction, health/score, doors/plates/buttons/lifts | Not started |
| 7 | Assets and rendering: asset browser, material editor, textures, lighting, audio | Not started |
| 8 | Runtime and persistence: standalone runtime, Play isolation, autosave, recovery, migrations | Not started |
| 9 | Builds: Windows, macOS, Linux packaging; web export; runtime verification | Not started |
| 10 | Polish: usability, performance, demo level, documentation | Not started |

Order may shift where dependencies require it (for example, the project format from Phase 8 is started in Phase 2 because saving is needed from day one). Significant changes are explained in [DECISIONS.md](DECISIONS.md).

## Phase 1 checklist

- [x] Inspect CocoaCanvas source and document its design system
- [x] Approved editor mockups
- [x] Research desktop, rendering, physics, geometry and packaging options
- [x] Architecture proposal
- [x] Sign-off on decisions D1–D12 and V3

## Next

After sign-off: scaffold the monorepo, Electron shell with the CocoaCanvas frame, project create/open/save, and a viewport with a grid and camera navigation.
