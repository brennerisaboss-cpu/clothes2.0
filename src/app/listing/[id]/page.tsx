import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getListing } from '@/lib/queries';
import { query } from '@/lib/db';
import { describeFreshness } from '@/lib/confidence.mjs';
import Reverify from '@/components/Reverify';
import { reverseImageLinks } from '@/lib/reverseImage.mjs';
import Thumb from '@/components/Thumb';
import { proxyLinksFor } from '@/lib/proxyLinks.mjs';

export const dynamic = 'force-dynamic';

const money = (n: number, c: string) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: c,
    maximumFractionDigits: c === 'JPY' ? 0 : 2,
  }).format(n);

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) notFound();

  // Snapshot chain: every re-price writes a new row linked to the one it
  // supersedes, so the price history is the table itself.
  const history = await query<{
    id: string;
    price: number;
    currency: string;
    price_base: number | null;
    fx_rate_at_snapshot: number | null;
    date_seen: Date;
    status: string;
    evidence: string;
  }>(
    `with recursive chain as (
        select l.* from listings l where l.id = $1
        union
        select l.* from listings l join chain c
          on l.id = c.supersedes_id or l.supersedes_id = c.id
     )
     select id, price, currency, price_base, fx_rate_at_snapshot,
            date_seen, status::text as status, evidence::text as evidence
       from chain order by date_seen asc`,
    [id],
  );

  const actions = await query<{ action: string; created_at: Date; note: string | null }>(
    `select action, created_at, note from review_actions
      where listing_id = $1 order by created_at desc`,
    [id],
  );

  const fresh = describeFreshness(listing.last_verified_at);
  const itemRow = await query<{ item_id: string | null }>(
    'select item_id from listings where id = $1',
    [id],
  );
  const itemId = itemRow[0]?.item_id ?? null;

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted hover:text-fg">
        ← Back to grid
      </Link>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="overflow-hidden border border-edge-strong bg-ink">
          <Thumb src={listing.image_url} className="aspect-[3/4] w-full" />
        </div>

        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold">{listing.title_raw}</h1>
            <p className="mt-1 text-sm text-muted">
              {listing.subline_name ?? 'Sub-line unresolved'}
              {listing.ad_year ? ` · AD${listing.ad_year}` : ''} · {listing.source_name}
              {itemId ? (
                <>
                  {' · '}
                  <Link href={`/item/${itemId}`} className="text-accent hover:underline">
                    comps for this item
                  </Link>
                </>
              ) : (
                <>
                  {' · '}
                  <Link href="/unresolved" className="text-warn hover:underline">
                    unmatched
                  </Link>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-2xl font-semibold">{money(listing.price, listing.currency)}</span>
            {listing.price_base != null ? (
              <span className="text-sm text-muted">
                ≈ {money(listing.price_base, 'EUR')} at rate {listing.fx_rate_at_snapshot}
              </span>
            ) : (
              <span className="text-sm text-warn">no FX rate on file — base price not computed</span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ['Size (as listed)', listing.size_raw ?? '—'],
              ['Size region', listing.size_region],
              ['Condition (source)', listing.condition_raw ?? '—'],
              ['Condition tier', listing.condition_tier?.replace(/_/g, ' ') ?? '—'],
              ['Status', listing.status],
              ['Evidence class', listing.evidence.replace(/_/g, ' ')],
              ['Entered', listing.entered_manually ? 'by hand' : 'automated'],
              ['Verification', fresh.label],
              ['Confidence weight', String(fresh.weight)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt>
                <dd className="mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>

          {listing.notes ? (
            <p className="rounded-md border border-edge bg-ink px-3 py-2 text-sm text-muted">
              {listing.notes}
            </p>
          ) : null}

          {(() => {
            const proxy = proxyLinksFor(listing as never);
            if (!proxy.links.length && !proxy.suppressed) return null;
            return (
              <div className="border border-edge-strong bg-ink p-3">
                <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Buy via proxy</h2>
                {proxy.suppressed ? (
                  <p className="text-[12px] leading-snug text-accent">{proxy.reason}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {proxy.links.map((l) => (
                        <a key={l.id} href={l.href} target="_blank" rel="noreferrer noopener" className="btn">
                          {l.label}
                        </a>
                      ))}
                    </div>
                    {proxy.reason ? (
                      <p className="mt-2 text-[11px] leading-snug text-warn">{proxy.reason}</p>
                    ) : null}
                    <p className="mt-2 text-[11px] leading-snug text-muted">
                      Plain links to the proxy service. Nothing is ordered or automated here.
                    </p>
                  </>
                )}
              </div>
            );
          })()}

          <div className="flex flex-wrap items-center gap-2">
            {listing.url ? (
              <a href={listing.url} target="_blank" rel="noreferrer noopener" className="btn btn-primary">
                Open listing
              </a>
            ) : null}
            {reverseImageLinks(listing.image_url).map((l) => (
              <a
                key={l.id}
                href={l.href}
                target="_blank"
                rel="noreferrer noopener"
                className="btn"
                title="Opens an image search in your browser. Nothing is fetched or automated here."
              >
                {l.label}
              </a>
            ))}
          </div>
          <p className="text-xs text-muted">
            This app never completes a purchase. Every buy is reviewed and executed by you.
          </p>

          {listing.entered_manually ? (
            <div className="rounded-lg border border-edge bg-ink p-3">
              <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">
                Re-verify now
              </h2>
              <p className="mb-2 text-xs text-muted">
                Overrides the {'\u2265'}14-day queue. Confirming resets the clock; a different
                price is written as a new snapshot rather than replacing this one.
              </p>
              <Reverify
                listingId={listing.id}
                currentPrice={listing.price}
                currency={listing.currency}
                url={listing.url}
                variant="full"
              />
            </div>
          ) : null}
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-base font-semibold">Price snapshots</h2>
        <p className="mb-3 text-sm text-muted">
          {history.length} observation{history.length === 1 ? '' : 's'}. Each row is a separate
          snapshot at the FX rate that applied when it was taken.
        </p>
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="p-2 font-medium">Seen</th>
                <th className="p-2 font-medium">Price</th>
                <th className="p-2 font-medium">Base</th>
                <th className="p-2 font-medium">FX rate</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className={`border-t border-edge ${h.id === id ? 'bg-panel/60' : ''}`}>
                  <td className="p-2 text-muted">{new Date(h.date_seen).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td className="p-2">{money(h.price, h.currency)}</td>
                  <td className="p-2 text-muted">{h.price_base != null ? money(h.price_base, 'EUR') : '—'}</td>
                  <td className="p-2 text-muted">{h.fx_rate_at_snapshot ?? '—'}</td>
                  <td className="p-2 text-muted">{h.status}</td>
                  <td className="p-2 text-muted">{h.evidence.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {actions.length ? (
        <section>
          <h2 className="mb-2 text-base font-semibold">Review history</h2>
          <ul className="space-y-1 text-sm text-muted">
            {actions.map((a, i) => (
              <li key={i}>
                <span className="text-fg">{a.action}</span> ·{' '}
                {new Date(a.created_at).toISOString().slice(0, 16).replace('T', ' ')}
                {a.note ? ` · ${a.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
