# Ladders and water

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
