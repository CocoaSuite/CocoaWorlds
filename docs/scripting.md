# Visual scripting

Scripts are plain-language blocks on the object they control (decision S1): a door, a zone, a button. Game-wide rules go on an empty object (e.g. “Game rules”). Scripts travel with copies, prefabs and copy/paste because they are part of the object.

## Blocks (decision S2)

| Kind | Blocks |
|---|---|
| When… | the game starts · something enters a zone · something leaves a zone · the player uses this (E, within reach; also fires on the groups it is in) · this gets a message · every N seconds |
| Do | move (up/down/north/south/east/west by a distance over a time) · turn (degrees around an axis over a time) · return to where it started · show · hide · turn on · turn off · send a message (to everyone or one object) · write in the console |
| Control | wait · if … otherwise · repeat N times · repeat forever · stop this stack |
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
| Opens when it gets the message “open” | When this gets the message “open” → move up by its height |
| Button that sends “open” when used (E) | When the player uses this → send “open” to everyone |
| Pressure plate that sends “open” | A zone on top (once) → send “open” to everyone |
| Lift that goes up and down | Game starts → repeat forever: up 128 over 2 s, wait 1, return over 2 s, wait 1 |
| Keeps spinning | Game starts → repeat forever: turn 360° over 4 s |
| Platform that vanishes when stepped on | A zone on top → wait 0.5 s, hide, wait 3 s, show |
| Pickup the player collects | A zone around it (once) → hide, write “Picked up …” |
| Coin: +1 score when collected | A zone around it (once) → hide, change the score by 1 |
| Health pack: +25 health | A zone around it → if not taken and health < 100: heal 25, hide |
| Hurts the player who stands in it | A zone over it → 10 damage every 0.5 s while the player is inside |
| Deadly: touching it kills the player | A zone over it → hurt the player by 1000 |

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

**Conveyor** (component on a brush): carries physics objects lying on it and the player standing on it, at a
speed towards north, south, east or west. **Breakable** (component): the object's health.

**Third-person camera** is a game rule (Inspector with nothing selected): the camera follows behind and above
the player, comes closer when a wall is in the way, and the player is drawn as a simple body.

## Use prompts

“When the player uses this (E)” has a prompt word. While the player looks at the object within reach, the
screen shows **E** and the word under the crosshair (“E Open”); with no word it shows “Use”. The door recipe
uses “Open”, the button “Press”.
