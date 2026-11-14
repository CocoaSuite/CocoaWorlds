# Mining

An Azure Mines style game rule: an endless block mine around the Player start. Turn it on in the Inspector
(nothing selected › Game rules › Mining, `settings.game.mining`).

Code: `packages/runtime/src/mining/` (`defs.ts` settings, `data/mine.json` the built-in mine, `noise.ts`,
`blocks.ts` chunks and generation, `mobs.ts` monsters and arrows, `mine.ts` the `MineSystem`), hooked into
`GameWorld` (world.ts, “Mining”). Drawn by `viewport/mine-view.ts`; HUD and menu `ui/MineUi.tsx`; tiles
`renderer/assets/mine/*.png` (16 px). Tests: `packages/runtime/test/mining.test.ts`, e2e `test-e2e/mining.test.mjs`.

## Playing

- `surface` (on by default): the mine is a flat patch of rock at ground level (`patch`: half size in blocks) where
  an object called **Mine** is (or else at the Player start), with a darker stone border. Its sides are the mine's
  edge (never dug) down to `crust` blocks; below that rock goes on forever in every direction, with caves. Above
  ground is yours: terrain, trees, buildings (keep the ground around the patch at its height). Daylight reaches a
  few blocks down. Coming back up sells the backpack; Home (H) goes to the Player start.
- `surface` off: the Player start is the base, a room (`base`, half size in blocks) cut into rock all round. Blocks are 48 u (jumps are raised to clear one; the player fits a 1 × 2 tunnel). No fall damage, no falling out of the world.
- Click (held) swings the pickaxe at the aimed block (reach 4.5 blocks); damage wears it down (cracks), then it
  breaks. Ores go in the backpack. A zone needs a pickaxe tier (“Too hard. Needs a … pickaxe.”).
- Deeper (surface mines; farther from the base otherwise): 12 rock zones, one for each pickaxe tier (stone, granite,
  shale, deepslate, marble, basalt, azure rock, frost rock, crimson rock, obsidian, ember rock, void rock, the last
  one forever), each with six or so of the 25 ores (`oreDensity` sets how many), harder rock (`hardGrowth` per block), richer ores (`valueGrowth`), tougher monsters (`mobGrowth`,
  `mobHitGrowth`).
- A scene object called **Sell** makes a sell zone (a gold square and sign, `sellRadius` blocks): walking in sells the backpack. Without one, getting home sells it. The corner shows what the backpack holds (icon, name, count). **H** or the Home button (when the mouse is free) goes home.
- **Tab** opens the menu: the next pickaxe (12 tiers, then endless +1, +2… levels) and the skill tree (Mining,
  Backpack, Combat, Vision; the last node of each branch levels forever). Esc or Tab shuts it.
- **G** throws dynamite (bought in the menu, dearer with each pickaxe tier): after the fuse it blows a sphere (`dynamite.radius`) of rock up to one tier past the pickaxe, ores into the backpack, and hurts monsters (a lot) and the player (a little).
- Each regeneration rolls a **twist** (`twists`: Gold Rush, Crystal Bloom, Rich Veins, Soft Rock, Swarm, Pitch Dark, Hollow Earth, Lucky Day, Calm, or a quiet mine), shown in the corner and the menu.
- Caves are peopled: each `caveMobs.size`-block sector holds monsters by how much natural cave it has (one per `per` open blocks, up to `max`; the twist scales it). They appear out of sight as the player nears. Killed ones stay dead: a cleared cave stays clear until the mine regenerates (saved).
- Dying loses part of the backpack (`deathLoss`, less with Sturdy Straps).
- The mine regenerates every `regenMinutes` (40) of real time: a new seed, the player sent home.
- Dark: only the lamp around the player lights the rock (`light` blocks, Lantern adds). Gems glow a little.
- Saved progress keeps money, pickaxe, skills, backpack, the seed, what was dug and when it regenerates.

## Monsters

Zombie (walks, jumps one block, finds its way), Skeleton (keeps its distance and shoots arrows, from zone 2),
Spider (fast, climbs walls, from zone 3). They spawn in caves 12–26 blocks from the player, never near the base,
can't enter the base, and give money when killed with the pickaxe. Each uses the model of the scene object named
like its `template` (Zombie, Skeleton, Spider), with animations called by `anims` (Idle, Walk, Attack, Die);
without one they are plain red figures. Hide the template objects in the scene: their model is only copied.

## Structures and bosses

Under the shaft, roughly every 80 blocks down, a giant structure stands in the rock (`mining/structures.ts`), made
from the seed: an abandoned mine (timbered tunnels on three levels, stairwells, store rooms, the great dig), a
dwarven city (a pillared hall over a lava chasm, bridges, houses, a forge, a sealed gold vault, the throne room), a
crystal cathedral (a vast geode of crystal spires and gem pockets) and a sunken temple (a stepped pyramid in its own
cave, a maze of webs and lava pits, the sanctum). Deeper kinds come with depth (`structures.kinds[].from`). Built
blocks are `materials`: planks, bricks, lanterns and crystal that light the rock, chests (money and dynamite), lava
(burns, can't be dug), webs (slow), gold blocks, and the strongbox (`locked`: opens once the boss is beaten).

Each structure's boss sleeps at its heart and wakes when the player comes close. Every attack winds up first and its
weapon glows: gold can be parried, red (a slam) can only be blocked or dodged. Holding right mouse blocks (less
damage, slower walking, no swinging); pressing it just as a blow lands parries it: no damage, and the boss staggers,
taking double damage. Parried shots fly back at the boss. At half health it gets faster. Beaten, it pays and its
strongbox opens until the mine regenerates. Bosses are figures of pixel blocks animated in code
(`renderer/viewport/boss-models.ts`). `bosses` and `guard` in the settings tune them.

## Settings are JSON

`settings.mining` in the scene file is laid over `data/mine.json`. Lists merge by `id` (an entry replaces the
built-in one with that id, or adds one). Examples: a zone's `texture` or an ore's `texture` (a project image,
16 × 16) replaces the built-in tile; a pickaxe's `model` (a project model) is shown in hand instead of the built-in pixel pickaxe (its pixels as little blocks, coloured by the pickaxe's `color`), swinging; `sounds`
(`hit`, `break`, `ore`, `sell`, `buy`, `mobHit`, `mobDie`, `arrow`: project sounds) are off until set; `seed`
fixes the mine (0: a new one each time).

```json
"settings": { "mining": {
  "regenMinutes": 30,
  "pickaxes": [ { "id": "wooden", "model": "models/pickaxe_wood.glb" } ],
  "sounds": { "break": "sounds/stone_break.ogg" }
} }
```

## API

`world.mine` (`MineSystem`): `money`, `tier`, `level`, `skills`, `bag`, `stat(name)`, `power()`, `buyPickaxe()`,
`buySkill(id)`, `sell()`, `regenerate()`, `blocks` (`get`, `set`, `raycast`, `chunk`…), `mobs`, `save()`/`load()`.
`GameWorld`: `mineHud()`, `mineMenu()`, `mineAction(name, arg)` (`menu`, `home`, `pickaxe`, `skill`). Rock
colliders are boxes per chunk near the player, owned by `@mine`.
