# Ladders, water, armour and chargers

Both are brushes you draw with the Brush tool. Pick the kind **Water** or **Ladder** next to Solid, Cut,
Trigger and COL. You can also add a **Water** or **Ladder** component to any brush. Neither kind is solid,
and neither moves when a script moves it (scripts can't move them yet).

## Ladders

A ladder is an invisible zone (green in the editor). Put it in front of whatever looks like a ladder: a brush
painted with a ladder image, or a model.

- **Forward** climbs while looking ahead or up, and goes down while looking down. **Back** does the opposite.
- **Left and right** move along the ladder.
- With no keys pressed, the player holds still.
- At the top, keep going forward: forward also steps the player off onto the floor.
- **Jump** lets go, pushing the player off backwards. Coming off a ladder never causes fall damage.
- **Climb speed** is set on the component (200 u/s by default, as in Half-Life).

## Water

Water is drawn with its own faces' materials and doesn't hide anything behind it. New water brushes use the
built-in **Water** material, which is see-through, glossy and seen from both sides. For your own look, make a
material in the Materials workspace with opacity below 1, **Seen from both sides** switched on (so the
surface shows from underneath), and a scroll if it should flow.

How the player moves in water (Source's rules):

- Once in water up to the waist, the player swims. **Forward** goes where the view points, so look down to
  dive. **Jump** rises and **Crouch** sinks. Swimming speed is 80% of running.
- Left alone, the player sinks slowly (60 u/s).
- At the surface, swim forward against the edge while holding **Jump** to climb out onto a ledge.
- Falling into water never hurts.
- **Can drown** (on by default): after 12 seconds with the head under water, the player loses 10 health a
  second.

Physics objects float. Heavy or light, they settle with their middle a little under the surface, and the water
slows them down.

Under water, the view takes on **Colour under water** and only reaches as far as **Seeing distance**.

# Armour and chargers

**Armour** works like Half-Life's suit power. It takes 80% of each hit, losing one point of armour for every
two points of damage it stops. Once it runs out, the rest of the damage goes to health. Falls and drowning go
straight past it. The player can carry up to 100 armour; it shows under health once there is any, and it's
lost on dying.

- Blocks: **Give the player armour** (Player and score), and the value **the player's armour**.
- Recipe: **Armour battery: +15 armour** works like the health pack: walk into it to pick it up.

A **Charger** component turns any object into a wall charger. While the player looks at it and holds **E**,
it gives **Health** or **Armour** at **Per second** (10 by default), until the player is full or the charger
has given all it **Holds** (50 by default, Half-Life's health charger). The use prompt shows while it has some
left.

# Stamina

With the **Stamina** game rule on, Shift sprints (290 u/s) instead of walking. Sprinting uses 20 a second and each
jump 12 (no jump without 12); after 0.8 s without either, it comes back at 28 a second. Run out and the player
can't sprint again until it is back to 30. A thin bar at the bottom of the screen shows it while it isn't full.
Code: `Player.tires`, `stamina`, `sprinting` (`player.ts`).

# Picking things up

Use on a physics object (Physics › Moves: Falls and tumbles) of 50 kg or less picks it up: it's held in front
of the eyes, 56–96 u away (as far as it was when picked up), and follows the view. It's steered there by speed
(at most 1500 u/s, reaching its place in about a tenth of a second), so it bumps into walls instead of passing
through them. It keeps how it is turned relative to the way the player faces (it turns with them); holding R
makes the mouse turn it instead of the view (sideways spins it, up and down tips it). R only does this while
something is held, so scripts can still use R otherwise. The mouse wheel pushes it away (up) or brings it closer
(down), 40–150 u from the eyes; it changes the hotbar slot only when nothing is held. Use again drops it with the speed it has; Fire throws it where the player
looks (2400 / √kg u/s, at most 1000), in place of the weapon in hand. It's dropped by itself when kept more than
128 u from its place for 0.4 s (caught on something), when the player dies, and during scripted scenes that hold
the player still. What's held never blocks the player's movement. The use prompt shows on things that can be
picked up.

A Use script, a friend or a charger on the object (or what it's part of) comes first: those are used instead.
Physics › **Can be picked up** (on by default) turns it off for one object. The game reports `pickup` and `drop`
events. `GameWorld.holding` is what's held. `runtime/world.ts` (Carrying).
