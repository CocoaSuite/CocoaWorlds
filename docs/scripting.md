# Visual scripting

Scripts are plain-language blocks on the object they control (decision S1): a door, a zone, a button. Game-wide rules go on an empty object (e.g. “Game rules”). Scripts travel with copies, prefabs and copy/paste because they are part of the object.

## Blocks (decision S2)

| Kind | Blocks |
|---|---|
| When… | the game starts · something enters a zone · something leaves a zone · the player uses this (E, within reach; also fires on the groups it is in) · this gets a message · every N seconds |
| Do | move (up/down/north/south/east/west by a distance over a time) · turn (degrees around an axis over a time) · return to where it started · show · hide · turn on · turn off · send a message (to everyone or one object) · write in the console |
| Control | wait · if … otherwise · do one of these at random (each choice as likely; + Another choice) · repeat N times · repeat forever · stop this stack |
| Variables | set · change by (per object; number, yes/no or text) |
| Values | number · text · yes/no · variable · maths (+ − × ÷ mod) · compare (= ≠ < > ≤ ≥) · and/or · not · random (whole numbers give whole results) · join text · an object · “the thing that entered” · seconds since start |

## How it runs (D6)

`packages/scripting`: the block model (`model.ts`), editing helpers (`edit.ts`), the checker and compiler to IR (`compile.ts`), and the VM (`vm.ts`). Plain data, no engine imports; unit-tested with a fake game.

- **Checker:** problems are plain sentences pointing at a block (“The object this block points at no longer exists. Pick another one.”). A stack with an error is left out when playing; the others run.
- **VM:** each “When…” stack runs as a thread. Moves, turns and waits pause the thread until they finish. A stack doesn't start again while it is still running.
- **Safety:** a thread may run 10,000 instructions per frame; a loop that never waits is stopped and reported at the loop, and the game continues. Division by zero stops only that stack.
- **Runtime (`packages/runtime`):** objects that scripts move, turn, hide or switch become script-driven bodies that push things out of the way. A group moves as one piece (a door with its frame). Hide and Turn off switch collisions off (a hidden physics object keeps falling). Moves ease in and out.

## In the editor

- **Add component › Script** on any object, or **Edit blocks** in its Inspector, opens the **Visual script** tab.
- “+ When…” adds a stack; “+ Add a block” adds to a list; on each row, + adds after it, ↑ ↓ move it, × removes it. ▾ next to a value turns it into another kind of value (a variable, maths, a random number …).
- Problems appear under the block and in the **Problems** tab (click to jump to the script).
- While playing, the running blocks are outlined; Write blocks and script errors appear in the console.

## Pivots

“Move” and “Turn” act on an object's pivot: by default the middle of a brush or of a group's brushes. To swing a
door on its hinge, select it, press **O** (Edit pivot) and drag the pivot onto the hinge edge; it snaps to corners.

## Recipes (V2)

**Recipes…** (in the Inspector under the components, or in the Visual script tab) puts a ready-made mechanic
on the selected object. A recipe adds ordinary blocks to the object's script, plus a trigger zone next to the
object when it needs one, in one undo step. Change the blocks afterwards like any others.

| Recipe | What it adds |
|---|---|
| Door that opens when the player comes near | A zone 96 u around the door; enters → move up by the door's height; leaves → return |
| Door that opens when used (E) | When the player uses this → move up, wait 3 s, return (an `open` variable stops it restarting) |
| Opens on the message “open”, closes on “close” | “open” → move up by its height (once, while open); “close” → return |
| Swinging door that opens when the player comes near | Pivot on its hinge; a zone 96 u around; enters → turn to 90°; leaves → turn to 0° |
| Swinging door: E opens and closes it | Pivot on its hinge; when the player uses this → turn to 90°, or back to 0° if open |
| Swinging door that stays open while it gets “open” | Pivot on its hinge; “open” starts coming → turn to 90°; “open” stops coming → turn to 0° |
| Button that sends “open” when used (E) | When the player uses this → send “open” to everyone |
| Pressure plate: sends “open” while stood on | A zone on top → while the player is inside the zone: send “open” |
| Lift that goes up and down | Game starts → repeat forever: up 128 over 2 s, wait 1, return over 2 s, wait 1 |
| Keeps spinning | Game starts → repeat forever: turn 360° over 4 s |
| Platform that vanishes when stepped on | A zone on top → wait 0.5 s, hide, wait 3 s, show |
| Pickup the player collects | A zone around it (once) → hide, write “Picked up …” |
| Coin: +1 score when collected | A zone around it (once) → hide, change the score by 1 |
| Health pack: +25 health | A zone around it → if not taken and health < 100: heal 25, hide |
| Hurts the player who stands in it | A zone over it → 10 damage every 0.5 s while the player is inside |
| Deadly: touching it kills the player | A zone over it → hurt the player by 1000 |

