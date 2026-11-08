# Base building

Blueprints, as in Lumber Tycoon 2: place a see-through blueprint (0%), push or drop props of its material into it
until it is full, and it becomes the finished piece. Turn it on in the Inspector (nothing selected › Game rules ›
Base building, `settings.game.building`). No terrain deformation and no structural integrity.

Code: `packages/runtime/src/building/` (`defs.ts` JSON shapes, `grid.ts` edges and cells, `base.ts` the
`BaseSystem`, `catalog.ts`, `data/*.json`), hooked into `GameWorld` (world.ts, “Base building”). Drawn by
`apps/editor/src/renderer/viewport/base-view.ts`; HUD in `ui/Hud.tsx` + `ui/build-icons.tsx`. Tests:
`packages/runtime/test/building.test.ts`.

## Playing

1. **Pick.** **B** opens the blueprint menu: a blue scroll of the blueprints the player owns, in sections
   (Concrete, Wood…). Blueprints are items (`Wood wall blueprint`, …) but not hotbar slots: owning one puts it in
   the menu. A card starts placing it and the menu shuts.
2. **Place.** A light ghost follows the aim, against the face aimed at (the ground, a wall, a blueprint's top or
   side), lined up on the grid (48 u) along that face and flush with it across: blueprints stack on blueprints
   and go beside them. **R** turns it a quarter about up, **T** tips it over a quarter (a wall becomes a floor;
   doors don't tip). Red where something already takes up most of that space (walls meeting at a corner are
   fine). A click places a blueprint at 0%; placing goes on until **Q** or a right click. A blueprint item is kept
   (`consumeBlueprint: true` makes each placing use one, and placing stops when there are none).
3. **Fill.** Every physics prop whose name starts with the piece's `material` (“Plank”, “Plank 2”, “Concrete
   powder bag”; any case), or that is tagged with it, counts while it touches the blueprint, loose or carried:
   one each, whatever its size. It stays where it is; take it out again and the % goes back down. A prop counts
   for one blueprint only: the one it is already in while it still touches it, else the oldest one it touches
   that has room. Each blueprint shows its % on a tag above it; aimed at, the HUD shows it too.
4. **Finish.** Once `count` props are in at once, they are all used up together and the piece is solid.

- **Remove a blueprint:** hold E on it for `removeHold` seconds (1). The props in it stay.
- **Knock a piece down:** finished pieces have `health`. Weapon hits (the crowbar: 10 a swing), bullets, blasts
  (**Make an explosion**) and **Damage everything within** blocks wear it down; at 0 it is gone.
- **Doors:** the door is a piece of its own. Aimed at a door frame, its ghost goes in the frame's gap (turned with
  the frame; one door per frame); elsewhere it goes on the grid like anything else. E opens and shuts a finished
  door: it swings smoothly over `openTime` seconds and blocks only while shut.

## Pieces are JSON

Built-in (`data/`), flat single-colour boxes. Concrete (1 bag of concrete powder each): large wall, small wall,
door frame, window frame, foundation, thin floor. Wood (planks): wall, small wall, floor, thin floor, door frame,
door, window frame. Glass (1 glass pane): window, see-through, goes in window frames the way doors go in door
frames. Thin floors are 48 × 1 × 48 tiles to lay on the ground or a floor. A game adds pieces (or replaces one by id) with
no code, in the scene file:

```json
"settings": { "building": {
  "pieces": [ { "id": "mud_wall", "label": "Mud wall", "category": "Mud", "material": "mud", "count": 5, "size": [96, 96, 8], "mesh": { "parts": [ … ] } } ],
  "base": { "removeHold": 2 }
} }
```

A piece: `id`, `label`, `category` (menu section), `blueprint` (the item that owns it; default “*label*
blueprint”), `icon` (a project image for its card; missing: drawn from its boxes), `consumeBlueprint`, `size` (its
box: x along, y up, z across; missing: round its parts), `turns` (T tips it; doors don't), `material` (the
name/tag), `materialLabel` (plural, for the HUD), `count`, `health`, `opens` and `openTime` (s), `fits` (the
socket kind it goes in, `door`), `sockets` (`[{ fits, at }]`: places in it that a piece fits, `at` being the
fitting piece's corner in this piece's space), `sounds` (`add`, `built`, `broken`,
`door`) and `mesh.parts`.

Pieces can't overlap much (by their parts' boxes, so a door fits a frame's gap and walls meet at corners).
Parts are boxes in the piece's own space, from its box's corner: `at` (the box's middle), `size`, `color`,
`material`, `solid`, `opacity` (finished, 1 opaque; glass ~0.35), `swing` (`{ hinge: [x, z], angle }`).

`base` is merged over `data/base.json`: `grid` (48), `reach`, `placeReach`, `removeHold`, `every`, `touch`,
`menuKey` (`KeyB`), `ghost` (`color`/`opacity` of placed blueprints, `placing`/`placingOpacity` of the ghost,
`invalid`), `tag` (`color`, `text`) and `ui`: pictures (project images) that replace the flat colours — `panel`
(the scroll), `rolls` (its ends), `card` (behind each card), `tag` (behind each %).

## Events and API

Events: `base.placed {site, piece}`, `base.progress {site, piece, filled, count}` (up or down), `base.built`, `base.removed`
(E held), `base.broken` (knocked down), `base.door {site, open}`.

`world.base` (`BaseSystem`): `allSites()`, `site(id)` (`min`, `turn`, `filled`, `health`, `open`), `built(s)`,
`fraction(s)`, `add(def, min, turn?, id?, filled?)`, `remove(id)`, `damage(id, amount)`, `owned()`, `menuOpen`,
`placing`, `startPlacing(id)`, `stopPlacing()`, `rotate()`, `tip()`, `tags()`, `pieces`, `config`, `save()` /
`load()`. `GameWorld`: `baseKey(code)`, `toggleBlueprints()`, `pickBlueprint(id)`, `blueprintMenu()`,
`blueprintTags()`. Menu: `ui/BlueprintMenu.tsx`. Finished pieces' colliders are owned by `@base:<site>`, so weapons find them.

Saved in progress as `base` (per scene, `v: 3`): finished pieces as finished, blueprints empty (they fill again from
the props lying in them, which stay where they were when the game keeps the world). Bases saved by the old
build-site system are not loaded. Props used up are taken out of the game like any removed object.
