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