Swinging doors turn on a **hinge**: the recipe sets the door's pivot at one end of its long side, at mid
height, and uses **Turn [object] to [angle]° from its start**, which turns to an angle measured from how the
object started (90 open, 0 shut), however far it had turned. Move the pivot (O) to hinge it at the other end.

## Moves that cut each other short

A new move or turn on an object replaces the one it is in the middle of. **Move by** and **Turn by** add to where
the unfinished one was *going*, not to where the object happens to be, so nothing is lost: a plate that goes
“down 6” when stepped on and “up 6” when left always comes back to the same height, however quickly the player
steps on and off. (**Move to**, **Turn to** and **Return** aim at a fixed place anyway.)

## While, “is inside”, and messages that keep coming

- **Repeat while [condition]** runs the blocks inside again and again while the condition holds, then goes on
  to the next block. It runs at most once a frame, so it never freezes the game (no Wait needed).
- **[the player / an object] is inside [zone]** is a yes-or-no value: whether it is in the trigger zone now
  (also for zones marked Only once).
- A message sent again and again without a break, such as from a “while” loop, **counts as one**: “When this gets
  the message” starts once when it begins, and **When the message [name] stops coming** starts when it hasn't come
  for 0.1 s. Messages with a pause between them each start “When this gets the message” as before.

So a plate that holds a door open is two short scripts: the plate says *when something enters → repeat while the
player is inside the zone: send “open”*, and the door says *when this gets “open” → turn to 90°; when “open” stops
coming → turn to 0°*. Messages can go to everyone or to one object (“to”).

## Copy and paste

The ⧉ button on a block copies it with everything inside it; on a stack's “When…” row it copies the whole stack.
Paste from **+ Add a block** (or the + after a block) and from **+ When…**. With the keyboard, click a block's
words to pick it, then **Ctrl+C**, **Ctrl+X**, **Ctrl+V** (pastes after it), **Ctrl+D** (duplicate) and
**Delete**. Copied blocks stay on the clipboard while the editor is open, so they paste into other objects'
scripts too.

## Health and score

The player has 100 health, shown in the bottom-left corner while playing; the screen flashes red when hurt.
At 0 the player dies, every “When the player dies” stack runs, and they start again at the Player start with
full health (the score is kept). A project that doesn't want health or a score switches them off under
**Game rules** in the Inspector (with nothing selected); their blocks then do nothing and are marked with a warning. Falls hurt (Half-Life 2's numbers: safe up to about 170 u, fatal from about
530 u), and falling out of the world counts as dying.

| Block | What it does |
|---|---|
| Hurt the player by *n* | Takes *n* health (a negative number heals) |
| Heal the player by *n* | Gives *n* health back, up to 100 |
| Change the score by *n* | Adds *n* to the score (the score appears on screen the first time a script uses it) |
| the player's health, the score | Values for comparisons and text (“If the player's health < 30 …”) |
| When the player dies | Runs when health reaches 0, after the player has started again |

## Game values, messages and signs

**Game values** are shared by every script in the project: Cash, Gems, Round. Add them with **+ Game value**
in the Visual script tab: a name, a type (number, yes/no, text), a starting value, and whether it is shown
**on screen** while playing. They are saved in the project file straight away. In the blocks they appear in
every variable menu marked “(game)”; a script's own variable with the same name hides the game value.

| Block | What it does |
|---|---|
| Show on screen *text* for *n* seconds | A message in the middle of the screen (the last three stay up); doesn't wait |
| Set the text of *sign* to *text* | Changes what a Text sign says while playing |

A **Text sign** (Add › Text sign, or the Text sign component on any point object) shows text in the world:
the text (several lines allowed), letter height, colour, a dark background, and whether it always faces the
camera. Otherwise it is a flat plaque, read from its front (+Z) side; turn the object to aim it.

## Copies, object actions, conveyors and breakables

