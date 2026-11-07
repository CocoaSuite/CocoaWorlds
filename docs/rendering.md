# Lighting and rendering

The level is lit by its own Light objects in Play, and in the editor when the view's **Lighting** chip says
**Game** (View › Game lighting). With **Preview**, the editor uses flat, even lighting for building.

## Lights

| Light | What it does | Shadows |
|---|---|---|
| Bulb (point) | Lights all around, fading with distance (1/d) and stopping at its Reach | Off by default (each costs six shadow renders) |
| Spotlight | A cone along the object's −Z, with a soft edge | On by default |
| Sun | Parallel light along the object's −Z, everywhere; its shadow covers the whole level | On by default |

Brightness 1 is a plain light: a bulb of brightness 1 lights a wall about 96 u away as much as a sun of
brightness 1 does.

## Scene settings

With nothing selected, the Inspector shows the scene's settings, all with undo:

- **Ambient** colour and strength: light from everywhere, brighter from above, so nothing is pitch black.
- **Background**: the colour behind everything when there's no sky.
- **Gravity** in u/s².
- **Sky**: a gradient from **Overhead** through **Horizon** to **Below**. New scenes have one; older scenes
  start with it off.
- **Fog**: a colour, where it starts, and where it's thick.

## Day and night

**Day and night** (Inspector, nothing selected › Sky) makes the scene's first Sun go round: up in the east at 6,
highest at noon (toward where the Sun was placed), down in the west at 18. The scene's own sky, sun and ambient
colours are the look at full day; dawn and dusk warm the horizon and the sun; at night a cool, dim moon (the same
light from the other side) and stars take over, and the ambient light dims (**Night brightness**). Settings: start
hour, how many real minutes a day lasts (0: still), night brightness. The editor shows the start hour; Play and
exported games run the clock. A scene without a Sun gets one. Blocks: **Set the time of day to n**, value **the
time of day**. Code: `viewport/day.ts`, `SceneLighting.setDay`, `GameWorld.dayHour`. Reflections follow every
half hour of game time.

**Days.** The day count starts at **First day** and goes up each time the clock passes midnight (also while
sleeping in a base). **Show the day on screen** puts a Day counter with the health and score (`{day}` also works
in screen texts). Events: **When a new day starts**; **When day n starts** (at midnight, when a block sets that day,
or at the start when the game starts on it, not when resumed from a save); **When the clock reaches h o'clock**
(once each time that hour passes, also while sleeping). Statement **Set the day to n** (a different day starts:
both day events run), values **the day** and **today is day n**. Setting the time of day doesn't change the day. The day goes with the player to other scenes and is kept in saved progress (when the cycle is
on or a block changed it); “Forget saved progress” puts it back to the first day. Code: `GameWorld.passHours`,
`day`. Tests: `packages/runtime/test/days.test.ts`.

## Bloom

**Bloom** (Scene settings, on by default) puts a soft glow around anything brighter than white: lamps, glowing
materials (glow strength above 1), the sun's glare. **Glows above** sets how bright a pixel must be (lower: more
glows), **strength** and **spread** how much. It is Three.js's `UnrealBloomPass` in the same composer as ambient
occlusion (`viewport/ao.ts`): it starts at half size and blurs a few halvings, so it is cheap. Shown with
Lighting: Game, in Play and in exported games.

## Ambient occlusion

**Ambient occlusion** (Scene settings, on by default) darkens corners, creases and the ground under things, so
objects sit on the floor. It shows with **Lighting: Game**, in Play and in exported games. **Occlusion strength**
(0–2) is how dark; **Occlusion radius** is how far, in units, things darken each other. On computers without a
graphics card (software rendering) it is left out, as it would slow everything down. Shadows are cast by both
sides of every face, so light doesn't leak under walls and objects where brushes meet. Bounce light (global
illumination) is planned: see [proposals/lighting-gi.md](proposals/lighting-gi.md).

## Textures

**Assets › Textures › Import…** copies PNG, JPG or WebP images into the project's `assets/textures/` folder
(renamed to safe lower-case names). Click a texture to paint with it (Shift+click paints a whole brush), or
pick it in the face Inspector or the Paint tool, where project textures follow the built-in ones.

