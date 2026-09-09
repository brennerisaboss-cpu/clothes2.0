'use client';

import { useState, useTransition } from 'react';
import { verifyListing } from '@/app/actions';

/**
 * On-demand re-verification, available on any listing regardless of whether the
 * 14-day queue has surfaced it yet.
 *
 * This records YOUR check. It cannot fetch anything: the manual tier exists
 * because those sources prohibit automated collection, so "refresh" here means
 * you opened the listing and told the app what you saw. That distinction is
 * kept visible in the UI rather than implied away.
 */
export default function Reverify({
  listingId,
  currentPrice,
  currency,
  url,
  variant = 'compact',
  onDone,
}: {
  listingId: string;
  currentPrice: number;
  currency: string;
  url?: string | null;
  variant?: 'compact' | 'full';
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(currentPrice));
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (stillListed: boolean) =>
    startTransition(async () => {
      const res = await verifyListing(listingId, stillListed, price);
      if (res.ok) {
        setResult(
          res.action === 'repriced'
            ? 'New price recorded as a fresh snapshot.'
            : res.action === 'delisted'
              ? 'Marked delisted — not recorded as a sale.'
              : 'Confirmed. Clock reset.',
        );
        setOpen(false);
        onDone?.();
      }
    });

  if (!open) {
    return (
      <div className={variant === 'full' ? 'space-y-2' : 'contents'}>
        <button
          className={
            variant === 'full'
              ? 'btn'
              : 'border border-edge-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-fg hover:text-ink'
          }
          onClick={() => {
            setOpen(true);
            setResult(null);
          }}
          title="Re-verify now, without waiting for the re-check queue"
        >
          Re-verify
        </button>
        {result ? (
          <span className="text-[11px] text-ok">{result}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-fg bg-panel p-2">
      <p className="text-[11px] leading-snug text-muted">
        Open the listing, then tell the app what you saw. Nothing is fetched automatically.
      </p>
      <div className="flex items-center gap-1.5">
        <input
          className="field py-1 text-xs"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          aria-label={`Price now, in ${currency}`}
        />
        <span className="text-[11px] text-muted">{currency}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="border border-edge-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-fg hover:text-ink"
          >
            Open
          </a>
        ) : null}
        <button
          className="border border-fg bg-fg px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
          onClick={() => run(true)}
          disabled={pending}
        >
          Still listed
        </button>
        <button
          className="border border-edge-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-alarm hover:text-ink hover:border-alarm disabled:opacity-50"
          onClick={() => run(false)}
          disabled={pending}
          title="Only if you looked and it is gone. Records a delisting, never a sale."
        >
          Gone
        </button>
        <button
          className="ml-auto rounded px-2 py-1 text-[11px] text-muted hover:text-fg"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
