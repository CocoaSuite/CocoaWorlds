# Materials

The **Materials** workspace (top bar: Scene · Screens · **Materials**) is where the project's materials are
made. A material is a named look for faces. Every scene in the project can use it, and changing it changes
every face that uses it at once: in the editor, in Play and in exported games.

## Making materials

- **+ Material** makes a plain grey one.
- **+ From images…** imports one or more PNG, JPG or WebP images into `assets/textures/` and makes a
  material from each one, named after the file (`lava_rock.png` becomes “Lava rock”).

Pick a material in the list to see it in the middle. The preview can be a **Sphere**, a **Cube** or a
**Wall**. Drag to turn it; it starts turning slowly again a few seconds later. The mouse wheel (or **+** and
**−**) zooms in to see the details; **Shift+drag** or a right-button drag moves the light instead (or turn on
**☀** to make an ordinary drag move it). Double-click puts the view back. The shapes are 128 units across, so
an image shows at the size it will have in the level.

**‹** at the top of the list folds it away into a strip of swatches (still clickable); **›** opens it again.

## Settings

| Setting | What it does |
|---|---|
| Name | What it is called in the lists. Faces refer to the material by an id that never changes, so renaming is safe. |
| Colour | The colour, or the tint of the image (white leaves the image as it is). |
| Image | A project texture drawn on the faces. **Image size** stretches it (2 = twice as big). |
| Cut out see-through pixels | Pixels under half opacity become holes (fences, grilles, leaves). On by default. |
| Bumps | A normal map that gives the surface bumps under light, with **Bump strength** (0–2). |
| Roughness | 0 is mirror-smooth, 1 is matte. |
| Metal | 0 for plastic, wood or stone; 1 for metal. Metal and polished materials reflect the scene's sky colours (or its ambient colour when there is no sky). |
| Opacity | 1 is solid; lower is see-through (glass, water). |
| Glows | A glow colour and strength. It lights the surface itself, even in the dark; it does not light other things (use a Light for that). With an image, the glow follows the image's pattern. |
| Seen from both sides | For thin things such as leaves and flags. |
| Scroll | Moves the image across the faces, in units a second: water, lava, conveyor belts. |

Changes from a slider or colour drag are one undo step. Undo and redo (Ctrl+Z, Ctrl+Y) work in the Materials
workspace, as in the scene. Materials are saved to the project file a moment after each change, and before
saving the scene or exporting a game.

## Using them

The **Assets** tab under the 3D view shows every material as a sphere among the project's other assets. Click
one to paint faces with it, or double-click it to open it here.

Project materials appear in the Face tool's and the Paint tool's material pickers, after the built-in colours
and before the plain images. The workspace also has:

- **Use on picked faces**: puts the material on the faces picked with the Face tool.
- **Paint with it**: goes to the scene with the Paint tool holding it. Click a face, or Shift+click to paint a
  whole brush.
- **Show its faces**: goes to the scene with every face that uses it picked.

Below the preview, the workspace shows how many faces in the open scene use the material.

**Delete** removes a material. Faces still using it show the pink and black “missing” check until they get
another material; undo brings the material back.

## Mapping

**Mapping** decides where a material's images come from:

| Mapping | Use |
|---|---|
| Face (default) | Brushes: each face's own alignment (offset, scale, rotation, Fit); models: their own texture coordinates. |
| Triplanar, world | Projected from the world along X, Y and Z, blended by which way the surface faces: no seams, no alignment, and neighbouring pieces line up (rock, concrete, terrain-like levels). |
| Triplanar, object | Projected from the object itself, so the pattern stays on things that move, and on models (no texture coordinates needed). |

With triplanar mapping, **Size in the world** sets how many units one repeat covers. Every map is projected,
bumps included.

## Wear

**Wear** gives a material a second look (bare metal under paint, dust, dirt) where it would wear: **On edges**
that stick out, **In creases** where things meet (the foot of a wall on a floor), and **On top** (surfaces facing
up). **Width** is how far in from an edge or crease it reaches (up to 32 units); **Broken up** mixes in noise
so it frays irregularly. The wear's own **colour**, **roughness** and **metal** say what it looks like.