| Block | What it does |
|---|---|
| Make a copy of *object* at *place* | Copies the object and everything inside it so its pivot lands on the place: an object, the player, or where the player looks. The original can be hidden (a template). The copy runs its own scripts; references inside it point at the copy. A copy of something with Physics falls and rolls; otherwise scripts can move it. |
| the new copy | The copy this stack made last, for the blocks after it |
| *variable* of *object* | Reads another object's variable, such as the value of the part that entered |
| Remove *object* | Takes it (and what's inside it) out of the game |
| Move *object* to *place* over *s* seconds, stopping *n* units short | Glides there; in a Repeat forever loop this makes a pet follow the player |
| Scale *object* to *k* times its size over *s* seconds | Around its pivot; collisions match when it finishes |
| Make *object* fall and tumble | Physics takes over (a building collapsing) |
| Push *object or the player* *direction* with strength *n* | A change of speed in units per second (jump pads, wind, blasts); objects need physics |
| Put the player at *place* | Teleports the player, facing the way the object faces |
| Damage *object* by *n* | Takes health from a Breakable object; at 0 it disappears and **When this breaks** runs |
| Make an explosion at *place* size *r* u, damage *n* | A blast: hurts the player and creatures, breaks Breakable objects and throws physics objects within *r*, less towards the edge; walls stop it (a bomb: then *Remove this object*) |

**Conveyor** (component on a brush): carries physics objects lying on it and the player standing on it, at a
speed towards north, south, east or west. **Breakable** (component): the object's health.

**Third-person camera** is a game rule (Inspector with nothing selected): the camera follows behind and above
the player, comes closer when a wall is in the way, and the player is drawn as a simple body.

## Use prompts

“When the player uses this (E)” has a prompt word. While the player looks at the object within reach, the
screen shows **E** and the word under the crosshair (“E Open”); with no word it shows “Use”. The door recipe
uses “Open”, the button “Press”. 
Every event block ends with **how often**: *every time*, *once a day* (again when the day count goes up) or
*only once* (never again). A Use stack that has had its run no longer shows its prompt (a chest, a gift box).
When the game keeps the world (Game rules), which stacks have had their run is kept too.

**What a kept world keeps** (Game rules › Keep the world): where everything is (moved, turned, scaled, shown,
hidden, switched off, falling), copies made while playing, what was removed, creatures (place, health, side),
the player (place, view, health, armour, score, hotbar slot), lights (on/off, brightness, range, cone, colour),
glows, signs' texts, posters, broken objects' health, trains (where, last and next stop, moving), screens shown
and their texts and rows, Sound components that were stopped, the silent world, the save menu blocked, the time
of day and day, every object's variables, which limited stacks have run, and stacks partway through: a
countdown carries on with the time it had left (a stack edited since the save starts over instead). What a
stack was waiting on (a move) counts as done: the thing moved was saved where it was going. The player's items
are kept by **Keep the player's items**; game values by their own **kept** tick. **When the game starts**
stacks run again after loading, as they always have (and can change what was loaded).

## Holding things and putting them in spots

Blocks for puzzles where the player carries things to where they belong (a fuse to its box, a skull to its
plinth). See also *Picking things up* in movement.md.

- **When the player uses this (E or click) while holding [X / anything], within [z] u** — on the object looked
  at (or what it's inside). It runs instead of dropping (E) or throwing (click) what's held. X matches copies of
  X made while playing too. Default reach 128 u.
- **When the player uses this** now has **within [z] u** (default 96, the player's own reach). Further than 96 u
  it only reaches stacks that say so. It runs while the player holds nothing (Use with something held drops it).
- **what the player holds** — an object choice in every object slot (nothing held: the block does nothing).
- **The player holds [X / anything]** — a yes-or-no value (X or a copy of it). “Holds nothing”: *not* it.
- **Put [object] at the spot [object] and keep it there / let it fall** — straight there, out of the player's
  hands, turned as the spot is turned (an unturned spot: as it was placed). A brush with Physics goes there by its
  middle, a point object by its origin. *Keep it there*: it stays put (it no longer falls, so plain Use won't
  pick it up; a script can). *Let it fall*: physics again, from there.
- **The player picks up [object]** — into their hands, whatever it weighs or however it moves (it's made to fall
  and tumble); what they held is dropped. **The player drops what they hold**.

“Is it in its spot” is *Distance between [it] and [spot] < 4*. Picked up by a script, an object with a Use stack
isn't picked up by plain Use (the stack comes first), so its stack does it: *When the player uses this → if
(not the player holds anything) and … → The player picks up this object*.

## Sound blocks

| Block | What it does |
|---|---|
| Play sound *file* at *place* volume *n* | Plays once; in 3D at an object, the player or where the player looks, or everywhere |
| Stop the sounds of *object* | Stops its Sound component and what its scripts played |
| Silence the world / Bring the world's sounds back | The background sound and Sound components fade out and stay silent; footsteps, hits and Play sound blocks are still heard (a silent day) |

See [rendering.md](rendering.md#sound) for the Sound component, the scene's background sound and Sound
areas (echo, muffling). Sounds played by blocks are changed by Sound areas and water.

## Key prompts

**When the player presses [key] at this, showing [text], within [n] u** works like “When the player uses this”
with a key of your choice: it runs when the player looks at this object (or anything inside it) within reach, or
holds it, and the key and text show under the crosshair (below the E prompt; empty text shows “Use”). The plain
“When the player presses a key” still works from anywhere and shows nothing. E still picks things up.

## Lights and glow

| Block | What it does |
|---|---|
| Turn on / Turn off *light* (also Show / Hide) | Switches the light only, not the object it is inside |
| Set *brightness / reach / cone / colour* of the light *light* to *value* over *n* seconds | 0 seconds: at once. Colour is text like `#ffcc88` |
| Set the glow of *object* to *n* over *n* seconds | The glowing parts of its model (and the models inside it) glow this strongly; 0 is no glow. Only materials with a glow colour change |
| *light* is on (value) | Yes while the light is switched on |

A Light's **On at start** setting makes it start switched off. Point objects inside a physics object (lights,
models, sounds, particles) ride with it in Play, so a model with Physics and a Light inside it is a floodlight
the player can carry with E.

## 3D printers and a shop

| Block | What it does |
|---|---|
| Print a copy of *object* on the printer *printer* | Like Make a copy, but the copy stands on the printer's plate (bottom on it, middle over its middle) and rises layer by layer; until it is done it doesn't move, collide or get picked up. While the printer is busy, the print waits its turn (the new copy is then empty) |
| When this printer finishes a print | Runs on the printer when a print is done; *the thing that entered* is the printed copy, now a normal object (with Physics it falls and can be carried) |

**3D printer** (component, Add › 3D printer): the print space (width, height, depth), where the build plate's
top middle is, layer height and seconds per layer (a print takes its height ÷ layer height × seconds), the
filament colour (the cut top of a print and the layer just laid), and an optional sound looping while it prints.
Its Model is the printer: Add › 3D printer brings the ready-made one (`models/3d_printer.glb`: collision boxes
named `col_` for the base and posts, so finished prints rest on the plate; settings to match). For your own, name
its moving parts in **Lift part**, **Gantry part** and **Head part** (`lift`, `gantry`, `head` by default); they
move like a fixed-bed printer: the lift climbs one layer at a time (up only), the gantry slides front-back on it,
the head slides left-right on the gantry. Each moves with the parts it is inside (without a lift, the gantry rises
itself). The nozzle is the head's lowest point, found by itself. Without a Model nothing is drawn but prints still
rise. Prints are drawn cut at the layer being laid: layer lines on the sides, the cut top in the filament
colour, and the head goes round each layer's outline (the copy's triangles cut at that height) and a zig-zag
fill at its own pace, slower for bigger prints, gliding to the next layer without jumps. Shadows and ambient occlusion leave a print out until it is done.

A copied or printed prop with Physics keeps what is inside it: brushes become part of its body (they collide
and move with it) and models ride it. Lights inside copies come along as set up on the original (a light off at
start stays off, same colour, brightness, reach and cone) and ride what they are in; a light in a print stays dark
until the print is done. Each light inside an object that a Make a copy or Print block names gets two lights made
ahead (eight at most in all), so lit copies don't stall the game; more lit copies than that stay dark.

A shop: keep the things for sale hidden somewhere as originals, show a list on a screen (Screens workspace), and
on **When the player picks a row** check the cash, change it, and print the picked thing. With **Keep the world**
on, a print under way and the prints waiting are saved with the printer and carry on after loading.

## Saved progress and the real clock

Game values marked **kept** start the next game with their last value; **Forget saved progress** starts over;
**the time now** is the real clock in seconds since 1970. See [export.md](export.md).
