import { describe, expect, it } from 'vitest';
import { MigrationError } from '../src/migrate';
import { ProjectFormatError, fileStem, newProject, parseProject, parseScene, stringify } from '../src/project';
import { CURRENT_SCHEMA_VERSION } from '../src/schema';

describe('project files', () => {
  it('round-trips a new project and its first scene', () => {
    const { project, scenes } = newProject('Facility Demo');
    const back = parseProject(stringify(project));
    expect(back.project).toEqual(project);
    expect(back.migrated).toBe(false);
    const path = project.startScene;
    expect(path).toBe('scenes/level_01.cwscene');
    const scene = parseScene(stringify(scenes[path]!));
    expect(scene.scene.entities).toHaveLength(2);
  });

  it('makes safe file names', () => {
    expect(fileStem('Level 01!')).toBe('level_01');
    expect(fileStem('Уровень 2')).toBe('уровень_2');
    expect(fileStem('***')).toBe('untitled');
  });

  it('explains damaged files instead of crashing', () => {
    expect(() => parseProject('{ not json')).toThrow(ProjectFormatError);
    const { project } = newProject('x');
    const broken = { ...project, startScene: 'scenes/missing.cwscene' };
    try {
      parseProject(JSON.stringify(broken));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectFormatError);
      expect((e as ProjectFormatError).problems[0]?.path).toBe('startScene');
    }
  });

  it('refuses files from a newer version without touching them', () => {
    const { project } = newProject('x');
    const future = { ...project, schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(() => parseProject(JSON.stringify(future))).toThrow(MigrationError);
  });

  it('detects duplicate entity ids and dangling parents in scenes', () => {
    const { scenes, project } = newProject('x');
    const s = structuredClone(scenes[project.startScene]!);
    s.entities.push({ ...s.entities[0]! });
    s.entities[1]!.parent = 'nope';
    expect(() => parseScene(JSON.stringify(s))).toThrow(/damaged/);
  });
});
