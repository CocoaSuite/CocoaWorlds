import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gameFileName, ownRuntime, playerFiles, usedAssets } from '../src/main/export';

describe('export helpers', () => {
  it('names files after the game safely', () => {
    expect(gameFileName('Coin Counter')).toBe('Coin Counter');
    expect(gameFileName('Café: «Deluxe»/2!')).toBe('Cafe Deluxe2');
    expect(gameFileName('   ')).toBe('Game');
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
