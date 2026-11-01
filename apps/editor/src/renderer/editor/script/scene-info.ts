/** What the script checker needs to know about the scene and project (the same everywhere scripts are checked). */
import { gameRules, type ProjectFile, type SceneDoc } from '@cocoaworlds/core';
import type { SceneInfo } from '@cocoaworlds/scripting';

export function sceneInfo(doc: SceneDoc, project: ProjectFile | undefined): SceneInfo {
  return {
    objects: new Map(doc.entities.map((e) => [e.id, { name: e.name, isZone: !!e.components.trigger }])),
    rules: gameRules(project?.settings),
    globals: (project?.settings.values ?? []).map((g) => ({ name: g.name, type: g.type })),
    signs: new Set(doc.entities.filter((e) => e.components.sign).map((e) => e.id)),
  };
}
