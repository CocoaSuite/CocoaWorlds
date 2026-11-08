# Realistic sound (acoustics)

Scene setting **Realistic sound** (Inspector › Sound; on unless switched off). With it on:

- **Walls muffle by material.** Each wall between a sound and the ears takes off dB by what it's made of and
  how thick it is, and dulls the highs: glass and wood a little, concrete and stone a lot, earth (a hill)
  almost all. Two walls lose twice as much as one. The table is `ACOUSTIC_MATERIALS` in
  `packages/runtime/src/acoustics/materials.ts`, keyed by the surface kinds footsteps already use.
- **Sound goes round.** Behind a wall, a sound is also heard the way it can travel through the air: round
  corners, along corridors, through open doorways, up stairwells. It's heard *from* that way (the doorway's
  direction) and as far off as the way is long, dulled a little for the bend. The louder of straight-through
  and round wins.
- **Doors matter.** A closed door stops the way round (only the door's own material lets sound through); an
  open one lets it round. Anything moved by scripts (doors, lifts) counts where it is now.
- **Places echo by themselves.** Where no Sound area says otherwise, the ears' surroundings pick the echo:
  open air (none), small room, corridor, hall or cave (rock and earth), softer for carpet and earth, harder
  for tile and concrete. A Sound area still sets its own; under water still muffles.
- Small things (radius under 20 u: a mug, a carried box) and physics objects, creatures, zones and water
  don't stop sound. A sound inside its own object (a radio's box) isn't hidden by it.

## How it works, and what it costs

All in `packages/runtime/src/acoustics/` (plain TypeScript over the physics world; tested in Node):

1. **Straight:** one multi-hit ray from the ears to the sound finds where each wall starts; one ray back
   against each of those colliders alone finds where it ends. Touching pieces merge into one wall.
2. **Round:** a coarse air grid (48 u) over the level, each point joined to its neighbours when nothing
   solid is between them. Measured from the physics world a chunk (16³ points) at a time, near the ears,
   only while some sound is behind a wall, a slice per frame, then kept; a box test skips empty blocks with
   one query. From the ears, a Dijkstra flood over a 56 × 20 × 56 window gives the distance through the air
   to every point and the way back; it runs a slice per frame, only when the ears moved a point or the
   level changed and something is behind a wall, and stops as soon as every such sound is reached.
   Where a moving body (a door) moved, the points round it are measured again.
3. **Scheduling:** a sound is looked at again only when it or the ears moved (more the farther it is) or
   the level changed — no sooner than its interval (0.08 s loud and near … 0.9 s faint) — loudest first,
   at most 6 per frame, all within 0.8 ms per frame (measuring at most 0.25 ms). Out of range: not looked
   at. Nothing is allocated per frame in the flood; arrays are sized once.
4. **The room:** 13 rays from the ears every 0.4 s while moving (2.5 s standing), classified, changed only
   when seen twice running.

In the editor's player (`viewport/play-session.ts`, `lean-audio.ts`, `area-sound.ts`):

- Each 3D sound gets a lowpass and a volume between its source and panner, glided to new settings.
- Positions go to the panner only when they move (three's PositionalAudio schedules six changes per sound
  per frame); sounds heard round glide to where they're heard from.
- The 6 loudest sounds use HRTF panning; the rest plain stereo (HRTF costs a convolution per sound).
- Looping sounds out of range are unplugged from the graph until they're back in range.
- An echo that has faded out is unplugged (a convolver costs CPU even at no volume).
- Footsteps and hits reuse a pool of 8 sounds rather than making nodes per step; each is worked out once
  when it starts.

Options (`ACOUSTIC_DEFAULTS`): `budget`, `buildBudget`, `perFrame`, `fastest`, `slowest`, `moved`, `bend`
(dB per doubling of the extra way), `small`, `environment`, and the grid's `cell` and `window`.

## Measured

`npm run bench:acoustics` (plain Node, no editor) walks the ears corner to corner through 12 × 12 rooms
(each wall with a doorway, one and three storeys) for 20 s with 8–256 looping sounds. On a 2-core cloud VM
(2026-11-08), after the first 2 s:

| Level | Sounds | Avg ms/frame | Median | p99 |
|---|---|---|---|---|
| 1 storey | 8 | 0.22 | 0.23 | 0.86 |
| 1 storey | 64 | 0.32 | 0.23 | 1.78 |
| 1 storey | 256 | 0.41 | 0.36 | 0.89 |
| 3 storeys | 8 | 0.27 | 0.26 | 0.84 |
| 3 storeys | 64 | 0.38 | 0.32 | 1.43 |
| 3 storeys | 256 | 0.54 | 0.50 | 1.77 |

The cost is capped: it doesn't grow with more sounds past ~128 (only the loudest due ones are looked at
each frame), and most of it while walking is measuring new parts of the grid, which is done once per place.
With nothing behind a wall, the grid isn't measured or flooded at all. The memory is ~2 MB for the flood
(made the first time one is needed) plus 4 KB per measured chunk. Spikes over 1 ms showed up as often in a
fixed control workload on the same machine (p99 0.76–1.5 ms, peaks 4–11 ms), so they're the VM's, not the
engine's; none had a garbage collection in them. Before this, the runtime did no per-frame sound work at all
(the old system only routed sounds in sealed base rooms), so these numbers are the whole added CPU cost on the
game's thread. The audio thread's cost (filters, panners) can't be measured in Node; there, fewer HRTF
panners, unplugged out-of-range loops, unplugged idle echoes and position updates only on change should more
than pay for one lowpass and one gain per 3D sound.
