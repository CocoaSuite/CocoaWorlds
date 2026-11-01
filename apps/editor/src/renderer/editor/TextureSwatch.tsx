/** A thumbnail of a project texture (loaded from the project on demand). */
import { useEffect, useState } from 'react';
import { assetUrl } from '../assets';

export function TextureSwatch({ path, className = 'cw-mat-sw' }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    assetUrl(path).then(
      (u) => live && setUrl(u),
      () => live && setUrl(null),
    );
    return () => {
      live = false;
    };
  }, [path]);
  return <span className={`${className} tex`} style={url ? { backgroundImage: `url(${url})` } : undefined} />;
}
