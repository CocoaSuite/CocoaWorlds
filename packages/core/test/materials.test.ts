import { describe, expect, it } from 'vitest';
import { isMaterialId, materialsOf, newMaterial, validateMaterials } from '../src/materials';
import { newProject } from '../src/project';
import { validateProject } from '../src/validate';

describe('project materials', () => {
  it('new materials get a stable mat/ id and sensible defaults', () => {
    const a = newMaterial('Brick');
    const b = newMaterial('Brick');
    expect(isMaterialId(a.id)).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(validateMaterials([a, b])).toBeNull();
    expect(materialsOf(undefined)).toEqual([]);
  });

  it('the project file keeps them and rejects broken ones', () => {
    const { project } = newProject('Shop');
    const glass = newMaterial('Glass', { opacity: 0.3, roughness: 0.05, map: 'assets/textures/glass.png', scroll: [0, 4] });
    expect(validateProject({ ...project, settings: { ...project.settings, materials: [glass] } }).ok).toBe(true);
    const bad = (patch: object) => validateProject({ ...project, settings: { ...project.settings, materials: [{ ...glass, ...patch }] } });
    expect(bad({ color: 'red' }).ok).toBe(false);
    expect(bad({ roughness: 2 }).ok).toBe(false);
    expect(bad({ map: '../secret.png' }).ok).toBe(false);
    expect(bad({ id: 'dev/grid' }).ok).toBe(false);
    expect(bad({ name: ' ' }).ok).toBe(false);
    expect(bad({ scroll: [1] }).ok).toBe(false);
    expect(validateMaterials([glass, glass])).toMatch(/same id/);
  });
});
