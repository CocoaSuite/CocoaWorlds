# Proposal: Cocoa Materials and procedural meshes

Status: **approved** (2026-11-02; decisions C1–C4 and R1 in [DECISIONS.md](../../DECISIONS.md)). CM1 is done: see [materials.md](../materials.md#graph-materials-cocoa-materials).

## What we want

1. **Cocoa Materials**: a node-graph material maker inside the editor, in the spirit of Substance Designer.
   You wire generators (noise, bricks, cells) through filters (warp, blur, levels, blend) into a full set of
   maps (colour, height, normal, roughness, metal, occlusion, glow), see the result live on a sphere, cube or
   wall, and use it on faces like any other material.
2. **Procedural meshes**: objects that build their own geometry from rules. The first case is a ladder: a
   segment repeats to fill whatever height it's dragged to, its texture runs across the whole thing without
   seams (triplanar), and its edges get worn where they stick out (procedural edge wear).

The two meet at mapping and wear. A repeated mesh needs a texture that doesn't care about its UVs, and wear
needs to know where a mesh's edges are. Those belong to the material, so they're designed here together.

## Cocoa Materials

### Where it lives

The **Materials** workspace keeps its list on the left and its settings on the right. A material becomes
either a **simple** material (today's: colour, images, sliders) or a **graph** material. A graph material puts
the graph in the middle, with the preview as a dockable panel.

- Nodes show a small thumbnail of their output (128 px), so you can see where in the chain something goes
  wrong.
- Wires are dragged from outputs to inputs. Right-click or Space opens an add menu with search. Frames group
  nodes, and Ctrl+G makes a reusable group (later).
- Picking a node shows its settings on the right, and its output on the 2D preview.
- **Exposed settings** (any node setting can be published, such as "brick colour", "wear amount" or "scale")
  turn one graph into a family. A material **variant** is the graph plus its own values for those settings
  (red bricks and grey bricks from one graph).

### First node set (about 30)

| Group | Nodes |
|---|---|
| Make | Noise (Perlin / simplex fractal, octaves, roughness), Cells (Voronoi: distance, edges, random per cell), Bricks and tiles (rows, offset, mortar, bevel, random per brick), Shape (circle, square, polygon, star), Gradient (linear, radial), Checker, Scratches, Grunge (built from the above), Image (a project texture), Colour, Number |
| Change | Levels, Curve, Invert, Clamp, Blur, Warp (by another map, or directional), Transform (scale, turn, move, tile), Slope blur, Edge detect, Distance (from shapes), Flood fill (random per island, later) |
| Combine | Blend (mix, add, multiply, screen, overlay, max, min, subtract, through a mask), Switch |
| Colour | Gradient map (grey → colour ramp), Hue / saturation / lightness, Colourise |
| Surface | Height → Normal, Height → Occlusion, Height → Curvature |
| Outputs | Colour, Height, Normal, Roughness, Metal, Occlusion, Glow, Opacity |

Everything tiles. Every generator repeats over its square, so baked maps never show a seam.

### How it runs: on the graphics card, then baked

Each node compiles to a small GLSL fragment program and renders into a texture on the GPU (WebGL2, 16-bit
float). A change re-renders only the nodes downstream of it, so editing stays live (a 25-node graph at 512² in
well under 50 ms on ordinary hardware).

When the graph changes (after a short pause) and when it's saved, its outputs are **baked** to PNG files in
`assets/textures/generated/` at the material's chosen size (256–2048). Everything that draws faces (the editor
view, Play, exported games) uses those images through the ordinary material path. Exported games carry no
generator, cost nothing at load, and look exactly as they did in the editor.

### Storage

Each graph material is its own file, `materials/<name>.cwmat`: versioned JSON of nodes, links, settings and
exposed settings. The project file's material list keeps the material's id, name, simple settings and the
paths of its baked maps. Graphs can get big, and one file per graph diffs and merges cleanly in git.

### What existing materials gain

Materials get the missing maps (roughness, metal, occlusion and glow images, beside today's colour and bump
images) and a **mapping** setting:

| Mapping | Use |
|---|---|
| Face (today) | Brushes: each face's own alignment (offset, scale, rotation, Fit). |
| Triplanar, world | Terrain-like things, rock, concrete: the texture comes from the world, so neighbouring pieces line up. |
| Triplanar, object | Things that move or are generated (doors, the ladder below): the texture sticks to the object, so stretching, repeating and moving keep it continuous. |

Triplanar is done in the material's shader (three projections blended by the surface's facing), so it works on
brushes, models and generated meshes alike, with no UVs needed.

