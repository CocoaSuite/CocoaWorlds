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

describe('game rules', () => {
  it('older projects have everything on; rules round-trip; bad values are refused', async () => {
    const { gameRules } = await import('../src/schema');
    const { project } = newProject('Farm');
    expect(gameRules(project.settings)).toEqual({ health: true, score: true, thirdPerson: false, saveItems: false, stamina: false, showFps: false, building: false });
    project.settings.game = { health: false };
    const back = parseProject(stringify(project)).project;
    expect(gameRules(back.settings)).toEqual({ health: false, score: true, thirdPerson: false, saveItems: false, stamina: false, showFps: false, building: false });
    project.settings.game = { health: 'no' as never };
    expect(() => parseProject(stringify(project))).toThrow(ProjectFormatError);
  });

  it('game values are checked: a name, a matching starting value, no two alike', () => {
    const { project } = newProject('Tycoon');
    project.settings.values = [{ name: 'Cash', type: 'number', initial: 0, show: true }];
    expect(parseProject(stringify(project)).project.settings.values).toEqual(project.settings.values);
    project.settings.values = [{ name: 'Cash', type: 'number', initial: 'lots' as never, show: true }];
    expect(() => parseProject(stringify(project))).toThrow(ProjectFormatError);
    project.settings.values = [
      { name: 'Cash', type: 'number', initial: 0, show: true },
      { name: 'Cash', type: 'text', initial: '', show: false },
    ];
    expect(() => parseProject(stringify(project))).toThrow(ProjectFormatError);
  });
});
