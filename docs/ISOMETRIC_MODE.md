# Isometric World mode (experimental)

CocoaWorlds remains a single engine. New Worlds can select **3D World** or **Isometric World (2.5D)** at creation time, and the World menu changes the saved mode for an open World. Older projects load as 3D.

## First implementation

- `project.cwproj` stores `settings.worldMode` (`3d` or `isometric`).
- The editor camera has a true orthographic isometric view: diagonal X/Z direction and approximately 35.264° elevation, with screen-space panning and zoom.
- Scene geometry, brushes, materials, assets and scripts are shared with standard 3D Worlds.
- A World mode switch is intentionally a per-project setting, *not* a global editor preference.

## Follow-up gameplay work

Editor camera is only the initial milestone: a playable isometric World requires a separate orthographic Play camera that follows the player, a camera-relative 8-way controller, cursor-based interaction without pointer lock, visible player art, and tests for collisions and level transitions. Do not treat the first-stage camera as complete gameplay support.

## Future turn-based combat (Persona-like)

Combat must be an opt-in, data-driven game state rather than code embedded in the scene renderer. Suggested architecture:

- `CombatEncounter`: participants, arena scene, start/end conditions and return location.
- `Combatant`: stats, skills, affinities, conditions, turn resources and sprite/3D presentation.
- `CombatAction`: target selectors, costs, effects and animation requests; executed by a deterministic rules engine.
- `TurnScheduler`: initiative, action queue, interrupts and explicit completion tokens.
- `CombatState`: exploration -> battle setup -> command selection -> action execution -> resolution -> exploration.
- `CombatUI`: menus and status views in CocoaWorlds' existing UI layer.
- `CombatVisuals`: camera cuts, animations, hit reactions and effects; pure presentation driven by events.

Implement weakness/affinity and optional extra-turn rules as **configurable policies**, not assumptions hardwired into action execution. Reuse CocoaWorlds' visual scripts for encounter start/end, cinematic sequencing, and effect hooks. Keep rules deterministic and serializable for save/load, debugging, and eventual testing.
