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
dying, running, being busy, being hurt and pulling the player out of a hiding spot, separated by commas (the default is `idle, walk, attack, die`).
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

## Hiding spots

A **Hiding spot** component (Add component › Hiding spot) on a locker, a wardrobe or a plank propped over a gap
lets the player get in with **E** (its **Prompt** shows, “Hide” by default) and out with **E** again. Getting in,
the view moves quickly to the spot's eyes (**Getting in takes**, 0.25 s); getting out, it moves back and the
player stands where they were when they pressed E.

| Setting | What it does |
|---|---|
| Look from | An object placed and turned where the eyes go, looking along its −Z (an empty object inside the locker). Empty: this object (a brush: its middle, looking north). |
| Eyes at | Moves the eyes from there, in that object's own axes. |
| Look left and right | How far the view turns each way. 0: fixed, as through a locker's slats. |
| Look up and down | The same, up and down. |

Inside, the player can't move, fire or be seen. A creature that **sees them getting in** knows: it goes to the
spot, plays its pulling animation (the 8th name in **Animations**; without one, its attack), and the player is
pulled out and held still for its **Pulling out takes** time, after which it attacks. A creature that didn't see
them get in loses track of them, as when they slip out of sight.

Blocks: **When the player hides in this**, **When the player comes out of this** and **When a creature finds the
player in this** (on the spot); **Make the player come out of hiding**; the value **the player is hiding**.

## Googly eyes

A **Googly eyes** component (Add component › Googly eyes) sticks a pair of cartoon eyes on any point object: a
model, a creature, an empty object. Their pupils roll about loose. They fall to the bottom of the eye, rattle
when the object starts, stops, turns or bounces, swing as a creature walks, and slide round the rim as it tips
over. Dragging the object in the editor shakes them too.

| Setting | What it does |
|---|---|
| Eyes | Two, or one big one. |
| Size | Across one eye (12 u by default). |
| Apart | From the middle of one eye to the middle of the other. |
| Position | Where the eyes sit, from the object's origin, in its own axes, with the model standing still (as the editor shows it). They look the way the object faces (−Z). On a plain creature figure they start on the front of its head, on the ready-made chicken over its own eyes; on another model, move them to its face. |
| Turned out | 0: both look ahead. Up to 90: they look to the sides, like a bird's or a fish's. |
| Looking up | Each eye tipped up (or, below 0, down). |
| Ride on a bone | On a model with bones (on by default), the eyes ride on one, so its animations carry them: a pecking, bobbing or dying head takes them along, and the pupils rattle as it goes. |
| Bone | Which bone, by its name in the model. Empty: the head (the first bone with “head” in its name). With no such bone, the eyes stay on the object. |
| Pupil size | The pupil as a part of the eye. |
| Loose | 0: the pupils barely move. 1: they rattle about at every bump. |
| Eye colour, Pupil colour | White and black by default. |

**The chicken** comes with them (Add › Chicken), and Googly eyes added to a chicken already in the scene start in
the same place: over its own eyes and about their size, looking out to the sides and up, riding on its head.

In the editor, models stand still, so the eyes ride on the bone only in Play. They are lit like everything else: they catch the lights and the sky's reflections, cast small shadows, and
have a glossy plastic cover. They follow their object in Play: a creature as it walks (and falls when it dies),
a physics object as it tumbles, and an object carried by a moving one (a train, a lift).

How it works: each eye is a shallow dome drawn by one shader on a lit physical material, with the white, the
pupil, its shadow and the clear rim all drawn in the shader. The pupil's place comes from a small simulation
each frame (gravity, the eye's own acceleration, bouncing off the rim) in `viewport/googly-eyes.ts`. Riding on a
bone: once the model has loaded, still in its rest pose, the eyes are moved onto the bone keeping where they are.

## Finding the way (navigation)

When play starts, the game measures where creatures can walk. It probes the level straight down on a 16 u
grid, so every floor counts (a room, the storey above, a bridge), and keeps the spots where a person-sized
creature fits: half its width from walls and with room overhead. Neighbouring spots join if one step (up to
20 u) or a short drop (up to 64 u) gets from one to the other; slopes up to 46° are walkable.

A creature heading somewhere further than about 48 u away asks for a way there and walks it corner by corner:
out of a dead end, round a wall to its gap, up stairs to another floor. It works the way out again every second
and a half, or sooner when what it's after moves off. On the way it still steers round crates and other
creatures, and with no way found it heads straight there as before (and a wandering one gives up on that spot).

**View › Show where creatures can walk** draws the spots (green dots) and their links in the editor. It is
worked out again a moment after each change, and while playing shows what the game itself measured.

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
| Googly eyes | on its head, over its own eyes | the same |

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
