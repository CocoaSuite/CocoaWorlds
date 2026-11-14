/**
 * The page of an exported game: reads `game/game.json` and its assets from beside it and plays it full-window.
 */
import '@cocoaworlds/ui/styles.css';
import '../editor.css';
import './player.css';
import { uiOf, type SceneFile } from '@cocoaworlds/core';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setAssetReader } from '../assets';
import { BlueprintMenu } from '../ui/BlueprintMenu';
import { MineUi } from '../ui/MineUi';
import { HudView, type Hud } from '../ui/Hud';
import { UiLayer } from '../ui/UiLayer';
import { SaveMenu } from '../ui/SaveMenu';
import { GameRunner, type GameData } from './runner';

const BASE = 'game/';

async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const r = await fetch(BASE + path.split('/').map(encodeURIComponent).join('/'));
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.arrayBuffer();
}

function Player() {
  const host = useRef<HTMLDivElement>(null);
  const runner = useRef<GameRunner | null>(null);
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [locked, setLocked] = useState(false);
  const [uiMouse, setUiMouse] = useState(false);
  /** The scene being played (it changes with level changes). */
  const [scene, setScene] = useState<SceneFile | null>(null);

  useEffect(() => {
    setAssetReader(fetchBytes);
    fetch(`${BASE}game.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`game.json: ${r.status}`))))
      .then((d: GameData) => {
        if (d.format !== 'cocoaworlds.game') throw new Error('This folder does not hold a CocoaWorlds game.');
        document.title = d.name;
        setData(d);
      })
      .catch((e: Error) =>
        setError(location.protocol === 'file:' ? 'Web games have to be opened from a web server (for example itch.io, or “npx serve” in this folder).' : e.message),
      );
  }, []);

  useEffect(() => {
    if (!data || !host.current) return;
    if (!data.scene.entities.some((e) => e.components.playerSpawn)) return setError('This game has no Player start.');
    setScene(data.scene);
    const r = new GameRunner(host.current, data, { hud: setHud, lock: setLocked, uiMouse: setUiMouse, scene: setScene });
    runner.current = r;
    (window as unknown as { __cwGame?: GameRunner }).__cwGame = r;
    r.start().catch((e: Error) => setError(e.message));
    return () => r.dispose();
  }, [data]);

  return (
    <div className="cw-player" ref={host}>
      {scene && hud && <UiLayer ui={uiOf(scene.settings)} live={hud.ui} values={hud.allValues} onClick={(id) => runner.current?.clickUi(id)} onRow={(l, row) => runner.current?.pickRow(l, row)} />}
      {hud && <HudView hud={hud} />}
      {hud?.blueprints && <BlueprintMenu menu={hud.blueprints} onPick={(id) => runner.current?.pickBlueprint(id)} onClose={() => runner.current?.closeBlueprints()} />}
      {hud?.mine && <MineUi hud={hud.mine} menu={hud.mineMenu} onAction={(a, arg) => runner.current?.mineAction(a, arg)} />}
      {locked && <div className="cw-crosshair" aria-hidden="true" />}
      {data && hud && !locked && !uiMouse && data.rules.saveMenu && (
        <SaveMenu onResume={() => runner.current?.capture()} onSave={() => runner.current?.saveGame() ?? false} onLoad={() => runner.current?.loadGame() ?? false} savedAt={runner.current?.savedAt ?? null} />
      )}
      {data && hud && !locked && !uiMouse && !data.rules.saveMenu && (
        <button type="button" className="cw-ov cw-click-play" data-testid="click-to-play" onClick={() => runner.current?.capture()}>
          <strong>{data.name}</strong>
          <span>Click to play&nbsp;&nbsp; WASD move&nbsp;&nbsp; Space jump&nbsp;&nbsp; E use&nbsp;&nbsp; Esc pause</span>
        </button>
      )}
      {!hud && !error && <div className="cw-player-msg">Loading…</div>}
      {error && (
        <div className="cw-player-msg" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Player />);
