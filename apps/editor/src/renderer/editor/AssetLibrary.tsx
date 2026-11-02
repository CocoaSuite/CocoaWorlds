/**
 * The asset library (the Assets tab): search and categories on the left, the project's assets as tiles with
 * pictures on the right. Materials show on a sphere and models from three-quarters above.
 *
 * - Materials and textures: click to paint faces with them. Double-click a material to open it in Materials.
 * - Prefabs and models: click to place one where the view is looking.
 * - Sounds: click to listen (again to stop).
 */
import { readComponent, type MaterialDef, type ModelData } from '@cocoaworlds/core';
import { Button, Icon } from '@cocoaworlds/ui';
import { useEffect, useRef, useState } from 'react';
import type { AssetEntry, AssetKind } from '../../shared/api';
import { assetUrl } from '../assets';
import { t } from '../i18n';
import { useEditor } from '../store';
import { useMaterialThumb, useModelThumb } from './asset-thumbs';
import { TextureSwatch } from './TextureSwatch';

type Category = 'all' | 'materials' | 'prefabs' | 'models' | 'textures' | 'sounds';
const CATEGORIES: Category[] = ['all', 'materials', 'prefabs', 'models', 'textures', 'sounds'];
const LABEL: Record<Category, Parameters<typeof t>[0]> = {
  all: 'assets.all',
  materials: 'assets.materials',
  prefabs: 'assets.prefabs',
  models: 'assets.models',
  textures: 'assets.textures',
  sounds: 'assets.sounds',
};
const ICON: Record<Category, Parameters<typeof Icon>[0]['name']> = { all: 'grid', materials: 'paint', prefabs: 'cube', models: 'cube', textures: 'face', sounds: 'sound' };
const ACCEPT: Record<AssetKind, string> = { textures: '.png,.jpg,.jpeg,.webp', sounds: '.ogg,.mp3,.wav', models: '.glb,.gltf' };
const kindOfFile = (name: string): AssetKind | null => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (['textures', 'sounds', 'models'] as AssetKind[]).find((k) => ACCEPT[k].split(',').includes(`.${ext}`)) ?? null;
};

const NO_MATERIALS: MaterialDef[] = [];

// (The category and search are kept while the tab is closed and opened again.)
let lastCategory: Category = 'all';

type Tile =
  | { kind: 'materials'; id: string; name: string; def: MaterialDef }
  | { kind: 'prefabs'; id: string; name: string; prefabId: string; path: string; objects: number; model: string | null }
  | { kind: 'models' | 'textures' | 'sounds'; id: string; name: string; asset: AssetEntry };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function AssetLibrary() {
  const prefabs = useEditor((s) => s.prefabs);
  const assets = useEditor((s) => s.assets);
  // (The list itself, not a fresh empty one each time: that would re-render for ever.)
  const materials = useEditor((s) => s.session?.project.settings.materials) ?? NO_MATERIALS;
  const [cat, setCatState] = useState<Category>(lastCategory);
  const [q, setQ] = useState('');
  const setCat = (c: Category) => {
    lastCategory = c;
    setCatState(c);
  };

  const all: Tile[] = [
    ...materials.map((m): Tile => ({ kind: 'materials', id: m.id, name: m.name, def: m })),
    ...[...prefabs.values()].map(({ path, prefab }): Tile => {
      const model = prefab.entities.map((e) => (e.components.model ? readComponent<ModelData>('model', e.components.model).model : '')).find(Boolean) ?? null;
      return { kind: 'prefabs', id: prefab.id, name: prefab.name, prefabId: prefab.id, path, objects: prefab.entities.length, model };
    }),
    ...(['models', 'textures', 'sounds'] as const).flatMap((k) => assets[k].map((a): Tile => ({ kind: k, id: a.path, name: a.name, asset: a }))),
  ];
  const count = (c: Category) => (c === 'all' ? all.length : all.filter((x) => x.kind === c).length);
  const query = q.trim().toLowerCase();
  const shown = all.filter((x) => (cat === 'all' || x.kind === cat) && (!query || x.name.toLowerCase().includes(query))).sort((a, b) => a.name.localeCompare(b.name));

  // Import: the files go to their own kind (images, sounds, models); the view switches to what came in.
  const importFiles = async (files: File[]) => {
    const groups = new Map<AssetKind, File[]>();
    for (const f of files) {
      const k = kindOfFile(f.name);
      if (!k) {
        useEditor.getState().notify(t('assets.unknownFile').replace('{name}', f.name));
        continue;
      }
      groups.set(k, [...(groups.get(k) ?? []), f]);
    }
    if (groups.size === 1) setCat([...groups.keys()][0]!);
    for (const [k, list] of groups) await useEditor.getState().importAssets(k, list);
  };
  const pickAny = useRef<HTMLInputElement>(null);
  const importAccept = cat === 'textures' || cat === 'sounds' || cat === 'models' ? ACCEPT[cat] : Object.values(ACCEPT).join(',');

  return (
    <div className="cw-lib">
      <aside className="cw-lib-side" aria-label={t('assets.categories')}>
        <input className="cw-input" type="search" placeholder={t('assets.search')} aria-label={t('assets.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
        <div className="cw-lib-cats-h">
          <span>{t('assets.categories')}</span>
          {cat !== 'materials' && cat !== 'prefabs' && (
            <Button size="sm" className="cw-lib-import" onClick={() => pickAny.current?.click()}>
              {t('assets.importShort')}
            </Button>
          )}
        </div>
        <div className="cw-lib-cats" role="tablist" aria-label={t('assets.categories')}>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
              <Icon name={ICON[c]} />
              <span>{t(LABEL[c])}</span>
              <span className="cw-lib-n">{count(c)}</span>
            </button>
          ))}
        </div>
        <input
          ref={pickAny}
          type="file"
          multiple
          hidden
          accept={importAccept}
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = '';
            if (files.length) void importFiles(files);
          }}
        />
        {(['textures', 'sounds', 'models'] as AssetKind[]).map((k) => (
          // (One chooser per kind, for File › Import and tests.)
          <input
            key={k}
            type="file"
            multiple
            hidden
            accept={ACCEPT[k]}
            data-testid={`import-${k}`}
            aria-label={t('assets.import').replace('{kind}', t(LABEL[k]).toLowerCase())}
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = '';
              if (!files.length) return;
              setCat(k);
              void useEditor.getState().importAssets(k, files);
            }}
          />
        ))}
      </aside>
      <div className="cw-lib-grid" role="list" aria-label={t(LABEL[cat])}>
        {shown.map((x) => (
          <AssetTile key={`${x.kind}:${x.id}`} tile={x} showKind={cat === 'all'} />
        ))}
        {!shown.length && <div className="cw-muted cw-lib-empty">{query ? t('assets.noMatch') : t(EMPTY[cat])}</div>}
      </div>
    </div>
  );
}

