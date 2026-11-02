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

**Attacks** can be **Up close** (within **Reach**, **Damage** at **Attacks a second**), **Shooting** (it stops
where it can see the player and fires bullets with an **Aim spread**), or **Never**.

Shots, swings and blasts take its **Health**. At 0 it dies: a plain figure falls over, a model plays its dying
animation, and shots go through. **Animations** names the model's animations for standing, walking, attacking
and dying, separated by commas (the default is `idle, walk, attack, die`). Animations it doesn't have are
skipped.

Blocks for creatures:

- **When this is hit** runs when it is shot, struck or blasted. **When this creature dies** runs when it dies.
- **Damage** works on creatures as on breakable objects.
- **Walk a creature to a place** (Objects) walks it to an object, the player, or where the player looks. The
  stack waits until it gets there; meanwhile it does nothing else.

Creatures go straight towards where they're heading, sliding along walls and climbing steps. Finding a way
round obstacles comes with navigation meshes (A2).

## Scripted scenes

A scripted scene is an ordinary stack of blocks: walk creatures about, play their animations and sounds, show
lines of text (**Show a message on screen**), open doors with messages, and wait in between. Three blocks help
(under Player and score):

- **Freeze the player** holds the player still. They can look around, but can't move, jump, use or fire.
- **Let the player move again** ends that.
- **Look through an object (camera)** shows the game from an object (looking along its −Z) for a number of
  seconds; the stack waits. An empty object placed and turned where the camera should be is enough. If the
  object moves (on a train, or moved by blocks), the view goes with it.
