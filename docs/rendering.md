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
