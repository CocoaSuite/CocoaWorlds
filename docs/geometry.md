# Brush geometry

Package: `packages/geometry` (no renderer, DOM or Node dependencies; runs in the editor, in workers and in the game runtime).

## Representation

| Concept | What it is |
|---|---|
| **Brush** | A convex solid stored as a list of **faces**. |
| **Face** | A plane (unit normal pointing out, `n·p = d`) plus a **surface**: material, texture offset, scale, rotation, alignment. |
| **Polygon** | A face's visible outline, derived by clipping a huge square on its plane by every other plane. Counter-clockwise seen from outside. |
| **Vertices / edges** | Derived from the polygons. Never stored. |

Because the solid is "everything behind every plane", a brush is always closed and convex. There is no way to save a broken mesh.

The editable brushes, the render mesh, the collision hulls and spatial indexes are separate things built from the brushes:

```
Brushes (editable, saved) ──► buildMesh() ──► render mesh grouped by material
                          └─► hullPoints() ─► one convex physics hull per brush
                          └─► (Phase 3–4) BVH over brush bounds for picking and culling
```

## On disk

Each face is saved as **three points on its plane** plus its surface (the same idea as Hammer's .vmf). Points of grid-drawn brushes are exact integers, so files don't drift when saved repeatedly. Off-grid results (rotations, cylinders) are rounded to 1/1024 unit; a 24-sided cylinder saved and reopened 20 times stays within 0.5 cubic units of its original volume (tested).

## Operations

| Operation | Function | Notes |
|---|---|---|
| Primitives | `box`, `cylinder` (3–64 sides), `wedge`/ramp (4 facings), `prism` (any convex footprint), `stairs` (separate non-overlapping step brushes) | Footprints are drawn on the XZ plane, Y is up. |
| Move | `translate` | Texture lock keeps textures glued to the faces. |
| Rotate / scale / mirror | `transform` | Planes rebuilt from transformed polygons; mirroring keeps normals outward. |
| Face drag | `pushFace` | Refuses to collapse the brush. |
| Vertex edit | `moveVertices` | Refuses moves that make a dent. A face bent out of flat is split into triangles or refused (setting). |
| Clip | `split` | Splits by any plane; new cap faces get a chosen surface. |
| **Subtract (carve)** | `carve` / `carveDetailed` | See below. |
| Intersect | `intersect` | The shared volume. |
| Union | `mergeConvex`, `mergeAll` | Merges only when the result is convex; otherwise brushes stay a group. |
| Validation | `validate` | too few faces, not closed, thinner than 0.5 u, beyond ±65 536 u, non-finite. |

### How carve works

The target is split by each plane of the cutter in turn. The part outside a cutter plane becomes a finished piece, and the rest continues to the next plane; whatever is inside every cutter plane is the hole and is thrown away. Then:

1. Neighbouring pieces whose union is convex are merged back (fewer brushes).
2. Hair-thin slivers (< 0.5 u thick and ≤ 8 cubic units) left by nearly parallel faces are removed and reported.
3. Faces created by the cut take the material of the target face pointing the same way, so the inside of a doorway looks like the wall around it.

Results are ordinary brushes: still convex, closed, editable, with materials and world-aligned textures continuous across the cut.

Tested cases include: doorway (3 pieces), window (4 pieces), cutter flush with both wall faces (coplanar), rotated cutter, cylindrical cutter, off-grid coordinates, overlaps smaller than the tolerance (treated as touching), cutter larger than the target (nothing left), and carve-then-merge restoring the original wall. A 2,000-point sampling test checks the hole is empty and the rest solid.

## Live subtract in the level (decision G1)

`buildWorld` takes every visible brush in the scene. Solid brushes are kept exactly as authored; each subtract brush that overlaps a solid cuts it while the level is being built, so moving or resizing a doorway re-cuts the wall without changing the saved wall brush. `bakeSubtract` ("Apply cut" in the editor) makes a cut permanent: the affected solids are replaced by their pieces and the cutter is removed, in one undoable step. `hollowBox` ("Make hollow") turns a block into six walls. **Inward** (default) keeps the block as the outside of the room; **outward** keeps it as the inside and builds the walls around it, so a 512 × 256 × 512 block gives a 512 × 256 × 512 room inside a 544 × 288 × 544 shell (16-unit walls).

## Precision

Distances under 0.001 u count as "on the plane". Generated coordinates are rounded to 1/1024 u. All maths is in 64-bit floats.

## Performance (one desktop core)

| Task | Time |
|---|---|
| Door-sized carve | ~3 ms |
| 16-sided column carved through a wall | ~55 ms |
| Mesh for 500 box brushes (6,000 triangles) | ~75 ms |
| Same with hidden-face removal | ~320 ms. This step is O(n²) today and will use the spatial index in Phase 3. |

Mesh building is designed to run in a worker so the editor never stalls.