const EMPTY: Record<Category, Parameters<typeof t>[0]> = {
  all: 'assets.emptyAll',
  materials: 'assets.emptyMaterials',
  prefabs: 'assets.none',
  models: 'assets.emptyModels',
  textures: 'assets.noTextures',
  sounds: 'assets.emptySounds',
};

function MaterialPicture({ def }: { def: MaterialDef }) {
  const url = useMaterialThumb(def);
  return url ? <img src={url} alt="" className="cw-lib-pic" draggable={false} /> : <span className="cw-lib-pic wait" />;
}

function ModelPicture({ path }: { path: string }) {
  const url = useModelThumb(path);
  return url ? <img src={url} alt="" className="cw-lib-pic" draggable={false} /> : <span className="cw-lib-pic wait"><Icon name="cube" /></span>;
}

/** Plays a sound file while asked (one at a time). */
let playing: { path: string; audio: HTMLAudioElement; done: () => void } | null = null;
function useListening(path: string): [boolean, () => void] {
  const [on, setOn] = useState(playing?.path === path);
  useEffect(() => () => void (playing?.path === path && (playing.audio.pause(), (playing = null))), [path]);
  const toggle = () => {
    if (playing) {
      const was = playing.path;
      playing.audio.pause();
      playing.done();
      playing = null;
      if (was === path) return;
    }
    void assetUrl(path).then((url) => {
      const audio = new Audio(url);
      const done = () => setOn(false);
      audio.onended = () => {
        if (playing?.audio === audio) playing = null;
        done();
      };
      playing = { path, audio, done };
      setOn(true);
      void audio.play().catch(done);
    });
  };
  return [on, toggle];
}

function AssetTile({ tile, showKind }: { tile: Tile; showKind: boolean }) {
  const st = useEditor.getState();
  const [listening, listen] = useListening(tile.kind === 'sounds' ? tile.asset.path : '');
  let picture: React.ReactNode;
  let action: string;
  let title: string;
  let onClick: () => void;
  let onDouble: (() => void) | undefined;
  switch (tile.kind) {
    case 'materials':
      picture = <MaterialPicture def={tile.def} />;
      action = t('assets.paint');
      title = `${tile.name}${tile.def.graph ? ` · ${t('assets.graphMaterial')}` : ''}\n${t('assets.materialHint')}`;
      onClick = () => {
        st.setWorkspace('scene');
        st.setPaintMaterial(tile.id);
        st.setTool('paint');
      };
      onDouble = () => st.pickMaterial(tile.id, true);
      break;
    case 'prefabs':
      picture = tile.model ? <ModelPicture path={tile.model} /> : <span className="cw-lib-pic icon"><Icon name="cube" /></span>;
      action = t('assets.place');
      title = `${tile.name} · ${t('assets.objects').replace('{n}', String(tile.objects))}\n${tile.path}\n${t('assets.placeHint')}`;
      onClick = () => st.placePrefab(tile.prefabId);
      break;
    case 'models':
      picture = <ModelPicture path={tile.asset.path} />;
      action = t('assets.place');
      title = `${tile.asset.path} · ${kb(tile.asset.bytes)}\n${t('assets.placeHint')}`;
      onClick = () => st.placeModel(tile.asset.path);
      break;
    case 'textures':
      picture = <TextureSwatch path={tile.asset.path} className="cw-lib-pic tex" />;
      action = t('assets.paint');
      title = `${tile.asset.path} · ${kb(tile.asset.bytes)}\n${t('assets.paintWith')}`;
      onClick = () => {
        st.setPaintMaterial(tile.asset.path);
        st.setTool('paint');
      };
      break;
    case 'sounds':
      picture = (
        <span className={`cw-lib-pic icon${listening ? ' on' : ''}`}>
          <Icon name="sound" />
        </span>
      );
      action = listening ? t('assets.stopListening') : t('assets.listen');
      title = `${tile.asset.path} · ${kb(tile.asset.bytes)}`;
      onClick = listen;
      break;
  }
  return (
    <div className={`cw-lib-tile k-${tile.kind}`} role="listitem" aria-label={tile.name} title={title}>
      <button type="button" className="cw-lib-hit" aria-label={action} onClick={onClick} onDoubleClick={onDouble}>
        {picture}
        <span className="cw-lib-name">{tile.name}</span>
      </button>
      {showKind && <span className="cw-lib-kind">{t(LABEL[tile.kind])}</span>}
    </div>
  );
}