On brushes the edges are exact: every face carries its distance to its outer edges and to its creases (edges
where it meets another brush), so a wall's top corners wear and its foot gathers dirt. On models it is an
estimate from how quickly the surface curves (good for chunky props).

A graph material can make the wear's look itself with the **Wear colour**, **Wear roughness**, **Wear metal** and
**Wear noise** outputs (baked like the other maps; Wear noise, often a Grunge, decides where the wear frays
first); its Wear settings still say where the wear goes.

## Graph materials (Cocoa Materials)

**+ Graph material** makes a material from a graph of nodes, in the spirit of Substance Designer. Instead of
an image, it has a graph in the middle of the workspace: nodes that make patterns (noise, cells, bricks …),
nodes that change them (levels, blur, warp …) and output nodes for each map of the material. A new one starts
from a small working graph (a stone-like surface) to change.

- **The library** on the left of the graph lists every node by group, with a picture of what it makes. Type
  to search it. Click a node to add it in the middle of the graph, or drag it to where you want it. **‹** hides
  the library (and **›** brings it back); groups fold away with a click on their name. With the materials
  list folded away, the library spreads into several columns of tiles.
- **Add a node** without the library: right-click the graph, press **Space**, or **+ Node**. Type to find one;
  Enter adds the first match where you clicked.
- **Wire**: drag from a node's output (right) to another node's input (left). An input takes one wire; a new
  one replaces it. Wires that would loop back are refused. Grey dots carry grey pictures, gold ones colour.
  The dots can be grabbed (and wires dropped on them) from a little way off.
- **Unplug**: grab a plugged input and pull its wire off: let go on empty graph to unplug it, or on another
  input to move it there. Alt+click on a wire unplugs it too.
- **Remove**: pick nodes or wires and press **Delete**. Shift or Ctrl adds to the pick.
- **Copy and paste**: Ctrl+C copies the picked nodes (with their settings and the wires between them), Ctrl+X
  cuts them, Ctrl+V pastes them where the mouse is, Ctrl+D duplicates them beside the originals. Copied nodes
  can be pasted into another graph material too.
- **Change**: pick a node; its settings show on the right. With no node picked, the right shows the material's
  own settings.
- **Undo** (Ctrl+Z) undoes graph changes like any other; a slider's whole drag is one step.

