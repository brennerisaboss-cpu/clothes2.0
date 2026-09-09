'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { candidateItems, resolveListing } from '@/app/actions';
import { reverseImageLinks } from '@/lib/reverseImage.mjs';
import Thumb from './Thumb';

type Subline = { id: string; display_name: string; monitored: boolean; ambiguous: boolean };
type Candidate = { id: string; canonical_name: string; ad_year: number | null; listings: number };

export type Suggestion = {
  itemId: string;
  name: string;
  sublineId: string | null;
  listings: number;
  tier: string;
  agreements: string[];
  assumptions: string[];
  safe: boolean;
};

/**
 * Settle one listing's identity by hand.
 *
 * This is deliberately the primary matching path, not a fallback: for a single
 * user with a narrow brand list, recognising a piece from its photo is faster
 * and more reliable than any matcher. The reverse-image links are the tool for
 * that, and they double as counterfeit screening.
 */
export default function ResolvePanel({
  listing,
  sublines,
  suggestions = [],
}: {
  listing: {
    id: string;
    title_raw: string;
    image_url: string | null;
    url: string | null;
    subline_id: string | null;
    price: number;
    currency: string;
    source_name: string;
  };
  sublines: Subline[];
  /** What this listing probably is, scored against the items already held. */
  suggestions?: Suggestion[];
}) {
  const [sublineId, setSublineId] = useState(listing.subline_id ?? '');
  const [adYear, setAdYear] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [linkTo, setLinkTo] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Offer existing items to link to as soon as a sub-line narrows the field.
  useEffect(() => {
    if (!sublineId) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    candidateItems(sublineId).then((rows) => {
      if (!cancelled) setCandidates(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [sublineId]);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const res = await resolveListing(listing.id,
        linkTo ? { itemId: linkTo } : { sublineId, adYear });
      if (res.ok) setDone(res.itemId);
      else setError(res.error);
    });

  const links = reverseImageLinks(listing.image_url);

  if (done) {
    return (
      <div className="rounded-xl border border-ok bg-ok/5 p-4 text-sm">
        <span className="text-ok">Resolved.</span>{' '}
        <Link href={`/item/${done}`} className="underline hover:text-accent">
          View item
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge bg-ink p-3 sm:flex-row">
      <div className="h-40 w-32 shrink-0 overflow-hidden rounded bg-ink">
        {listing.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-muted">
            no image
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-sm">{listing.title_raw}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {listing.source_name} · {listing.price} {listing.currency}
          </p>
        </div>

        {/* What it probably is, before the manual controls.
            Most of what these venues publish does not state enough to be keyed
            — a Vestiaire seller types the house and the garment and nothing
            else — so the exact matcher leaves it here, pooling with nothing and
            unable to be scored. Each proposal says what it agreed on and what
            it had to assume, because accepting one is a click and unpicking it
            is not. */}
        {suggestions.length ? (
          <div className="border border-edge bg-panel p-2.5">
            <p className="label mb-1.5">Probably</p>
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.itemId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        const res = await resolveListing(listing.id, { itemId: s.itemId });
                        if (res.ok) setDone(res.itemId);
                        else setError(res.error);
                      })
                    }
                  >
                    {s.tier === 'strong' ? 'Same piece' : 'Link'}
                  </button>
                  <span className="text-[13px]">{s.name}</span>
                  <span className="text-[11px] text-muted">
                    {s.listings} listing{s.listings === 1 ? '' : 's'}
                  </span>
                  <span className="w-full text-[11px] text-muted">
                    agrees on {s.agreements.join(', ') || 'the house only'}
                    {s.assumptions.length ? (
                      <span className="ink-madder"> · assumes {s.assumptions.join('; ')}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {links.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted">Identify by photo:</span>
            {links.map((l) => (
              <a
                key={l.id}
                href={l.href}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded border border-edge px-2 py-1 text-[11px] text-fg/80 hover:border-accent hover:text-accent"
              >
                {l.label}
              </a>
            ))}
            {listing.url ? (
              <a
                href={listing.url}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded border border-edge px-2 py-1 text-[11px] text-fg/80 hover:border-accent hover:text-accent"
              >
                Listing
              </a>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-muted">
            No image on this listing, so there is nothing to reverse-search. Add an image URL to
            use that route.
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label">Sub-line</label>
            <select
              className="field"
              value={sublineId}
              onChange={(e) => {
                setSublineId(e.target.value);
                setLinkTo('');
              }}
            >
              <option value="">— pick —</option>
              {sublines.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                  {!s.monitored ? ' (not monitored)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">AD year</label>
            <input
              className="field"
              inputMode="numeric"
              placeholder="unknown"
              value={adYear}
              onChange={(e) => setAdYear(e.target.value)}
              disabled={Boolean(linkTo)}
            />
          </div>
          <div className="flex items-end">
            <button className="btn btn-primary w-full" onClick={submit} disabled={pending || (!sublineId && !linkTo)}>
              {linkTo ? 'Link' : 'Create item'}
            </button>
          </div>
        </div>

        {candidates.length ? (
          <div>
            <label className="label">Or link to an existing item</label>
            <select className="field" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
              <option value="">— create a new item —</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.canonical_name}
                  {c.ad_year ? ` · AD${c.ad_year}` : ' · AD?'} · {c.listings} listing
                  {c.listings === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              Linking pools this listing&rsquo;s price into that item&rsquo;s comps. Only link
              pieces you are confident are the same garment.
            </p>
          </div>
        ) : null}

        {error ? <p className="text-xs text-alarm">{error}</p> : null}
      </div>
    </div>
  );
}
