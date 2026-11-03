# Terrain tiles (T2): open-world ground from several terrains

## Choice

- **Tiles that meet at seams with matching heights** (not overlapping instances with a blend falloff, and not one
  heightfield streamed in chunks). Each tile is an ordinary terrain with its own `.cwvox` file, so everything that
  works on one terrain (sculpt, paint, grass, heightmap import, saving, collisions) works on a tile unchanged.
- **Authored as a tile grid**: the Terrain tool's *Add a tile* buttons (−X, +X, −Z, +Z) put a new terrain beside the
  selected one, exactly one tile's width away, with the same layers, textures and grass.
- **Play loads the whole map at once.** Streaming tiles around the player is left for later (see below).

## How tiles join

Terrains are joined into a set when they:

- use grids of the same size and spacing,
- sit a whole number of tiles apart along x and z, at the same height,
- are unturned (no rotation, scale 1), shown, and each has its own file.

Neighbouring tiles **share their edge points**: a tile's last column along +x is its +x neighbour's first, so a
129-point grid at 16 u spacing is 2048 u wide and the next tile starts 2048 u along. Joining is worked out from the
scene each time it changes (`viewport/terrain-tiles.ts`, `linkTerrainTiles`), so moving a terrain one tile's width
next to another joins them, and moving it away parts them. Nothing extra is saved.

### Meshing across a seam (`@cocoaworlds/geometry`, `voxels.ts`)

- A joined grid has `neighbours`: reading a point past its edge reads the neighbour there (`VoxelField.locate`),
  instead of closing the edge with air. So the surface runs on across the seam, with no wall underneath it.
- A point on a shared edge is in two (or, at a corner, four) tiles. Only one makes the faces around it
  (`VoxelField.owns`: the tile furthest along +x, then +z), so no face is drawn twice. Tests check that two tiles,
  a 2 × 2 block and an L of three mesh exactly as one big grid would, chunk by chunk too.
- Where a tile has no neighbour, its edge is closed as before.

### Shaping across a seam

- A Terrain tool stroke on a joined tile shapes every tile of its set that the brush reaches, each in its own space
  (`editTiles`), as one undo step.
- After each touch, the shared edge points are made to agree again (`stitchTiles`: each becomes the average of its
  copies; layer weights too, still adding up to 255). A smooth near a seam can otherwise leave the copies apart.
- A tile draws a cell's width of its neighbours' points by its edges, so a change near a seam re-meshes the
  neighbour's chunks there as well.

### A new tile

`tileBeside` makes the new grid by carrying the shared edge straight across (every row of the new tile is a copy of
that edge's points, density and paint). The two meet exactly from the start, and the new tile is flat ground at the
edge's height profile, ready to be shaped.

### Play

`PlaySession` loads every terrain first, joins the tiles, then meshes them for collisions, so the seams collide as
one ground.

## Not done yet

- **Streaming**: all tiles are loaded and drawn at once. The tile grid is the unit to stream by later (load the
  3 × 3 or 5 × 5 tiles around the player), since tiles are already separate files and separate collider bodies.
- **Different layers per tile**: each tile has its own four layer colours and textures. Tiles made with *Add a tile*
  copy them, but if they are changed on one tile only, the colours change sharply at the seam.
- **Heightmap import onto one tile** reshapes that tile only; its edges then differ from its neighbours' until a
  stroke along the seam stitches them. A whole-map import across tiles would cut one picture into tiles.
- **Grass** is scattered per tile; along a seam the pattern changes but the coverage carries on.
- Tiles must be unturned and the same size; anything else stays a separate terrain with closed edges.
