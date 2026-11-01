# Prefabs

A prefab is a reusable object tree saved as a file in the project's `prefabs/` folder: a lamp, a door with its frame and trigger, a crate. Copies are placed in scenes; editing the prefab updates every copy.

## Storage (decision P1)

- **Prefab file** (`prefabs/lamp.cwprefab`): one entity tree whose root sits at the prefab's origin. When a prefab is made, the origin moves to the bottom centre of what it contains, so copies are placed by their base.
- **Copy in a scene:** stored in full. Each object carries a hidden `prefabLink` (prefab id, prefab entity id). When the scene is saved, each link records which values differ from the prefab (`changed`), and the copy's root records prefab objects deleted from this copy (`removed`).
- Scenes never need their prefab files to open or play. A missing prefab file leaves its copies working as ordinary objects.

## What counts as a change

Values are compared per path: name, visibility, lock, tags, position/rotation/scale (except the copy's root, which every copy places and names itself), whether each component is present, and each component field. A brush's shape is one value.

## Keeping copies up to date

Syncing a copy takes every value from the prefab except the ones the copy changed; objects new in the prefab are added, objects deleted from the prefab are removed, and objects a copy deleted or added on its own stay that way.

- **Apply** (per change, or all) writes the copy's value into the prefab file, then every copy in the open scene catches up. Copies in other scenes catch up the next time those scenes open.
- **Revert** (per change, or all) takes the prefab's value back.
- **Unlink** turns a copy into ordinary objects.
- Copy/paste of a whole copy makes another copy; pasting part of a copy makes ordinary objects.

Code: `packages/core/src/prefab.ts` (format, compare, sync — pure functions, unit-tested), `apps/editor/src/renderer/prefabs.ts` (editor glue), `apps/editor/src/main/project-fs.ts` (files).
