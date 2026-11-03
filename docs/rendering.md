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

## Models

**Assets › Models › Import…** takes GLB files (and glTF files with their data embedded). Give any point object
(an Empty object, say) the **Model** component:

- **Model**: the file. **Made in**: Metres (Blender and most tools; 1 m becomes 39.37 u) or Game units.
- **Animation**: the name of an animation in the file to play from the start, looping.
- **Shadows**: whether it casts them (with Lighting: Game and in Play).

- **Collision**: how it collides. **None** (looks only); **Box**, its bounding box (the cheapest); **Hull**, the
  model shrink-wrapped with no hollows (good for things that move); **Exact**, every triangle, for still scenery
  the player walks through or under, like arches and rooms (with Physics it uses the hull instead).

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

