import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brandPage, gameFileName, ownRuntime, playerFiles, usedAssets } from '../src/main/export';
import { bundleIdOf, icoFrom } from '../src/main/branding';

describe('export helpers', () => {
  it('names the page and gives it the game icon', () => {
    const html = '<html><head><title>Game</title><link rel="icon" href="x.svg"></head><body></body></html>';
    const out = brandPage(html, 'Cats & <Dogs>', true);
    expect(out).toContain('<title>Cats &amp; &lt;Dogs&gt;</title>');
    expect(out).toContain('href="icon.png"');
    expect(out).not.toContain('x.svg');
  });

  it('makes an .ico of PNG pictures and a bundle id', () => {
    const png = Buffer.from([1, 2, 3]);
    const ico = icoFrom([{ size: 16, png }, { size: 256, png }, { size: 512, png }]);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico.readUInt8(6 + 16)).toBe(0);
    expect(bundleIdOf('My Game!', 'abc-123')).toBe('com.cocoaworlds.mygame.abc123');
  });

  it('names files after the game safely', () => {
    expect(gameFileName('Coin Counter')).toBe('Coin Counter');
    expect(gameFileName('Café: «Deluxe»/2!')).toBe('Cafe Deluxe2');
    expect(gameFileName('   ')).toBe('Game');
  });

  it('carries maps baked from graph materials (in the generated folder), not the graphs', () => {
    const json = JSON.stringify({ materials: [{ id: 'mat/a', graph: 'materials/stone.cwmat', map: 'assets/textures/generated/stone_color.png', roughnessMap: 'assets/textures/generated/stone_roughness.png' }] });
    expect(usedAssets(json)).toEqual(['assets/textures/generated/stone_color.png', 'assets/textures/generated/stone_roughness.png']);
  });

  it('finds the assets a game uses in its data', () => {
    const json = JSON.stringify({ a: 'assets/textures/brick.png', b: { material: 'assets/textures/brick.png' }, s: 'assets/sounds/ding.wav', m: 'assets/models/crate.glb', x: 'dev/wall' });
    expect(usedAssets(json)).toEqual(['assets/models/crate.glb', 'assets/sounds/ding.wav', 'assets/textures/brick.png']);
  });

  it('copies only the player page and what it loads (from the build manifest)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-manifest-'));
    await fs.mkdir(path.join(dir, '.vite'));
    await fs.writeFile(
      path.join(dir, '.vite', 'manifest.json'),
      JSON.stringify({
        'src/renderer/player.html': { file: 'assets/player-1.js', isEntry: true, imports: ['_shared.js'], css: ['assets/player-1.css'] },
        '_shared.js': { file: 'assets/shared-2.js', dynamicImports: ['_physics.js'] },
        '_physics.js': { file: 'assets/physics-3.js' },
        'src/renderer/index.html': { file: 'assets/index-4.js', imports: ['_shared.js'] },
      }),
    );
    expect((await playerFiles(dir)).sort()).toEqual(['assets/physics-3.js', 'assets/player-1.css', 'assets/player-1.js', 'assets/shared-2.js', 'player.html']);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('finds the editor’s own runtime folder', () => {
    expect(ownRuntime('/opt/app/cocoaworlds', 'linux')).toBe('/opt/app');
    expect(ownRuntime('/Applications/CocoaWorlds.app/Contents/MacOS/CocoaWorlds', 'darwin')).toBe('/Applications/CocoaWorlds.app');
  });
});

describe('exported game data', () => {
  it('carries the materials the scene uses, and their images', async () => {
    const { newEntity, newMaterial, newProject, stringify } = await import('@cocoaworlds/core');
    const { gameData } = await import('../src/main/export');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-gamedata-'));
    const { project, scenes } = newProject('Lava Run');
    const lava = newMaterial('Lava', { map: 'assets/textures/lava.png', scroll: [0, 8], emissive: '#ff6020' });
    const unused = newMaterial('Unused', { map: 'assets/textures/unused.png' });
    project.settings.materials = [lava, unused];
    const [scenePath, scene] = Object.entries(scenes)[0]!;
    const spawn = newEntity('Player start');
    spawn.components.playerSpawn = {};
    const floor = newEntity('Floor');
    floor.tags = [lava.id];
    scene.entities.push(spawn, floor);
    await fs.mkdir(path.join(dir, path.dirname(scenePath)), { recursive: true });
    await fs.writeFile(path.join(dir, 'project.cwproj'), stringify(project));
    await fs.writeFile(path.join(dir, scenePath), stringify(scene));
    const { data } = await gameData(dir);
    const json = JSON.stringify(data);
    expect((data as { materials: { name: string }[] }).materials.map((m) => m.name)).toEqual(['Lava']);
    expect(usedAssets(json)).toEqual(['assets/textures/lava.png']);
    // Every scene goes along (for level changes), by name.
    expect(Object.keys((data as { scenes: object }).scenes)).toEqual([scenePath.split('/').pop()!.replace('.cwscene', '')]);
    expect((data as { start: string }).start).toBe(scenePath.split('/').pop()!.replace('.cwscene', ''));
    await fs.rm(dir, { recursive: true, force: true });
  });
});
