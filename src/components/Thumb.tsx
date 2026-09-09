'use client';

import { useState } from 'react';

/**
 * A source image with a graceful fallback.
 *
 * Images are referenced at the source rather than re-hosted, so a dead URL is
 * routine — a shop deletes an asset, a marketplace starts hotlink-blocking. The
 * browser's broken-image glyph is worse than saying so plainly.
 */
export default function Thumb({
  src,
  className = '',
  alt = '',
}: {
  src: string | null | undefined;
  className?: string;
  alt?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    // A blank plate, not a grey box.
    //
    // On these shops a missing image is common, so this appears often enough to
    // set the tone of the page — and a flat grey rectangle with NO IMAGE across
    // it is the most generic thing an interface can put on screen. A halftone
    // field with the reason set small underneath reads as a plate that has not
    // been printed yet, which is what it is.
    return (
      <span
        className={`flex flex-col items-center justify-center gap-1 text-center ${className}`}
        style={{
          backgroundColor: 'var(--color-ink)',
          backgroundImage: 'radial-gradient(var(--color-edge-strong) 0.85px, transparent 0.85px)',
          backgroundSize: '5px 5px',
        }}
      >
        <span className="text-[9px] uppercase tracking-[0.14em] text-muted">
          {broken ? 'plate lost' : 'no plate'}
        </span>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`object-cover ${className}`}
    />
  );
}
