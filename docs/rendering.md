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

Sounds (OGG, MP3, WAV) and models (GLB, glTF) can be imported the same way; using them comes next.