Faces store the texture's project path (`assets/textures/brick.png`), so levels keep working when the project
folder moves. Texture coordinates follow Hammer: at the usual scale of 0.25, a 512-pixel image covers 128 u.
Pixels less than half opaque are cut out (fences, grilles). A missing image shows Source's pink and black
checker.

Models (GLB, glTF) can be imported the same way; see Models below.

## Sound

**Assets › Sounds › Import…** takes OGG, MP3 and WAV files. Sounds are heard in 3D from the player's ears
(or the editor camera in a physics preview).

- The **Sound** component on any object: a sound, volume, loop, whether it plays when the game starts, and
  how far it is heard (full volume within a quarter of that, silent beyond). It moves with the object.
- **Play sound [file] at [place] volume [n]**: once, at an object, the player, where the player looks, or
  everywhere (not in 3D, for music and announcements).
- **Stop the sounds of [object]**: its Sound component and anything its scripts played. Removing an object
  stops its sounds too.

### Background sound and Sound areas

- **Background sound** (Inspector with nothing selected › Sound): a sound and volume that loop everywhere
  while playing: wind, birds, a hum. It starts with the game and isn't in 3D.
- **Sound area** (a component for brushes): while the player's ears are inside, everything sounds like the
  place. *Sounds like*: Nothing special, Room (short echo), Hall, Cave (long echo), Under water (muffled),
  Outdoors (no echo); *Amount* 0–1 mixes it in. Its own *Background sound* plays in place of the scene's
  while inside, and the scene's comes back on leaving. Changes fade over 0.3 s, so doors don't click.
- Where areas overlap the **smallest wins** (a room inside a cave sounds like a room). The area is the space
  inside the brush's faces (draw it as a box or other convex shape). A Sound area brush is never solid or
  drawn in the game, and can also be a Trigger zone.
- **Under water** everything is muffled, with or without an area: water does it by itself.
- A Sound component's **Creatures hear it** is its loudness for hunting creatures (0: ignored); see [creatures.md](creatures.md#the-hunter-mind).
- A Sound component's **Changed by sound areas** (on by default) can be turned off for music and interface
  sounds, which then sound the same everywhere. Sounds from blocks and weapons are always changed.
- The echoes are made in code (decaying noise through a convolver); no audio files ship for them.

## Models

**Assets › Models › Import…** takes GLB files (and glTF files with their data embedded). Give any point object
(an Empty object, say) the **Model** component:

- **Model**: the file. **Made in**: Metres (Blender and most tools; 1 m becomes 39.37 u) or Game units.
- **Animation**: the name of an animation in the file to play from the start, looping.
- **Shadows**: whether it casts them (with Lighting: Game and in Play).

- **Collision**: how it collides. **Auto** (the default), by the collision meshes in the file, see below; **None** (looks only); **Box**, its bounding box (the cheapest); **Hull**, the
  model shrink-wrapped with no hollows (good for things that move); **Exact**, every triangle, for still scenery
  the player walks through or under, like arches and rooms (with Physics it uses the hull instead).

**Collision meshes.** In Blender, add simple meshes named `collision`, `hitbox` or `col_` (any case; `.001` endings
are fine; meshes under an object named so count too). They are never drawn, and they are the model's whole collision with
any setting but None: a chair can be two boxes instead of every leg. Each mesh that is a box (8 corners, square sides, turned or
not) becomes a box; anything else is shrink-wrapped (a hull, so an L shape needs two meshes). Names starting
`collision_mesh`, `hitbox_mesh` or `col_mesh` use their exact triangles (still objects only). A collision mesh that the
animation moves (animated itself, under an animated object, or parented to a bone) carries its collider along in
Play; parent it to the bone rather than weighting it. View › Show collisions draws them as outlines. A model with no
collision meshes doesn't collide on Auto.

A model with a collision and no Physics stays put; add **Physics** to make it move: a crate model with Hull and
Physics falls and tumbles. A **Collision shape** component, if the object has one, is used instead of the model's
own shape (and on its own, without Physics, it is a still collider too). Models inside objects that scripts move go with them, and
copies made while playing show their original's model.

