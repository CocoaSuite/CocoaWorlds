# Proposal: ambient light and global illumination

Status: **proposed** (2026-11-02). Not scheduled yet; for a decision before A2.

## Where lighting is now

- Direct light from suns, spots and bulbs, with shadows (cast by both sides of faces, so nothing leaks under
  walls where brushes meet).
- **Ambient**: one colour from the scene settings, as a sky/ground hemisphere light. It lights every corner
  the same, so rooms look flat away from the lights.
- **Ambient occlusion** (GTAO, screen space): darkens corners, creases and contact points. Cheap and always
  up to date, but it only knows what is on screen and darkens rather than lights.

Missing: light bouncing (a red wall tinting the floor, a sunlit room lighting its dark corner) and light coming
from the sky through windows into rooms.

## Options

| | What | For | Cost |
|---|---|---|---|
| G1 | **Baked lightmaps** for brushes: path-traced bounce light (and AO) baked into a second UV set per face, on the GPU in the editor, like Half-Life's `rad` | Still levels (Half-Life, most Roblox builds). Best quality, free at run time | A bake step (seconds to minutes); stale until baked again; lightmap UVs for brushes (faces are flat polygons, so packing is easy) |
| G2 | **Light probes** (irradiance volume): a grid of spherical-harmonics probes baked the same way, lighting models and moving things | Creatures, the player's weapon, physics props in baked levels | Small; needs G1's tracer |
| G3 | **Real-time screen-space GI** (SSGI) on top of GTAO | Changing levels (Slime Rancher day/night) | Noisy, view-dependent, costly on weak GPUs |
| G4 | **Dynamic probes (DDGI)**: probes ray-traced a few per frame | Fully dynamic worlds | Needs compute or ray tracing (WebGPU); later |

## Recommendation

G1 + G2 first: a **Bake lighting** button (and bake on Build), tracing on the GPU with the existing BVH
(three-mesh-bvh, MIT), storing lightmaps in `assets/textures/generated/lightmaps/` like baked materials, and a
probe grid in the scene. Direct light and shadows stay real time, so moving lights still work; bounce light,
sky light and AO come from the bake. Without a bake, scenes look as they do now. G3 can be an option later for
dynamic scenes; G4 waits for the WebGPU renderer.

Questions for sign-off: lightmap resolution per face (texels per unit, default 1 per 4 u); whether exported
games must be baked before Build (recommended: bake automatically if stale).
