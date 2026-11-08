# Base building

Blueprints, as in Lumber Tycoon 2: place a see-through blueprint (0%), push or drop props of its material into it
until it is full, and it becomes the finished piece. Turn it on in the Inspector (nothing selected › Game rules ›
Base building, `settings.game.building`). No terrain deformation and no structural integrity.

Code: `packages/runtime/src/building/` (`defs.ts` JSON shapes, `grid.ts` edges and cells, `base.ts` the
`BaseSystem`, `catalog.ts`, `data/*.json`), hooked into `GameWorld` (world.ts, “Base building”). Drawn by
`apps/editor/src/renderer/viewport/base-view.ts`; HUD in `ui/Hud.tsx` + `ui/build-icons.tsx`. Tests:
`packages/runtime/test/building.test.ts`.

## Playing

1. **Place.** A blueprint item in the picked hotbar slot (`Wood wall blueprint`, …) shows a flat blue ghost on the
   nearest grid edge (walls, doors, windows) or cell (floors, foundations); red where something is already there.
   A click places it as a blueprint at 0%. Blueprints stand on what's under them: the ground, or a finished
   piece (a wall on a foundation, a second wall on top of the first). The item is kept: buy once, place many
   (`consumeBlueprint: true` makes each placing use one).
2. **Fill.** Every prop tagged with the piece's `material` (tag `plank`, `concrete powder`; any case) that touches
   the blueprint, loose or carried, is used up: it goes into the blueprint and out of the game. Each counts one,
   whatever its size, until the piece has `count`. Untagged props and props of another material are left alone.
   Aimed at, the HUD shows `Wood wall · 50%`, a bar and what's still needed.
3. **Finish.** The last prop finishes it: solid, it blocks the player and props, and its sound plays.

- **Remove a blueprint:** hold E on it for `removeHold` seconds (1). What was put in is lost.
- **Knock a piece down:** finished pieces have `health`. Weapon hits (the crowbar: 10 a swing), bullets, blasts
  (**Make an explosion**) and **Damage everything within** blocks wear it down; at 0 it is gone. Aimed at, a damaged piece shows its
  health bar.
- **Doors:** E opens and shuts a finished `opens` piece (its `swing` parts turn about their hinge and stop blocking).

Getting blueprints: they are hotbar items, so anything that gives items gives them (the **Give an item** block, a
pickup, the start of the game). The home-computer shop will sell them once its UI exists.

## Pieces are JSON

Built-in (`data/`): `wood-wall`, `wood-floor`, `wood-door`, `wood-window` (4/4/3/3 planks) and `concrete-wall`,
`concrete-floor` (3/4 bags of concrete powder). A game adds pieces (or replaces one by id) with no code, in the scene
file:

```json
"settings": { "building": {
  "pieces": [ { "id": "mud_wall", "label": "Mud wall", "material": "mud", "count": 5, "mesh": { "parts": [ … ] } } ],
  "base": { "removeHold": 2 }
} }
```

A piece: `id`, `label`, `blueprint` (the item that places it; default “*label* blueprint”), `consumeBlueprint`,
`snap` (`edge` or `cell`), `material` (the tag), `materialLabel` (plural, for the HUD), `count`, `health`, `opens`,
`sounds` (`add`, `built`, `broken`, `door`: project paths) and `mesh.parts`.

Parts are boxes in the spot's own space: x along (0…grid), y up from what it stands on, z across (an edge's middle
is z 0; a cell runs 0…grid). `at` (the box's middle), `size`, `color`, `material` (a project material by name),
`solid` (blocks once finished; default yes), `swing` (`{ hinge: [x, z], angle }`: turns open by that much). The
space a blueprint takes props in is the box round all its parts, `touch` units bigger.

`base` is merged over `data/base.json`: `grid` (96), `reach` (E, 140), `placeReach` (320), `removeHold` (s),
`every` (how often blueprints look for props, s), `touch` (u), `ghost` (`color`, `invalid`).

## Events and API

Events: `base.placed {site, piece}`, `base.progress {site, piece, filled, count}`, `base.built`, `base.removed`
(E held), `base.broken` (knocked down), `base.door {site, open}`.

`world.base` (`BaseSystem`): `allSites()`, `site(id)` (`filled`, `health`, `open`, `spot`, `y`), `built(s)`,
`fraction(s)`, `add(def, spot, y, id?, filled?)`, `remove(id)`, `damage(id, amount)`, `space(s)`, `pieces`,
`config`, `save()` / `load()`. Finished pieces' colliders are owned by `@base:<site>`, so weapons find them.

Saved in progress as `base` (per scene, `v: 2`). Bases saved by the old build-site system are not loaded. Props used
up are taken out of the game like any removed object (kept as removed when the game keeps the world).
