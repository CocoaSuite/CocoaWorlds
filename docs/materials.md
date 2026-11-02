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
| Make | Noise (Perlin, value, ridged), Cells, Bricks and tiles, Shape (circle, square, polygon, star), Gradient, Checker, Scratches, Grunge, Image (a project texture), Colour, Number |
| Change | Levels, Curve, Invert, Clamp, Blur, Warp, Transform (repeat, slide, quarter turns), Edge detect |
| Combine | Blend (mix, add, subtract, multiply, screen, overlay, lighter, darker, difference, through a mask), Switch |
| Colour | Gradient map, Hue / saturation / lightness, Colourise |
| Surface | Height to normal, Height to occlusion, Height to curvature |
| Outputs | Colour, Height, Normal, Roughness, Metal, Occlusion, Glow, Opacity |

Everything tiles: the patterns repeat over their square, so the material never shows a seam. Random nodes
have a **Seed**; **New** picks another random pattern of the same kind.

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

## Files

Materials are kept in the project file (`project.cwproj`, under `settings.materials`). Each has an id such as
`mat/k3f9a0z2m1q8x7c4`, and faces store that id. Exported games carry only the materials their scene uses, and
only those materials' images.

Each graph material's graph is its own file, `materials/<name>.cwmat` (versioned JSON of nodes, wires and
settings; settings left at their defaults aren't written), so big graphs stay out of the project file and
diff cleanly. The file is named when the material is made and keeps that name when the material is renamed.
Exported games carry the baked images, not the graphs.
