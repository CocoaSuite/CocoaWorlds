# Screen UI and items

The **Screens** workspace (top bar: Scene · Screens · Materials) is the screen UI editor. It fills the window:
screens and items on the left, the picked screen in the middle at 16:9, and the picked element's settings on
the right. Everything is saved in the scene (`settings.ui`) and undone with Ctrl+Z like any edit. Play always
switches back to the Scene.

## Screens

A screen is a layer over the game. **Shown at start** puts it up when the game begins; blocks show and hide it
later. **Frees the mouse** is for shops and menus: while such a screen is shown the mouse is free to click its
buttons instead of turning the view (WASD still move), and it is captured again when the screen goes away.

## Elements

| Element | What it is |
|---|---|
| Text | Words on screen. `{Cash}` shows a game value; `{health}` and `{score}` the player's. |
| Button | Text on a background; “When the player clicks [button]” runs when it is clicked. |
| Panel | A coloured box (behind other elements: add it first). |
| Image | A texture from the project's Assets. |
| Bar | Fills by a value (a game value, health or score) out of its **Full at** amount. |
| Hotbar | The player's items in slots, the picked slot outlined. |

Each element **hangs from** one of nine anchors (the 3 × 3 grid); its **offset** is how far it sits in from
those edges (from the middle for the middle anchors). Layout is in a 1280 × 720 screen, scaled to the window's
height in the game, so a layout looks the same at any size. On the stage, drag to move, drag the corner square
to resize (both snap to 4 px; hold Alt for free), use the arrow keys to nudge (Shift: 16) and Delete to remove.

## Items and the inventory

**Items** (left side) are the things the player can carry, each with a name and an optional picture (a
texture; without one the hotbar shows its first letters). The player's inventory is a count per item, in the
order they were first picked up; an item at 0 leaves the hotbar. In the game, **1–9** and the **mouse wheel**
pick a hotbar slot, and a **left click** uses the item in it.

## Blocks

| Block | |
|---|---|
| When the player clicks [button] | Event. Only while its screen is shown and the button is visible. |
| When the player uses [item / any item] | Event: a left click with that item in hand. |
| Show the screen / Hide the screen [screen] | |
| Show / Hide [element] | Elements start visible or not (the element's **Visible**). |
| Set the text of [text or button] to [text] | Replaces its text (`{Name}` still works in the new text). |
| Give the player [n] [item] · Take [n] [item] from the player | Never below 0. |
| how many [item] the player has · the item in the player's hand | Values. |

The checker reports screens, elements and items that no longer exist, and clicks on something that isn't a
button.
