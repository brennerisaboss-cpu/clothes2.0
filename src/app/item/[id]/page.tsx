import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getItem, itemObservations } from '@/lib/queries';
import { summariseItem, MIN_COMPS } from '@/lib/priceHistory.mjs';
import { scoreAllRoutes } from '@/lib/scoring.mjs';
import ScoreBreakdown from '@/components/ScoreBreakdown';
import { listRoutes } from '@/lib/queries';
import { isWatchedForHeat } from '@/app/actions';
import type { TierSummary } from '@/lib/priceHistory.mjs';
import { reverseImageLinks } from '@/lib/reverseImage.mjs';
import PriceHistoryChart from '@/components/PriceHistoryChart';
import Thumb from '@/components/Thumb';

export const dynamic = 'force-dynamic';

const eur = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(n);

/** Walk supersedes links back to the first snapshot, so one listing's
 *  re-prices group into a single chain on the chart. */
function chainRoots(observations: { id: string; supersedes_id: string | null }[]) {
  const parent = new Map(observations.map((o) => [o.id, o.supersedes_id]));
  const root = new Map<string, string>();
  for (const o of observations) {
    let cur = o.id;
    const seen = new Set<string>();
    while (parent.get(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parent.get(cur)!;
    }
    root.set(o.id, cur);
  }
  return root;
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItem(id);
  if (!item) notFound();

  const observations = await itemObservations(id);

  // Split by the role each source plays. Pooling them was the phase-2 mistake
  // the direction correction exposed: what a piece costs where you buy and what
  // it realises where you sell are different questions, and one number cannot
  // answer both.
  const exitObs = observations.filter((o) => o.source_role === 'exit' || o.source_role === 'both');
  const acquisitionObs = observations.filter((o) => o.source_role === 'acquisition');

  const exitSummary = summariseItem(exitObs);
  const acquisitionSummary = summariseItem(acquisitionObs);
  const summary = summariseItem(observations);

  const routes = await listRoutes();
  // Score the cheapest live acquisition listing — the one you would actually buy.
  const buyCandidates = observations
    .filter((o) => o.is_head && o.status === 'active' && o.source_role === 'acquisition' && o.price_base != null)
    .sort((a, b) => Number(a.price_base) - Number(b.price_base));
  const scored = buyCandidates.length
    ? scoreAllRoutes({ listing: buyCandidates[0], observations, routes })
    : null;
  const roots = chainRoots(observations);

  const points = observations
    .filter((o) => o.price_base != null)
    .map((o) => ({
      id: o.id,
      date: o.date_seen,
      value: Number(o.price_base),
      evidence: o.evidence as 'confirmed_sale' | 'active_ask' | 'inferred_disappearance',
      tier: o.condition_tier,
      source: o.source_name,
      chainId: roots.get(o.id) ?? o.id,
      role: (o.source_role ?? 'exit') as 'exit' | 'acquisition' | 'both',
    }));

  const current = observations.filter((o) => o.is_head && o.status === 'active');
  // The reference line is the exit-market median: it is the number a buy is
  // judged against, and the pooled median is not that number.
  const bestTier = exitSummary.tiers.find((t) => t.sufficient) ?? null;
  const image = observations.find((o) => o.image_url)?.image_url ?? null;

  return (
    <div className="space-y-7">
      <Link href="/items" className="text-sm text-muted hover:text-fg">
        ← All items
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{item.canonical_name}</h1>
          <p className="mt-1 text-sm text-muted">
            {item.subline_name ?? 'Sub-line unresolved'}
            {item.ad_year
              ? ` · ${item.ad_year_basis === 'ad_tag' ? 'AD' : ''}${item.ad_year}`
              : item.ad_year_status === 'pre_ad_era'
                ? ' · pre-AD era'
                : ' · year unknown'}
            {/* Same number, different kind of claim. An AD tag is printed on the
                garment; a season code is what a seller wrote about when they
                think it was made; a typed year is what somebody decided after
                looking at the piece. All three pool together, and which one this
                is should not have to be inferred from the item's name. */}
            {item.ad_year && item.ad_year_basis !== 'ad_tag' ? (
              <span className="ml-1 text-[11px] uppercase tracking-wide text-accent">
                {item.ad_year_basis === 'season' ? 'from a season code' : 'set by hand'}
              </span>
            ) : null}
            {' · '}
            {item.listing_count} listing{item.listing_count === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-1.5">
        </div>
        {image ? (
          <div className="flex flex-wrap gap-1.5">
            {reverseImageLinks(image).map((l) => (
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
        ) : null}
      </header>

      <section className="rounded-xl border border-edge bg-ink p-4">
        <h2 className="text-sm font-semibold">Evidence</h2>
        <p className="mt-1 text-sm text-muted">
          {summary.totals.observations} observation
          {summary.totals.observations === 1 ? '' : 's'} — {summary.totals.evidenceSummary}.{' '}
          <span className="text-fg">
            {exitSummary.totals.observations} from exit venues, {acquisitionSummary.totals.observations} from
            acquisition venues.
          </span>
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Price history</h2>
        <PriceHistoryChart points={points} median={bestTier?.median ?? null} />
      </section>

      {scored ? (
        <section>
          <h2 className="mb-1 text-base font-semibold">Score</h2>
          <ScoreBreakdown score={scored.best} />
        </section>
      ) : null}

      <section>
        <h2 className="mb-1 text-base font-semibold">Exit-market comps</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted">
          {exitSummary.totals.observations} observation
          {exitSummary.totals.observations === 1 ? '' : 's'} — drives the resale estimate.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...exitSummary.tiers, exitSummary.untiered]
            .filter((t): t is TierSummary => t != null)
            .map((t) => (
              <div key={t.tier ?? 'untiered'} className="rounded-xl border border-edge bg-ink p-4">
                <h3 className="text-sm font-medium">
                  {t.tier ? t.tier.replace(/_/g, ' ') : 'No condition recorded'}
                </h3>
                {t.sufficient && t.median != null ? (
                  <>
                    <p className="mt-2 text-lg font-semibold">{eur(t.median)}</p>
                    <p className="text-xs text-muted">weighted median</p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-warn">insufficient data</p>
                )}
                <dl className="mt-3 space-y-1 text-xs text-muted">
                  <div>
                    {t.count} comp{t.count === 1 ? '' : 's'}
                    {!t.sufficient ? ` · need ${MIN_COMPS}` : ''}
                  </div>
                  {t.sufficient ? (
                    <>
                      <div>
                        confidence {t.confidence} (volume {t.factors.volume} · quality{' '}
                        {t.factors.quality} · recency {t.factors.recency})
                      </div>
                      <div>
                        newest observation {t.newestAgeDays}d old, oldest {t.oldestAgeDays}d
                      </div>
                    </>
                  ) : null}
                  {t.lowestActive != null ? <div>lowest active {eur(t.lowestActive)}</div> : null}
                </dl>
              </div>
            ))}
        </div>
        {exitSummary.totals.observations === 0 ? (
          <p className="border border-dashed border-edge-strong p-6 text-center text-sm text-warn">
            No exit-market comps yet, so no resale estimate is possible. Add a Grailed or Vestiaire
            comp for this piece to make it scoreable.
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold">Acquisition-side prices</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted">
          {acquisitionSummary.totals.observations} observation
          {acquisitionSummary.totals.observations === 1 ? '' : 's'} — excluded from the estimate.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...acquisitionSummary.tiers, acquisitionSummary.untiered]
            .filter((t): t is TierSummary => t != null)
            .map((t) => (
              <div key={`acq-${t.tier ?? 'untiered'}`} className="border border-edge-strong bg-ink p-4">
                <h3 className="text-sm font-medium">
                  {t.tier ? t.tier.replace(/_/g, ' ') : 'No condition recorded'}
                </h3>
                <p className="mt-2 text-lg font-semibold">
                  {t.lowestActive != null ? eur(t.lowestActive) : '—'}
                </p>
                <p className="text-xs text-muted">lowest active</p>
                <p className="mt-2 text-xs text-muted">
                  {t.count} listing{t.count === 1 ? '' : 's'}
                </p>
              </div>
            ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">
          Current listings ({current.length})
        </h2>
        {current.length === 0 ? (
          <p className="text-sm text-muted">Nothing currently active for this item.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-edge">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="p-2 font-medium">Source</th>
                  <th className="p-2 font-medium">Title</th>
                  <th className="p-2 font-medium">Size</th>
                  <th className="p-2 font-medium">Condition</th>
                  <th className="p-2 font-medium">Price</th>
                  <th className="p-2 font-medium">Base</th>
                  <th className="p-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {current.map((o) => (
                  <tr key={o.id} className="border-t border-edge">
                    <td className="p-2 text-muted">{o.source_name}</td>
                    <td className="p-2">
                      <Link href={`/listing/${o.id}`} className="hover:text-accent">
                        {o.title_raw}
                      </Link>
                    </td>
                    <td className="p-2 text-muted">{o.size_raw ?? '—'}</td>
                    <td className="p-2 text-muted">{o.condition_tier?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="p-2">
                      {o.price} {o.currency}
                    </td>
                    <td className="p-2 text-muted">
                      {o.price_base != null ? eur(Number(o.price_base)) : '—'}
                    </td>
                    <td className="p-2">
                      {o.url ? (
                        <a
                          href={o.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-muted hover:text-accent"
                        >
                          open
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