### Wear that knows the mesh

Some effects can't be baked into a square texture, because they depend on the object: worn paint on outer
edges, dirt in creases, dust on top. A material gets an optional **wear layer**: a second set of maps (often
bare metal under paint), shown where a mask says so. The mask is computed in the shader from:

- **Edge**: closeness to an outer (convex) edge of the mesh, within a width in units.
- **Crease**: closeness to an inner (concave) edge.
- **Up**: how much the surface faces up.
- A noise or grunge map from the graph, to break the mask up.

The graph has these as inputs (Edge, Crease, Up), so wear is designed in the same place as the rest.

**Where the edge information comes from.** Brushes know their edges exactly: every face is a flat polygon,
and the angle between faces is known. When a brush is drawn, each face gets a thin inset ring of triangles
along its edges, carrying a "distance to edge" value that is 0 on the edge, the wear width at the ring's inner
side, and constant inside. The shader then gets an exact, smooth edge distance for almost no cost (a few extra
triangles per face). Only edges whose faces meet at an outer angle count as edges; inner ones count as
creases. Generated meshes get the same rings from their own parts. Imported models get an approximation from
their vertex normals (good enough for chunky props; a baked curvature map can come later).

## Procedural meshes

### The idea: parts and rules

A procedural object is made of **parts** (brushes, groups or models you build normally) and a **rule** that
copies them to fill a size. The size has handles in the view. Dragging a handle rebuilds the object,
instantly, in the editor and the game alike, with no export step.

The first rule, **Repeat**, covers the ladder and many more:

| Setting | Ladder example |
|---|---|
| Segment | the rails and one rung, 16 u tall |
| Start cap / End cap (optional) | the feet; the top with handles bent over |
| Along | up (+Y) |
| Length | dragged with the top handle: 37 segments, or anything |
| Fit | **whole segments** (the length snaps to a multiple), **stretch** (segments stretch a little to fit exactly), or **cut** (the last one is clipped) |
| Gap | 0 |
| Also makes | a **Ladder** zone of the same height in front, kept in step |

The generated geometry is one mesh, so:

- **Triplanar, object** mapping makes the texture run up the whole ladder continuously, whatever its length.
- **Edge wear** sees the whole ladder's edges (the rung ends, the rail corners), worn where a hand or boot
  would rub, with the graph's noise making it irregular.
- Brush parts stay brushes underneath, so they still collide exactly and can still be cut by subtract brushes.

The same rule makes pipes, railings, fences, chains, columns of windows, cables (with Stretch) and
scaffolding (Repeat inside Repeat).

### Later rules (not now)

- **Along a path**: segments follow path points, bending at corners. Railings, cables, rails, pipes round a
  room. Path points already exist for trains.
- **Grid**: repeat in two directions (floor tiles, shelving, scaffolding walls).
- **Variation**: a seed picks between several segment versions, or nudges, turns and scales copies (broken
  rungs, uneven planks).
- **Scatter** (A2 foliage) is the same machinery on a surface.

### How it's stored

A **Procedural** component on a group: the rule, the settings, and which children are the segment and the
caps (they stay real objects in the scene, hidden, as the source). The generated copies aren't saved; they
are rebuilt from the rule when the scene loads, when anything in the source changes, and when a handle moves.
That keeps scenes small and edits to the segment (a thicker rung) apply everywhere at once. A prefab can hold
a procedural object, so a ready-made "Ladder" is a prefab with its segment, caps, material and climb zone set
up.

## Order

| Step | What | About |
|---|---|---|
| CM1 | Graph model and GPU evaluator; the first node set; graph editor in the Materials workspace with thumbnails and the 2D/3D preview; baking to maps; materials get roughness, metal, occlusion and glow images | the bulk |
| CM2 | Mapping (face, triplanar world, triplanar object) for all materials; exposed settings and variants; more nodes (slope blur, flood fill, grunge library) | medium |
| CM3 | Wear layer with Edge, Crease and Up from inset edge rings on brushes and generated meshes, approximate edges on models | medium |
| R1 | Procedural objects: the Repeat rule with caps, fit modes, handles in the view; ready-made Ladder prefab with its climb zone | medium |
| R2 | Along a path, Grid, Variation | later |

R1 could come before CM3 (without wear) or after it (with wear from the first day). The ladder in the example
wants all of CM2, CM3 and R1.

A2 (navigation, animated creatures, foliage) and T1 (terrain) move after these unless you'd rather interleave;
T1's terrain painting would reuse Cocoa Materials (terrain layers as graph materials with triplanar mapping).
