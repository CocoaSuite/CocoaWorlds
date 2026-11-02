# Creatures and scripted scenes

## Creatures

A **Creature** component turns a point object (Add › Empty object) into a character. Without a Model it shows
as a plain figure: red for enemies, blue for friends, grey for neutral ones. Give it a **Model** to show your
own; it faces −Z.

| Is | What it does |
|---|---|
| An enemy | Notices the player within **Sees up to**: in front of it (within 70°) with nothing in the way, or anywhere once hurt. It comes for them and attacks. After 5 seconds without seeing them, it goes to where it last saw them and gives up. |
| A friend | Stands about. When the player uses it (E), it follows them, keeping 80–160 u away. Used again, it stays. |
| Neutral | Stands about until hurt, then fights back like an enemy. |

More settings:

- **Wanders about**: it potters near where it started. It walks a little way, stops and plays its busy
  animation (pecking, sniffing) once to three times, then goes on.
- **Runs away**: **when hurt** it runs from the player for 3 seconds (then an enemy comes back for more);
  **when the player comes near**, it keeps away from them (shy animals).
- **Clumsy**: it drifts a little off its line as it goes and stumbles now and then, nearly stopping and playing its hurt animation.
- **Height** and **Thickness**: the size of the capsule it bumps into things with (72 × 16 is a person).

**Attacks** can be **Up close** (within **Reach**, **Damage** at **Attacks a second**), **Shooting** (it stops
where it can see the player and fires bullets with an **Aim spread**), or **Never**.

Shots, swings and blasts take its **Health**; a hit that doesn't kill plays its hurt animation. At 0 it dies: a plain figure falls over, a model plays its dying
animation, and shots go through. **Animations** names the model's animations for standing, walking, attacking,
dying, running, being busy and being hurt, separated by commas (the default is `idle, walk, attack, die`).
Missing ones are skipped: running falls back to walking, and busy to standing. Animations blend into each
other over 0.15 s.

Blocks for creatures:

- **When this is hit** runs when it is shot, struck or blasted. **When this creature dies** runs when it dies.
- **Damage** works on creatures as on breakable objects.
- **When the player comes near this** runs when the player comes within a distance of it (and when the game
  starts with them that close). **When the player goes away from this** runs when they go further away than a
  distance. Both work on any object, not only creatures.
- **Damage** works on creatures as on breakable objects.

Under **Creatures**:

- **Make a creature an enemy, a friend or neutral** changes its side while playing: a nest's guard turns on
  the player who took an egg. A new enemy that can see the player comes for them at once.
- **Make a creature run away from the player for … seconds**: as fast as it can. The stack waits until it
  stops.
- **Make a creature wander about / stay where it is** turns its pottering about on or off.
- **Walk a creature to a place** walks it to an object, the player, or where the player looks. The stack waits
  until it gets there; meanwhile it does nothing else.

The value **distance from … to …** measures how far apart two things are (objects, creatures, the player), for
conditions such as “the player is within 300 of the nest”.

Creatures go towards where they're heading, climbing steps and steering round what's in the way: crates,
pillars, other creatures. They go round one side, and if that gets them nowhere, the other. A wandering
creature gives up on a spot it can't reach and picks another. Finding a way through a maze of rooms comes
with navigation meshes (A2).

## The chicken

**Add › Chicken (enemy)** and **Add › Chicken (friend)** give a ready-made creature to start from: a rigged
chicken model (copied into the project's models as `chicken_rigged` the first time; a file of yours with
that name is never replaced) at half size, with clumsy animations (`idle`,
`walk`, `run`, `peck`, `flap`, `die`) and these settings:

| | Enemy | Friend |
|---|---|---|
| Is | Neutral until you come close, then an enemy | A friend (follows when you press E) |
| Attacks | Up close: pecks for 4, 1.2 a second | Never |
| Wanders about, pecking the ground | yes | yes |
| Runs away | for 2 s when hit, then comes back | for 3 s when hit |
| Clumsy | yes | yes |
| Health, speed, size | 20, 110 u/s, 56 × 14 | the same |

Its behaviour is ordinary blocks in its **Visual script** tab, to read and change:

| Enemy | Friend |
|---|---|
| When the player comes within 160 units of this → Make this object an enemy | |
| When the player gets further than 400 units from this → Make this object neutral | |
| When this is hit → Make this object run away from the player for 2 seconds | When this is hit → … for 3 seconds |

A nest is a short step from here: replace the first stack with one that checks the nest, for example
**Every 0.5 seconds → If (distance from the player to nest < 300) and (the nest's eggs < 3) → Make this
object an enemy**.

The rest are ordinary Creature and Model components, so every setting can be changed. Selected in the editor,
a model shows a box round its whole size. How the chicken was rigged
and animated, and how to redo it, is in `tools/chicken/README.md`.

## Scripted scenes

A scripted scene is an ordinary stack of blocks: walk creatures about, play their animations and sounds, show
lines of text (**Show a message on screen**), open doors with messages, and wait in between. Three blocks help
(under Player and score):

- **Freeze the player** holds the player still. They can look around, but can't move, jump, use or fire.
- **Let the player move again** ends that.
- **Look through an object (camera)** shows the game from an object (looking along its −Z) for a number of
  seconds; the stack waits. An empty object placed and turned where the camera should be is enough. If the
  object moves (on a train, or moved by blocks), the view goes with it.