Every node shows its picture, so it's easy to see where in the chain something goes wrong. The preview on the
right shows the material **On a shape** (sphere, cube, wall) or **Flat** (the picked node's picture).

### Nodes

| Group | Nodes |
|---|---|
| Make | Noise (Perlin, value, ridged), Cells, Bricks and tiles, Shape (circle, square, polygon, star), Gradient, Checker, Scratches, Grunge (blotches, streaks, speckles, rust), Image (a project texture), Colour, Number, Waves and stripes, Hexagons, Weave, Planks, Wood grain, Cobblestones, Cracks, Marble, Blobs, Speckles, Scatter (copies of a picture, varied size, turn and brightness; Keep apart for no overlaps), Zigzag |
| Change | Levels, Curve, Invert, Clamp, Blur, Warp, Slope blur (blur, darkest, lightest), Directional warp (shift or flow along one direction by an intensity), Flood fill (each white shape of a mask its own random grey, colour, gradient, position or size), Distance, Transform (repeat, slide, quarter turns), Edge detect, Sharpen, Posterize, Threshold, Brightness and contrast (and gamma), Mirror, Pixelate, Swirl, Outline, Directional blur, Light from height |
| Combine | Blend (mix, add, subtract, multiply, screen, overlay, lighter, darker, difference, through a mask), Switch, Math (+ − × ÷, min, max, power, difference, average), Height blend (colour, height or mask), Combine channels, Pick channel, Colour to mask |
| Colour | Gradient map, Hue / saturation / lightness, Colourise, Replace colour, Desaturate, Colour variation, Warm or cool |
| Surface | Height to normal, Height to occlusion, Height to curvature, Combine normals, Adjust normals (strength, flip green), Edge wear, Dirt, Drips and streaks |
| Outputs | Colour, Height, Normal, Roughness, Metal, Occlusion, Glow, Opacity |

Everything tiles: the patterns repeat over their square, so the material never shows a seam. Random nodes
have a **Seed**; **New** picks another random pattern of the same kind.

### Exposed settings and variants

Any node setting can be **exposed**: pick the node and press **◇** beside the setting (◆ when exposed). A material
using the graph then lists it under **Its own settings**, where it can be set for that material alone (**↺** goes
back to the graph's value). **Make a variant** makes another material from the same graph, with its own values:
red bricks and grey bricks from one graph. Changing the graph changes every variant; each bakes its own maps
(their file names carry a piece of the material's id).

### Maps and baking

Graphs run on the graphics card while you edit, and the level shows the changes at once. A moment after the
last change, the material is **baked**: each output becomes an image in `assets/textures/generated/`
(`stone_color.png`, `stone_normal.png` …), and the material uses those images. The level, Play and exported
games use the baked images, so they look exactly as in the editor and cost nothing extra to load. The status
next to **Bake now** says whether the latest changes are baked.

A graph material's own settings:

| Setting | What it does |
|---|---|
| Size in the world | How many units one repeat of the material covers (128 by default). |
| Baked size | 256, 512, 1024 or 2048 pixels square. Bigger is sharper and takes more memory. |
| Bump strength, glow strength, opacity, cut-out, two-sided, scroll | As for other materials. |

A map from the graph replaces its slider: a Roughness output decides the roughness, a Metal output the metal.
Height gives bumps only when there is no Normal output. Opacity cuts holes where it is dark (or fades, with
cut-out off).

## Export and import

**Export…** above the list (or right-click a material) exports the picked material; Ctrl+click picks more.

- **CocoaSuite material (.cocoamat)…** (graph materials): the graph itself, its exposed settings as the
  material's parameters with this material's values, its own settings, the nodes it uses, the images its Image
  nodes read, and freshly baked maps. CocoaSurface opens it as an editable graph. One material goes through a
  save dialog; several go into a chosen folder, one file each (variants too, each with its own values). The
  format: [cocoamat-format.md](cocoamat-format.md).
- **Images (PNG)…** (any material): its maps as `<name>_<role>.png` plus `<name>.material.json`, at 256–2048
  (4096 where the card allows), with the normal map's green down (CocoaWorlds, DirectX) or up (OpenGL, Blender),
  occlusion, roughness and metal packed into `<name>_orm.png` if wanted, and a choice of maps.

**Import…** makes graph materials from `.cocoamat` files: the graph goes in `materials/`, its images in
`assets/textures/`, its parameter values become the material's own settings, and it bakes. A file using nodes
this CocoaWorlds doesn't have is refused; one whose nodes work differently here imports with a warning in the
log.

## Files

Materials are kept in the project file (`project.cwproj`, under `settings.materials`). Each has an id such as
`mat/k3f9a0z2m1q8x7c4`, and faces store that id. Exported games carry only the materials their scene uses, and
only those materials' images.

Each graph material's graph is its own file, `materials/<name>.cwmat` (versioned JSON of nodes, wires and
settings; settings left at their defaults aren't written), so big graphs stay out of the project file and
diff cleanly. The file is named when the material is made and keeps that name when the material is renamed.
Exported games carry the baked images, not the graphs.

## Glass and glow images

- **Glass (see-through)**: how much light passes through; **Bending** (index of refraction) and **Thickness** set how
  much what's behind is bent, by the surface's normals (a normal map makes it ripple). Colour tints it, roughness
  frosts it. Project materials are physical materials for this (no cost when glass is off). Glass casts no shadow,
  in the editor and in Play: light goes through it (`viewport/glass-shadows.ts` leaves it out of the shadow pass).
- **Glow image** (under Glows): where it glows, tinted by the glow colour.
