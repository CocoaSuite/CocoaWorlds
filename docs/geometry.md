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

## Spaces (decision G3)

Every entity's transform is relative to its parent. A brush's faces are saved in its own space: its parent's space combined with its own transform (normally identity), so a group can be moved, turned or scaled without rewriting the brushes inside it, and a prefab copy is just another transform.

The editor's tools work in world space. `toWorld` and `toLocal` convert on the way in and out; pure moves use `translate`, which keeps textures locked to the faces, and other transforms re-project world-aligned textures. Changing an object's parent keeps it where it is in the world.

## Operations

| Operation | Function | Notes |
|---|---|---|
| Primitives | `box`, `cylinder` (3–64 sides), `wedge`/ramp (4 facings), `prism` (any convex footprint), `stairs` (separate non-overlapping step brushes), `extrudePolygon` (any outline on any axis plane; made convex with `convexHull2D`) | Footprints are drawn on the XZ plane, Y is up, except `extrudePolygon`, which takes the view's axes. |
| Clip | `clipPlane`, `clipBrush` | The plane through two drawn points along the view's depth; pieces on each side with matching cap surfaces. |
| Move | `translate` | Texture lock keeps textures glued to the faces. |
| Rotate / scale / mirror | `transform` | Planes rebuilt from transformed polygons; mirroring keeps normals outward. |
| Face drag | `pushFace` | Refuses to collapse the brush. |
| Vertex edit | `moveVertices` | Never refuses a shape (G4), only one squashed flat. A bent or dented face is split into triangles; a brush that stops being convex becomes an edited mesh (below). |
| Loop cut | `loopCut`, `nearestEdge` | A ring of new edges across four-sided faces, starting at an edge, divided into N equal parts. The result is an edited mesh with the new corners. |
| Mesh ↔ brush | `toEditMesh`, `tryConvex`, `rebuildMesh` | Convert a brush to explicit corners; back to a normal brush when convex with no extra corners; tidy corners after a move. |
| Clip | `split` | Splits by any plane; new cap faces get a chosen surface. |
| **Subtract (carve)** | `carve` / `carveDetailed` | See below. |
| Intersect | `intersect` | The shared volume. |
| Union | `mergeConvex`, `mergeAll` | Merges only when the result is convex; otherwise brushes stay a group. |
| Face surfaces | `faceAt`, `setSurface`, `fitSurface`, `justifySurface` | Find the face under a point; change material and texture alignment of chosen faces; fit a texture to a face; line it up with an edge or the centre. Planes are never touched, so the shape can't change. |
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
| Same with hidden-face removal | ~150 ms (was ~320 ms before the spatial index) |
| 2,000 floor tiles with hidden-face removal | ~220 ms (was ~4.2 s) |
| Level of 500 brushes with 40 live cutters | ~450 ms, almost all of it carving; runs in the background worker |

## Spatial index

`AabbTree` is a static bounding-box tree (median split on the longest axis). Hidden-face removal asks it which brushes touch each face; live subtract asks it which cutters touch each solid. A randomized test checks it returns exactly what a brute-force search does.

## Background builds

The editor builds the level (live subtract, then the mesh) with one plain-data function, `buildLevel`. From 64 brushes it runs in a worker; while a build is running, newer edits wait and only the latest one is built next.

## Edited meshes (decision G4)

A brush normally is its planes. Once its corners are moved into a dent or a twist, planes can't describe it,
so it keeps its corners and polygons explicitly: `Brush.mesh = { verts, polys }`, where `polys[i]` belongs to
`faces[i]` (its plane and surface). Everything that works face by face (drawing, picking, painting, texture
alignment, the vertex tool, moving, rotating, scaling, saving) treats both kinds the same.

- **Always flat and convex polygons.** After a move, corners that land on each other are welded, collapsed
  polygons are dropped, and any polygon that is bent or dented is split into triangles (ear clipping in its
  best-fit plane). The shape stays closed.
- **Back to a brush.** When the mesh is convex and every corner is a real corner (none in the middle of a flat
  face or edge), it becomes a normal brush again, so carve and clip work on it once more.
- **What skips it.** Carve (live subtract and Apply cut), clip, merge and Make hollow need convex brushes; they
  leave edited meshes alone and say so. An edited mesh can't be a subtract brush.
- **Physics.** Still edited meshes collide with their exact triangles; moving ones use their convex hull.
- **Saving.** Brush data gains `mesh` (corners rounded to 1/1024 unit, like face points). `faces` keeps three
  points per face as before. Scene format 3; older scenes have no meshes and open unchanged.

## COL, the invisible collider

`tool/col` (`COLLIDER_MATERIAL`) is a material for faces that collide in the game but aren't drawn there, for
invisible walls, smoothing stairs into a ramp for the player, or blocking off ledges. A whole brush can be COL
(Brush tool → COL) or only some faces (paint them). Hidden-face removal never lets a COL face hide a visible
face it touches (`isInvisibleMaterial`), so a COL block against a wall leaves no hole in the game.

## Sphere

The Sphere brush (tool bar, or Sphere in the Brush tool) fits the drawn box, so a non-cube box makes an
ellipsoid. **Sides** sets how many faces go around (4–48); there are half as many rings from pole to pole.
Every band is a flat face, so a sphere is an ordinary convex brush: it can be cut, clipped, painted and
vertex-edited like any other.
