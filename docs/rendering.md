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
