# Base building

Comfort and safety for a horror sandbox, not a survival-craft system: **no structural integrity, no health, no
collapse, and no terrain deformation**. Turn it on in the Inspector (nothing selected › Game rules › Base building,
`settings.game.building`).

Code: `packages/runtime/src/building/` (`defs.ts` JSON shapes, `rooms.ts` grid and flood fill, `base.ts` the
`BaseSystem`, `catalog.ts`, `data/*.json`), hooked into `GameWorld` (world.ts, “Base building”). Drawn by
`apps/editor/src/renderer/viewport/base-view.ts`; sound in `play-session.ts` (`hearBase`) and `area-sound.ts`
(`SoundStage.outside`, `setMuffle`, `route`); HUD in `ui/Hud.tsx` + `ui/build-icons.tsx`. Tests:
`packages/runtime/test/building.test.ts`.

## Pieces are JSON

Built-in: `data/wood-wall.json`, `concrete-wall.json`, `door.json`, `window.json`. A game adds pieces (or replaces
one by id) with no code, in the scene file:

```json
"settings": { "building": { "pieces": [ { "id": "mud_wall", "blueprint": "Mud wall plan", "stages": [ … ], "mesh": { "parts": [ … ] } } ], "base": { "comfort": { "sleep": 40 } } } }
```

`base` is merged over `data/base.json` (grid, reach, sealing, comfort weights, sleep, wedge, knock).

A piece: `id`, `label`, `kind` (wall/door/window, for hooks), `blueprint` (the hotbar item that places it),
`snap: "edge"`, `stages`, `mesh.parts`, `opens` / `locks` (the features that make it open and lock), and `seal`
(`needs`: features required, `closed`: must be shut) — when its edge counts as closed for a room.

A stage: `{ id, action, item, use, or, tool, count, duration, gives, adds, optional, label, icon, sound }`.

| action | E | per step |
|---|---|---|
| `place` | tap | uses `use` × `item` |
| `tap` | tap, `tool` in hand | uses `item` if set (nails) |
| `hold` | hold for `duration` s | uses `item` at the end |
| `pour` | hold for `duration` s (the fill grows) | uses `item` at the end |
| `wait` | — (in-game timer, saved) | |

`count` steps per stage. `or` is an alternative item (4 planks instead of a mold). `gives` returns items (the
stripped mold). `adds` gives the piece a feature (`leaf`, `bolt`, `shutters`). `optional` stages come last.
`{ "repeat": n, "stages": [...] }` spells a group out n times (ids get `_1`, `_2`…).

Parts are boxes in edge space (x along the edge 0…grid, y up from the ground, z across): `from`/`step` (shown once
that stage has that many steps), `until`, `feature`, `ground` (stands on the ground under itself), `sink`
(`{stage, depth}`: the mesh moves down as posts are driven), `fill` (grows up over a stage), `swing` (hinge, angle,
when open), `slide` (when locked), `solid` (blocks the player), `ghost`, `color`/`material`.

## Playing

- A plan in the hotbar shows a ghost on the nearest grid edge (red where something is built); click places a build
  site. The HUD shows the current stage's flat icon, what's needed and progress.
- Doors and shutters: E opens/closes. E on the bolt slides it. Holding a chair (tag `chair` or a Seat) and pressing
  E on a shut door wedges it under the handle; E again pulls it away.
- Rooms: a flood fill over the grid (re-run only when an edge changes). A room is enclosed by pieces, finished or
  not; it is **sealed** when every edge round it is closed. Sealed: what's outside is muffled (lowpass, quieter)
  and the wind (background sound) cut down.
- Comfort (hidden, 0…1 per room): sealed, lights on inside (work light, lanterns, any non-sun Light), tagged
  things (`fireplace`, `bed`, `chair`, `personal`, …), Seats, wedged and bolted doors. It only drives ambience:
  music (sounds with area effects off) softer, `fireplace` sounds louder.
- Sleep: E on a `bed`-tagged object; only in a room at or above `comfort.sleep`. Hours pass, and with
  `sleep.saveOn: "sleep"` (default) that is the save point: progress (values, items, every scene's base) is what
  was kept at the last sleep. On waking a wedged chair has sometimes slipped out (`wedge.unwedgeChance`).

## Hooks (for horror)

Events on `world.bus`: `base.placed`, `base.stage`, `base.built`, `base.sealed {room, sealed}`, `base.door`,
`base.lock {site, locked}`, `base.wedge`, `base.unwedged`, `base.sleep`, `base.knock {site, room, at}`, and
`light {target, on}` (any light switched by a block).

API on `world.base`: `roomList()`, `roomAt(p)`, `openings(room)` (unbuilt / open / no-cover), `comfortOf(room)`,
`comfortByRoom()`, `site(id)` (`open`, `locked`, `wedged`), `canSleep(p)`, `knock()`, `wake()`; `world.sleep()`.

The sample hook: every `knock.every` s, with `knock.chance`, something knocks from outside on a door or window,
preferring rooms with an unlocked door or open/missing shutters (`knock.sound` to hear it).

## Limits

- One storey: rooms are found on the ground plan; a point belongs to a room within about 2 storeys of its floor.
- Pieces sit on grid edges only (walls, doors, windows); furniture is ordinary scene objects.
- Pieces are drawn as boxes (colours or project materials); no model files per piece yet.
- Not editable in the editor: sites exist while playing and in saved progress.
- The flood fill runs in place (sub-millisecond for a base); `rooms.ts` is pure and can move to a worker if needed.