The **Play animation [name] on [object], looping/once** block switches a model's animation.

### Materials on models

A model's parts are its **material slots**, as named in the file (the chicken has Body, Eye whites and
Pupils; unnamed ones are called Material 1, Material 2 …). Under the Model component, **Materials** lists them:
each can stay **As in the file** or take one of the project's materials (plain or graph). Or pick a material
in the **Paint** tool (or click one in **Assets › Materials**) and click a part of the model: Shift+click paints
every part, Ctrl+click picks up the part's material. It's one undo step, saved with the scene, and drawn the
same in Play and in exported games.

On a model, a material's images cover the model's own texture coordinates once (the face size and scale of
brushes don't apply); models without texture coordinates show the material's colour. Mapping that ignores the
model's coordinates (triplanar) comes with CM2.


## Materials

Images can be used on faces directly, or through a project material that adds a colour, bumps, shine, metal,
see-through, glow and scrolling. See [materials.md](materials.md).

## Foliage (A2b)

A **Foliage** component on a brush covers its upward-facing surfaces (within the **Steepest** slope of straight up)
with grass in a stylized look. **Spacing** is about how far apart the tufts are, **Density** the share of spots
that get one, **Width** how far each tuft spreads and **Height** how tall it grows (each varies by ±20%). The same **Seed** always gives the same pattern, and no
two tufts share a cell of the spacing, so a field is even.

Each tuft is a clump of leaf-shaped blades fanning out from the middle, dark at the root and bright at the tips,
with a little lighter or darker per tuft. Three tricks give the look:

- **Floor normals.** Every blade takes the normal of the floor it grows on (both sides), so grass lights exactly
  like the ground: flat, with no shading of its own, and it darkens in shadows as the ground does.
- **No bare ground.** Each tuft has a root-coloured disc on the ground under it; neighbouring discs overlap, so
  nothing shows between tufts, yet where grass is cleared (or a field ends) the floor shows as it is.
- **Wind.** Blades sway, more towards their tips, out of step from place to place.
- **Patches.** Rounded areas of a very slightly different hue (one warmer, one cooler), from world-space noise,
  so they carry on across brushes. Painting them by hand comes with terrain (T1).
- **No ambient occlusion from grass.** Grass is left out of what occlusion is measured from (it would measure
  its own swaying blades and smear dark copies over them), so it only gets the little the ground under it gets.

**Cleared under objects.** Visible solid brushes and models standing on the grass clear it underneath, if they
are at least 24 u across (pebbles and posts don't). A tuft goes when a point just above its root is inside the
object (exactly: a brush's own shape, a model's convex hull), so something floating overhead leaves the grass alone.
Objects lower than the grass (slabs, path stones) also keep it back by a tuft's spread, so blades don't poke
through their top; taller ones don't need to (they hide what leans into them). Brushes and objects have
**Clears grass under it** in the Inspector. It's on by default, except for creatures, things that move (Physics
other than fixed) and COL brushes; NOGRASS always clears.

**NOGRASS** (`tool/nograss`) is a tool material like COL: a brush made of it is shown in the editor but never in
the game, collides with nothing, and clears grass where it stands, at any size. Use it to carve paths and
clearings that show the floor's own material.

**Level of detail.** Grass is drawn in 256 u chunks, each culled when out of view and drawn at one of three levels
by its distance from the camera: full blades (three triangles each, 14 per tuft) within 320 u, 8 single-triangle
blades to 960 u, and 4 broad ones beyond. Over the last fifth of each range a level dissolves into the
next with a screen-door dither (the two keep complementary pixels), so there's no pop. In the flat views the level follows the zoom. A 1536 u square field drops from about
2.5 million triangles to about 200 thousand from the player's eyes.

Only the component is saved. Placement is in `@cocoaworlds/geometry` (`scatterTufts`); drawing (instanced meshes per chunk
and level) in `viewport/foliage.ts`, shared by the editor and Play.

## Many copies of a model (A2c)

In Play and exported games, still copies of one model that are drawn the same way (same file, units, shadows and
material slots) are drawn together: one instanced mesh per part of the model per 1024 u area, each area culled as a
whole. A copy counts as still when it has no animation or bones, and no physics body or only a fixed one that
can't break and that no script names (scripts can hide or show objects). Anything else is drawn by itself so it
can move, animate, break or vanish. 256 crates take 7 draw calls instead of 259. (`viewport/model-batches.ts`.)

## Water look

Water brushes are drawn in a painted style, in the editor and in the game alike. Before the scene is drawn, it's
drawn once more without water (and without anything see-through) into a depth picture; the water compares its own
depth with what's behind each pixel, and everything follows from how much water that is:

- **Colour**: the Water component's **Shallow colour**, blending to its **Deep colour** by **Deep from** (u). Shallow
  water is see-through, so the bottom shows; deep water is nearly solid.
- **Foam**: a blobby band with holes right where the water meets anything (shores, rocks, legs, piers), bands
  rolling in towards the shore in pieces, bending off the straight (big slow bends and small kinks), and glints
  twinkling on open water. **Foam** switches it all off.
- **Light below**: faint lighter patches between slowly drifting cells, warped and patchy (strong in some places,
  gone in others), where it's shallow.
- **Swells**: broad, softly lighter waves sweeping across open water, bent off the straight; a few carry a white
  crest. (Part of **Foam**.)

The water is lit like any surface (shadows fall on it) with a little light of its own, so it stays bright in shade.
Everything moves with a shared clock; in the editor the picture moves when the view is redrawn. (`viewport/water-look.ts`.)

## Smooth shading and bevelled edges

A brush's **Smooth shading** (Inspector, Display) shades faces meeting at up to 50° as one surface, averaging
their normals at shared corners: cylinders and spheres look round, a box stays crisp. New cylinders and spheres
start smooth. It's kept as its own small component, so moving, clipping or painting the brush keeps it. Smoothed
brushes have no wear ring.

A material's **Bevel edges** (u, up to 32) makes brush edges look rounded off: within that distance of an edge
the lighting leans out over it (from each face's distance to its edges, the same data wear uses).


## Grass on top

A Foliage component's **Grass on top** (on by default) paints a grass layer over the surface's own material wherever
it faces world up: fading out over **Edge softness** degrees round **Steepest**, broken into **Bare patches** about
**Patch size** across, mottled like blades seen from above. Tufts grow only where the layer mostly shows (the same
`coverAt` mask in `packages/geometry/src/scatter.ts`, mirrored in the layer's shader in `foliage.ts`). Foliage now
works on models as well as brushes and terrains (the model's posed shape, placed once: it doesn't follow animation).
Each tuft can have a root-coloured disc under it. With the layer on, only tufts at the edge of the field keep it
(where the layer fades, or with no tufts nearby on some side, `edgeTufts`); inside, the layer is the ground. The discs
are their own instanced mesh per chunk and level (a child of the blades, drawing only the edge tufts, which come
first). With the layer off, every tuft keeps its disc.

## Z is up (editor only)

View › **Z is up** (on by default) shows axes as Blender does: shown X = X, shown Y = −Z, shown Z = Y, scale swapping
Y and Z. Only what the editor shows changes (Inspector, brush size/centre, component vectors, the corner axes, the
move gizmo's and grid's colours, the selection readout); the engine and saved files stay Y-up (`renderer/axes.ts`).

## Sky

The Sky workspace edits the current scene's sky (`settings.sky`): colours overhead, at the horizon and below, haze,
the sun's disc and glow (placed where the scene's first Sun shines from; its height, direction, colour and
brightness are edited on that light from here), drifting clouds lit from the sun's side, and stars where the sky is
dark. **Light from the sky** takes the ambient light's colours (and the fog's) from the sky. Presets set the sky and
the Sun's height, colour and brightness in one undo step. The shader is `viewport/sky.ts`, shared by the editor,
Play, exported games and the workspace's preview.

Plants are backlit by the sun: a soft glow looking into it and a thin rim along their silhouette (`plants.ts`).

## Blend into ground

A material's **Blend into ground (u)** makes everything painted with it fade into whatever it's sunk into (a
terrain, a floor, another mesh) where they meet: fully the ground's look at the contact, back to its own within
that distance, with a noisy edge (**Blend edge noise**, **Blend blotch size**). Each frame where such a material
is shown, the scene is drawn once more at half size without it (no shadow pass, no fog, no editor aids), and its
shader takes that picture's colour where the surface behind is within reach (`viewport/ground-blend.ts`).

## Scene reflections

Shiny and metal project materials reflect the actual level: a reflection probe captures the scene into a cube
map (6 small renders, blurred by roughness) at eye height (in Play the player's eye; in the editor above what the
view orbits), again when the camera has moved ~192 u or the level changed, at most twice a second. A capture is
spread over four frames (two of its six views a frame, then the blur), so it never holds one frame up; in Play the
first one is taken all at once before the first frame (see Smooth frames). Sky tab › Reflect the scene (on by
default); off, they reflect the sky gradient as before. `viewport/reflections.ts`.

### Reflection probes (rooms)

Rooms get their own probes. `autoProbes` (geometry) samples the built level's solid pieces on a grid (16 u
cells, bigger on huge levels): air with a roof within 1024 u and walls on three sides or more is inside. Rooms
are split where the inside air narrows below ~112 u (doorways): cells further than that from anything not inside
seed rooms, which grow back over the rest; rooms longer than 1024 u are cut. Each room is a box (its air's
bounds) captured once from its air nearest the box's middle, and again ~0.6 s after the level stops changing.
Placed **Reflection probe** objects (Add menu; a box of Size round the object) come first; found rooms whose
middle is in a placed box are dropped. At most 15 box probes.

