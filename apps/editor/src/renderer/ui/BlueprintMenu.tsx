/**
 * Base building: the blueprint menu (B), a scroll of the blueprints the player owns in sections (Concrete, Wood…).
 * A card picks a blueprint and placing starts. Flat colours by default; the base's `ui` pictures (panel, rolls,
 * card) and a piece's `icon` replace them.
 */
import type { BlueprintCard } from '@cocoaworlds/runtime';
import * as THREE from 'three';
import { useEffect, useState } from 'react';
import { assetUrl } from '../assets';

export interface BlueprintMenuState {
  cards: BlueprintCard[];
  ui: { panel: string; rolls: string; card: string; tag: string };
}

/** A project image as a URL ('' until loaded, or with no path). */
function useAsset(path: string): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    setUrl('');
    if (path) assetUrl(path).then((u) => live && setUrl(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

// ── Card pictures: the piece's boxes, drawn once each from above at an angle ──

let thumbRenderer: THREE.WebGLRenderer | null = null;
const thumbs = new Map<string, string>();

function thumbnail(card: BlueprintCard): string {
  const key = JSON.stringify([card.size, card.parts]);
  const done = thumbs.get(key);
  if (done) return done;
  try {
    thumbRenderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(128, 128, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const [sx, sy, sz] = card.size;
    for (const p of card.parts) {
      const m = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color: p.color }));
      m.position.set(p.at[0] - sx / 2, p.at[1] - sy / 2, p.at[2] - sz / 2);
      m.scale.set(...p.size);
      scene.add(m);
    }
    const r = Math.max(sx, sy, sz) * 0.75;
    const cam = new THREE.OrthographicCamera(-r, r, r, -r, -r * 10, r * 10);
    cam.position.set(r * 1.2, r * 0.9, r * 1.6);
    cam.lookAt(0, 0, 0);
    thumbRenderer.render(scene, cam);
    const url = thumbRenderer.domElement.toDataURL('image/png');
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
    box.dispose();
    thumbs.set(key, url);
    return url;
  } catch {
    return '';
  }
}

function Card({ card, bg, onPick }: { card: BlueprintCard; bg: string; onPick: (piece: string) => void }) {
  const icon = useAsset(card.icon);
  const pic = card.icon ? icon : thumbnail(card);
  return (
    <button
      type="button"
      className="cw-bp-card"
      style={bg ? { backgroundImage: `url("${bg}")` } : undefined}
      title={`${card.needs} ${card.material.toLowerCase()}`}
      onClick={() => onPick(card.piece)}
      data-testid="bp-card"
    >
      {pic && <img src={pic} alt="" draggable={false} />}
      <span>{card.label}</span>
      {card.count > 1 && <em>×{card.count}</em>}
    </button>
  );
}

export function BlueprintMenu({ menu, onPick, onClose }: { menu: BlueprintMenuState; onPick: (piece: string) => void; onClose: () => void }) {
  const panel = useAsset(menu.ui.panel);
  const rolls = useAsset(menu.ui.rolls);
  const card = useAsset(menu.ui.card);
  const sections: [string, BlueprintCard[]][] = [];
  for (const c of menu.cards) {
    let s = sections.find(([name]) => name === c.category);
    if (!s) sections.push((s = [c.category, []]));
    s[1].push(c);
  }
  const roll = rolls ? { backgroundImage: `url("${rolls}")` } : undefined;
  return (
    <div className="cw-bp-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="blueprint-menu">
      <div className="cw-bp-scroll" style={panel ? { backgroundImage: `url("${panel}")` } : undefined}>
        <div className="cw-bp-roll cw-bp-roll-l" style={roll} />
        <div className="cw-bp-roll cw-bp-roll-r" style={roll} />
        <h2>Blueprints</h2>
        {sections.length === 0 && <p className="cw-bp-none">No blueprints yet.</p>}
        {sections.map(([name, cards]) => (
          <section key={name}>
            <h3>{name}</h3>
            <div className="cw-bp-row">
              {cards.map((c) => (
                <Card key={c.piece} card={c} bg={card} onPick={onPick} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
