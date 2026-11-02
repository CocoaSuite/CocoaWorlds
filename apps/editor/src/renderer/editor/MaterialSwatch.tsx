/** A small picture of a project material: its colour, its image tinted by the colour, and see-through or glowing looks. */
import type { MaterialDef } from '@cocoaworlds/core';
import { useEffect, useState } from 'react';
import { assetUrl } from '../assets';

export function MaterialSwatch({ def, className = 'cw-mat-sw' }: { def: MaterialDef | undefined; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const map = def?.map;
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (map)
      assetUrl(map).then(
        (u) => live && setUrl(u),
        () => live && setUrl(null),
      );
    return () => {
      live = false;
    };
  }, [map]);
  if (!def) return <span className={`${className} cw-mat-missing`} />;
  const glow = def.emissive && (def.emissiveStrength ?? 1) > 0 ? `inset 0 0 8px ${def.emissive}` : undefined;
  return (
    <span
      className={`${className} cw-mat-proj`}
      style={{
        backgroundColor: def.color,
        backgroundImage: url ? `url(${url})` : `linear-gradient(135deg, rgba(255,255,255,${0.35 * (1 - def.roughness) + 0.25 * def.metalness}) 0%, transparent 55%)`,
        backgroundBlendMode: url ? 'multiply' : undefined,
        opacity: 0.35 + 0.65 * (def.opacity ?? 1),
        boxShadow: glow,
      }}
    />
  );
}
