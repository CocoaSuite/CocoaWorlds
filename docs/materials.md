# Materials

The **Materials** workspace (top bar: Scene · Screens · **Materials**) is where the project's materials are
made. A material is a named look for faces. Every scene in the project can use it, and changing it changes
every face that uses it at once: in the editor, in Play and in exported games.

## Making materials

- **+ Material** makes a plain grey one.
- **+ From images…** imports one or more PNG, JPG or WebP images into `assets/textures/` and makes a
  material from each one, named after the file (`lava_rock.png` becomes “Lava rock”).

Pick a material in the list to see it in the middle. The preview can be a **Sphere**, a **Cube** or a
**Wall**. Drag to turn it; it starts turning slowly again a few seconds later. The shapes are 128 units
across, so an image shows at the size it will have in the level.

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

Project materials appear in the Face tool's and the Paint tool's material pickers, after the built-in colours
and before the plain images. The workspace also has:

- **Use on picked faces**: puts the material on the faces picked with the Face tool.
- **Paint with it**: goes to the scene with the Paint tool holding it. Click a face, or Shift+click to paint a
  whole brush.
- **Show its faces**: goes to the scene with every face that uses it picked.

Below the preview, the workspace shows how many faces in the open scene use the material.

**Delete** removes a material. Faces still using it show the pink and black “missing” check until they get
another material; undo brings the material back.

## Files

Materials are kept in the project file (`project.cwproj`, under `settings.materials`). Each has an id such as
`mat/k3f9a0z2m1q8x7c4`, and faces store that id. Exported games carry only the materials their scene uses, and
only those materials' images.
