'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { recordReview } from '@/app/actions';
import Reverify from './Reverify';
import type { Score } from '@/lib/scoring.mjs';
import { describeFreshness } from '@/lib/confidence.mjs';

export type CardData = {
  id: string;
  title_raw: string;
  subline_name: string | null;
  subline_ambiguous: boolean | null;
  subline_monitored: boolean | null;
  size_raw: string | null;
  size_region: string;
  condition_raw: string | null;
  condition_tier: string | null;
  price: number;
  currency: string;
  price_base: number | null;
  url: string | null;
  image_url: string | null;
  source_name: string;
  status: string;
  ad_year: number | null;
  last_verified_at: string | Date | null;
  entered_manually: boolean;
  last_action: string | null;
};

const money = (n: number, c: string) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: c,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: c === 'JPY' ? 0 : 2,
  }).format(n);

export default function Card({ card, score }: { card: CardData; score?: Score }) {
  const [pending, startTransition] = useTransition();
  const [imageBroken, setImageBroken] = useState(false);
  const fresh = describeFreshness(card.last_verified_at);

  const act = (action: string) =>
    startTransition(async () => {
      await recordReview(card.id, action);
    });

  const freshColor =
    fresh.state === 'fresh' ? 'text-muted' : fresh.state === 'due' ? 'text-warn' : 'text-alarm';

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-xl border bg-panel transition-colors ${
        card.last_action === 'bought' ? 'border-fg border-2' : 'border-edge hover:border-edge/80'
      }`}
    >
      <Link href={`/listing/${card.id}`} className="relative block aspect-[3/4] overflow-hidden bg-ink">
        {card.image_url && !imageBroken ? (
          // Source image URLs are rendered directly rather than re-hosted.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.image_url}
            alt=""
            loading="lazy"
            onError={() => setImageBroken(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] uppercase tracking-widest text-muted">
            {imageBroken ? 'image unavailable' : 'no image'}
          </div>
        )}

        <div className="absolute inset-x-2 top-2 flex flex-wrap items-start gap-1">
          {card.subline_name ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium backdrop-blur ${
                card.subline_ambiguous
                  ? 'bg-warn text-ink'
                  : card.subline_monitored === false
                    ? 'bg-muted text-ink'
                    : 'bg-fg text-ink'
              }`}
            >
              {card.subline_name}
            </span>
          ) : (
            <span className="bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">
              unresolved
            </span>
          )}
          {card.ad_year ? (
            <span className="bg-fg px-1.5 py-0.5 text-[10px] font-semibold text-ink">
              AD{card.ad_year}
            </span>
          ) : null}
          {card.status !== 'active' ? (
            <span className="ml-auto shrink-0 bg-panel px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg">
              {card.status}
            </span>
          ) : null}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-[13px] leading-snug">{card.title_raw}</h3>

        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{money(card.price, card.currency)}</span>
          {card.price_base != null && card.currency !== 'EUR' ? (
            <span className="text-[11px] text-muted">≈ {money(card.price_base, 'EUR')}</span>
          ) : null}
        </div>

        {score?.scored ? (
          <div
            className={`flex flex-wrap items-baseline gap-x-2 border-l-4 pl-2 text-[11px] ${
              score.flags.some((f) => f.severity === 'high')
                ? 'border-accent'
                : (score.profit ?? 0) > 0
                  ? 'border-ok'
                  : 'border-edge-strong'
            }`}
          >
            <span className={`font-semibold ${(score.profit ?? 0) > 0 ? 'text-ok' : 'text-alarm'}`}>
              {(score.profit ?? 0) > 0 ? '+' : ''}
              {new Intl.NumberFormat('en-GB', {
                style: 'currency',
                currency: 'EUR',
                currencyDisplay: 'narrowSymbol',
                maximumFractionDigits: 0,
              }).format(score.profit ?? 0)}
            </span>
            <span className="text-muted">
              {score.spreadPct == null ? '' : `${(score.spreadPct * 100).toFixed(0)}%`}
            </span>
            <span className="text-muted">conf {score.confidence?.toFixed(2)}</span>
            {score.provisional ? (
              <span className="w-full text-accent">provisional · {score.resale?.comps} comp
                {score.resale?.comps === 1 ? '' : 's'}</span>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted">
          <span>{card.source_name}</span>
          {card.size_raw ? (
            <span>
              · {card.size_raw}
              {card.size_region !== 'UNKNOWN' ? ` ${card.size_region}` : ''}
            </span>
          ) : null}
          {card.condition_tier ? <span>· {card.condition_tier.replace(/_/g, ' ')}</span> : null}
        </div>

        {card.entered_manually ? (
          <div className={`text-[11px] ${freshColor}`}>
            {fresh.label}
            {fresh.state !== 'fresh' ? ` · weight ${fresh.weight}` : ''}
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
          {card.url ? (
            <a
              href={card.url}
              target="_blank"
              rel="noreferrer noopener"
              className="border border-edge-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-fg hover:text-ink"
            >
              Open
            </a>
          ) : null}
          {card.entered_manually ? (
            <Reverify
              listingId={card.id}
              currentPrice={card.price}
              currency={card.currency}
              url={card.url}
            />
          ) : null}
          <button
            className="border border-edge-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-fg hover:text-ink disabled:opacity-40"
            onClick={() => act('reviewed')}
            disabled={pending}
          >
            Reviewed
          </button>
          <button
            className="border border-edge-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide hover:bg-alarm hover:text-ink hover:border-alarm disabled:opacity-40"
            onClick={() => act('dismissed')}
            disabled={pending}
          >
            Dismiss
          </button>
          <button
            className="ml-auto border border-fg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-fg hover:text-ink disabled:opacity-40"
            onClick={() => act('bought')}
            disabled={pending}
            title="Records that you bought this. There is no automated purchase anywhere in this app."
          >
            Bought
          </button>
        </div>
      </div>
    </article>
  );
}
