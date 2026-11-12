# Frame-time bench

Plays one busy level in the editor for about half a minute and writes down how long each frame took, and where
the time went. Run it on your own computer (with its real graphics card), before and after a performance change,
to see what the change did. It decides which step of the
[performance plan](../../docs/proposals/performance-architecture.md) comes next.

## Run it

You need the repository with its packages installed (Node 22 or newer).

1. Get the latest version and its packages:
   ```
   git pull
   npm install
   ```
2. Build the editor:
   ```
   npm run build
   ```
3. Plug a laptop in (on battery the graphics card is slowed down), close games and video, then:
   ```
   npm run bench
   ```
   The editor opens by itself, makes a project called Bench, opens it and plays. **Leave the window alone**
   until it closes (about 1½ minutes); don't click it, don't cover it.
4. At the end a table is printed, and saved in `tools/bench/results/` as `<date>-<commit>.md` (and a `.json`
   with every frame). Send the `.md` file, or paste the table.

Options (after `--`, e.g. `npm run bench -- --seconds 60`):

| Option | What it does |
|---|---|
| `--seconds N` | Measure for N seconds (default 30), after 8 seconds of warming up. |
| `--build` | Build the editor first (it is built by itself only when it has never been built). |
| `--software` | Draw with the software renderer instead of the graphics card (for machines without one; much slower). |
| `--breakdown` | Also count draw calls and time per pass (main view, the sun's shadow, each bulb's shadow, reflections, effects). The time waits for the graphics card after each pass, so it shows which pass is slow. |
| `--project <folder>` | Play a copy of your own project (its first scene) instead of the bench level; the original folder is not touched. The player only turns and walks (no rockets). |
| `--profile` | Also record where the UI thread's time goes, function by function (two tables in the `.md`, and a `.cpuprofile` file DevTools can open). |

If it fails, it says why and leaves a picture of the window in `tools/bench/results/failure.png`.

## What it plays

The level (`scene.ts`, the same every run):

- 64 rooms (an 8 × 8 grid of 512 u rooms with doorways), lit by 16 bulbs, 4 of them casting shadows, and the sun;
- 200 physics crates in piles;
- 40 creatures that wander and hunt the player when they see or hear them (10 of them with the Hunter mind);
- 2,000 plants: grass, leafy clumps and bushes everywhere, 100 trees outside the rooms.

The player walks about and turns round slowly, so every side gets drawn, and fires a rocket every three seconds
(blasts, smoke, scorch marks, crates thrown about). Health is off, so creatures that reach the player don't end
the run. The window is 1600 × 900; frames are not held to the screen's refresh rate, so the frames per second show
how fast the game could go.

## Reading the results

| Row | What it is |
|---|---|
| fps, whole frame | How fast frames came. *95%* and *99%*: the slow frames you feel as stutter. |
| game tick | The world's step plus putting what moved where it is drawn. |
| world step alone | Physics, creatures and their path search, scripts, weapons. This is what moving the world to a worker (step 2) takes off the frame. |
| drawing (CPU side) | Preparing and sending the frame to the graphics card. Many draw calls make this large: instancing (step 3) cuts them. |
| draw calls, triangles | How much is sent each frame. |
| Entering Play | From pressing Play until the game runs, and the longest the window stopped answering on the way (the freeze you feel). |

If the whole frame is much longer than the tick and the drawing together, the graphics card itself is the limit
(its time isn't measured directly): fewer triangles, cheaper shadows, or WebGPU later.

The status line in the editor shows the same split while playing: `world … ms · draw … ms · … draws`.
