# Benchmark

CocoaWorlds is measured by the games it can make. Two tiers:

- **Basic:** a typical Roblox game: a tycoon, Natural Disaster Survival, Grow a Garden, Pet Simulator.
- **Advanced:** Slime Rancher, and Half-Life 1.

"Can make" means a person builds the game in the editor, with blocks rather than code, and exports a game other people can play. Each game below is broken down into what it needs. Each need is marked:

- ✅ the engine can do it today
- 🟡 it can be done, but awkwardly or partly
- ❌ it is missing

Each need also notes the roadmap step that delivers it (the B / A steps are in [ROADMAP.md](ROADMAP.md)). The last section lists the decisions that need approval.

Status as of 2026-11-01 (after B2).

## What every target needs

These come up in almost every game, so they come first.

| Need | Now | Step |
|---|---|---|
| Brush levels, materials per face, triggers, physics objects, prefabs | ✅ | — |
| First-person player with Source-style movement, use (E) | ✅ | — |
| Health, damage, death and restart, score (each can be switched off per project) | ✅ | — |
| Blocks: events, moving, turning, showing and hiding, messages, variables, if/repeat, timers | ✅ | — |
| **Game-wide values** (Cash, Gems, Round, Wave) that every script shares, shown on screen when wanted | ✅ | B1 |
| **On-screen text and messages** ("Round 3 starts!", "Need $50", "Press E to buy") | ✅ messages; 🟡 no countdown widget yet (build it from a value) | B1, B5 |
| **Make copies while playing** (spawn a prefab at a place or object; remove a copy) | ✅ copies of scene objects (templates) | B2 |
| **More things blocks can do to objects**: scale, become physical (unanchor), push, spin speed, move toward or follow an object, teleport the player | ✅ | B2 |
| **Textures and materials from image files**, lights that light the level, sky, sound | ❌ dev textures, unlit | B3 (Phase 7) |
| **Imported 3D models** (props, creatures), with animations | ❌ brushes and simple shapes only | B3 / A2 |
| **Standalone export** (Windows, macOS, Linux, web) | ❌ plays only in the editor | B4 (Phases 8–9) |
| **Saving progress** (in the exported game) | ❌ | B4 |

## Basic: typical Roblox games

Roblox games are made to be played online with other people. The table assumes **single-player versions** first; multiplayer is decision M1 below.

### Tycoon

You own a plot. Droppers make parts, conveyors carry them to a collector that pays you, and you buy buttons that build more of the base.

| Need | Now | Step |
|---|---|---|
| Plot built from brushes and prefabs | ✅ | — |
| Buy buttons: step on, pay if you have enough cash, the bought part appears | ✅ Cash game value + zone + Show (tested in `tycoon.test.ts`) | — |
| Droppers make a part every few seconds | ✅ | — |
| Conveyor belts carry parts | ✅ Conveyor component | — |
| Collector removes parts and pays their value | ✅ Remove + “value of the thing that entered” (tested) | — |
| Price signs over buttons | ✅ Text signs | — |
| Cash on screen | ✅ | — |
| Keep progress between sessions | ❌ | B4 |
| Third-person camera (usual on Roblox) | ✅ game rule | — |
| Several players with their own plots | ❌ | M1 |

### Natural Disaster Survival

Rounds: everyone is put on a map, a random disaster strikes (flood, tornado, meteors, earthquake), and the survivors win.

| Need | Now | Step |
|---|---|---|
| Lobby and maps, round timer | ✅ timers, Round value on screen, messages | — |
| Teleport the player to the map and back | ✅ | — |
| Random disaster | ✅ random number + if | — |
| Flood: rising water that kills | 🟡 a rising deadly zone works; no water to see or swim in | A1 water |
| Buildings that break (parts become physical) | ✅ Make it fall | — |
| Tornado or wind pushing things | ✅ Push (objects and the player) | — |
| Meteors | ✅ copies with Physics | — |
| "You survived!" message | ✅ | — |
| Several players | ❌ | M1 |

### Grow a Garden

Buy seeds, plant them in your plot, wait for them to grow (even while away), harvest, and sell.

| Need | Now | Step |
|---|---|---|
| Plant where you point | ✅ copy at where the player looks | — |
| Plants grow over time (get bigger, change stage) | ✅ Scale; 🟡 stages by swapping copies | B3 models |
| Inventory and hotbar (seeds, tools) | ❌ | B5 inventory |
| Shop window with buttons | ❌ | B5 screen UI |
| Sell zone pays for crops | ✅ zone + “value of the thing that entered” | — |
| Growing while you're away, saved garden | ❌ | B4 save, real-time clock |
| Weather events (rain, gold mutations) | ❌ | B3 particles, B2 |

### Pet Simulator

Break coins and chests to collect currency, buy eggs that hatch random pets, pets follow you and help break things, unlock new zones.