All probes live in one atlas (`viewport/probe-shader.ts`): 16 rows (row 0: the camera's capture), each six
octahedral pictures blurred for roughness 0–1. Project materials look up per pixel: the box they're in (full
strength up to 8 u outside, fading over 24 u) with the reflection direction fitted to the box (where the ray
leaves the box, seen from the capture point), two boxes blended near doorways, the camera's capture elsewhere.
The ambient (irradiance) look-up uses it too, so rooms take their light colour from their own walls. Sky tab ›
Probes for rooms (on by default); View › Show reflection probes draws the boxes.

## Smooth frames

What keeps Play (and exported games) from stuttering:

- **Nothing compiles while playing.** Before the first frame every shader of the game is compiled under its own
  lights and reflections, shown or not (levels of detail, blasts, objects scripts show later):
  `WebGLRenderer.compile` in `engine.ts` (`warmPlay`) and `game/runner.ts`, after `SceneReflections.prime` has
  switched reflections on (switching them on later would compile every shiny material again). Models that load
  later are compiled in the background (`compileAsync`, `PlaySession.warm`) before they appear.
- **The number of lights never changes.** Three.js compiles every lit material again when a light is added or
  removed, so blasts use lights made with the game (two, only when a weapon makes blasts; dark when unused),
  and turned-off lights are dark rather than removed.
- **Nothing is made or thrown away per shot.** Tracers, fireballs and marks are pooled (`viewport/effects.ts`);
  a material thrown away can take its compiled shader with it. Signs a script changes are drawn again into the
  same canvas and material (`SignObject.retext`). Particles send only their live part to the graphics card.
- **The lights are built once.** The sun's shadow covers what stays put (`PlaySession.levelBounds`), measured
  about once a second and taken only when it grew by more than 64 u: a falling crate, a creature, a tracer
  into the sky or a blast no longer rebuild the lights and their shadow maps.
- **Drawn between physics steps.** Physics runs at 60 steps a second; moving objects, creatures and camera views
  are drawn between the last two steps (`GameWorld.drawnMotionOf`, `npcStates(true)`), as the player's view
  always was, so they glide at any frame rate and don't judder against the view (things put somewhere else, more
  than 128 u in a step, are drawn there at once).
- **Spread out.** Reflection captures take four frames; creatures look for their way at slightly different
  times (every 1.5–1.9 s) and the path search reuses its memory; the editor's status line is sent at most four
  times a second.

