'use client';

import { useState, useTransition } from 'react';
import { verifyListing } from '@/app/actions';
import { describeFreshness } from '@/lib/confidence.mjs';
import Thumb from './Thumb';

export default function VerifyRow({
  listing,
}: {
  listing: {
    id: string;
    title_raw: string;
    price: number;
    currency: string;
    url: string | null;
    image_url: string | null;
    source_name: string;
    subline_name: string | null;
    last_verified_at: string | Date | null;
  };
}) {
  const [price, setPrice] = useState(String(listing.price));
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fresh = describeFreshness(listing.last_verified_at);

  const run = (stillListed: boolean) =>
    startTransition(async () => {
      const res = await verifyListing(listing.id, stillListed, price);
      if (res.ok) setDone(res.action);
    });

  if (done) {
    return (
      <li className="flex items-center gap-3 rounded-xl border border-edge/60 bg-panel/50 p-3 text-sm text-muted">
        <span className="truncate">{listing.title_raw}</span>
        <span className="ml-auto text-ok">{done}</span>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-ink p-3">
      <div className="h-16 w-12 shrink-0 overflow-hidden">
        <Thumb src={listing.image_url} className="h-full w-full" />
      </div>

      <div className="min-w-[220px] flex-1">
        <p className="truncate text-sm">{listing.title_raw}</p>
        <p className="mt-0.5 text-[11px] text-muted">
          {listing.source_name}
          {listing.subline_name ? ` · ${listing.subline_name}` : ''} ·{' '}
          <span className={fresh.state === 'stale' ? 'text-alarm' : 'text-warn'}>{fresh.label}</span>
        </p>
      </div>

      <div className="w-32">
        <label className="label">Price now</label>
        <input className="field" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>

      <div className="flex items-center gap-2">
        {listing.url ? (
          <a href={listing.url} target="_blank" rel="noreferrer noopener" className="btn">
            Open
          </a>
        ) : null}
        <button className="btn btn-primary" onClick={() => run(true)} disabled={pending}>
          Still listed
        </button>
        <button
          className="btn"
          onClick={() => run(false)}
          disabled={pending}
          title="Only click this if you have actually looked and the listing is gone. This records positive evidence of a delisting — it never records a sale."
        >
          Gone
        </button>
      </div>
    </li>
  );
}