| Need | Now | Step |
|---|---|---|
| Breakable coins and chests with health | ✅ Breakable + Damage + When this breaks | — |
| Several currencies | ✅ game values | — |
| Eggs: random pet by rarity | ✅ random + copies | — |
| Pets follow the player | ✅ Move to the player in a loop (tested) | — |
| Pet inventory, equip | ❌ | B5 inventory |
| Gates to new zones that open when paid | ✅ door recipe + score check | — |
| Third-person camera ✅; saving ❌ | 🟡 | B4 |
| Trading and seeing other players | ❌ | M1 |

## Advanced: Slime Rancher

A first-person ranch game on large outdoor islands. You suck up slimes and food with a vacuum gun, keep slimes in corrals, feed them, and sell their plorts at a market whose prices change.

| Need | Now | Step |
|---|---|---|
| First-person movement | ✅ | — |
| **Large outdoor terrain** (hills, cliffs, beaches) sculpted and painted | ❌ brushes only | T1 terrain |
| Foliage, rocks, trees placed many at once | ❌ | A2 scatter |
| **Animated creatures** (models with animations) | ❌ | A2 models |
| **Creature behaviour**: wander, hop, look for food, flee, get agitated, eat and produce plorts | ❌ | A2 behaviours |
| Finding paths on terrain | ❌ | A2 navigation |
| **Vacuum gun**: pull physics objects in, hold them in slots, shoot them out | ❌ | A1 held tools |
| Hundreds of physics objects at once | 🟡 Rapier handles it; not measured | A2 performance check |
| Corrals, feeders, silos built on plots | ✅ copies | — |
| Market with changing prices, upgrade shop | 🟡 prices as game values and signs; no shop window | B5 UI |
| Day and night, sky, lighting, water | ❌ | B3, A1 water |
| Sound and music | ❌ | B3 |
| Save the ranch | ❌ | B4 |

## Advanced: Half-Life 1

A first-person shooter built from brush levels (the kind CocoaWorlds is designed around), with monsters, scientists, weapons, scripted scenes, and levels joined into one long journey.

| Need | Now | Step |
|---|---|---|
| Brush levels, textures per face, hidden faces removed | ✅ (dev textures only) | B3 for real textures |
| Player movement, crouch, jump, steps, fall damage | ✅ (Half-Life 2 numbers; Half-Life 1 is close) | — |
| Triggers, multi-step logic (multi_manager, trigger_relay) | ✅ zones, messages, waits | — |
| Doors, buttons, lifts, rotating doors | ✅ recipes + pivots | Phase 6 ready-made objects |
| Pushable crates | ✅ | — |
| Health ✅; **armour (HEV suit)**, health and suit chargers | 🟡 | A1 |
| **Ladders, water and swimming** | ❌ | A1 (Phase 6) |
| **Weapons**: hitscan, projectiles, grenades, explosions, ammo, switching, view models | ❌ | A1 weapons |
| **Breakable objects** (func_breakable) ✅; gibs ❌ | 🟡 | A1 |
| **Monsters and NPCs**: models, animation, AI (see, chase, attack, take cover), following the player | ❌ | A2 models, A1 NPCs |
| NPC movement through the level | ❌ | A2 navigation |
| Trains and moving platforms along paths (func_train, func_tracktrain) | 🟡 moves are straight lines | A1 paths |
| Scripted scenes (scientists walking, talking) | ❌ | A1 |
| **Level changes** with the player carried over (changelevel, landmarks) | ❌ one scene at a time | A1 |
| Baked lighting, sprites, decals (bullet holes, blood), particles | ❌ | B3, A1 |
| Sound: footsteps, ambient, voices | ❌ | B3 |
| HUD: health, armour, ammo | 🟡 health | A1 |
| Quick save and load anywhere | ❌ | B4 |

## How far each target is (rough)

| Target | Ready today | Main missing pieces |
|---|---|---|
| Tycoon | ~60% | looks (B3), export and saving (B4), several players (M1) |
| Natural Disaster Survival | ~55% | water, looks and sound (B3), export (B4), several players (M1) |
| Grow a Garden | ~40% | inventory and shop UI (B5), saving and real-time growth (B4), models (B3) |
| Pet Simulator | ~45% | inventory (B5), models (B3), saving (B4) |
| Half-Life 1 | ~35% | weapons, NPCs and AI, models, level changes, lighting and sound |
| Slime Rancher | ~15% | terrain, creatures with behaviour, vacuum tool, models |

## Decisions (approved 2026-11-01)

- **M1 — Multiplayer:** single-player for now; an option to host and join games comes later. The runtime keeps game state in one place and input separate from simulation, so networking can be added.
- **T1 — Terrain:** voxel terrain that also supports heightmaps: chunked voxels meshed in a worker (caves, overhangs and digging possible), heightmap images can be imported, sculpting includes raise, lower, smooth and flatten, up to 8 painted materials, a collider per chunk.
- **Models:** glTF/GLB import, static and animated.
- **Navigation:** navigation meshes generated with recast-navigation (WebAssembly) from the level and terrain.
- **Screen UI:** a visual UI editor (text, images, buttons, bars, lists in anchored boxes), controlled by blocks.
