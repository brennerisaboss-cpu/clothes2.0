import Link from 'next/link';
import NoData from '@/components/NoData';
import Card, { type CardData } from '@/components/Card';
import Filters from '@/components/Filters';
import { listCards, countCards, facets, LISTING_CARD_LIMIT, type GridFilters } from '@/lib/queries';
import { scoreListings, compareByScore, isFlagged, type SortKey } from '@/lib/scoreBoard';
import { PageHead } from '@/components/Plate';

export const dynamic = 'force-dynamic';

function num(v: string | undefined) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default async function GridPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;

  const sort = (get('sort') ?? 'newest') as SortKey;
  const showGone = get('gone') === '1';

  const filters: GridFilters = {
    subline: get('subline'),
    source: get('source'),
    conditionTier: get('condition'),
    sizeRegion: get('region'),
    minPrice: num(get('min')),
    maxPrice: num(get('max')),
    freshness: get('freshness') as GridFilters['freshness'],
    // Sold and out-of-stock pieces are hidden unless asked for. They are still
    // in the table and still count as comps — a piece that disappeared at a
    // price is evidence of what it moves for — but they are not things to buy.
    includeGone: showGone,
    // Ordering is applied in memory below, because the score-based sorts are
    // not expressible in SQL — they depend on comps, routes and the fee stack.
    sort: 'newest',
  };

  // The count runs the same filter as the rows, so "showing 200 of 4,000" can
  // never describe a different set from the one on screen.
  const [cards, matching, f] = await Promise.all([
    listCards(filters),
    countCards(filters),
    facets(),
  ]);
  const scores = await scoreListings(cards);

  const ordered = [...cards].sort(compareByScore(sort, scores));
  // Sorting happens in memory over what came back, so a cap that bit means the
  // ranking is over a slice — and the sort controls above offer to rank by
  // profit, which reads as a claim about everything.
  const unshown = Math.max(0, matching - cards.length);
  const flaggedCount = cards.filter((c) => isFlagged(scores.get(c.id)?.best)).length;
  const scoredCount = [...scores.values()].filter((s) => s.best.scored).length;

  return (
    <div className="space-y-5">
      <PageHead
        title="Listings"
        right={
          <Link href="/add" className="btn btn-primary">
            Add listing
          </Link>
        }
        annot={
          <>
            {ordered.length} shown{unshown > 0 ? ` of ${matching} matching` : ''} ·{' '}
            {f.counts?.total ?? 0} tracked · {scoredCount} scored
            {' · '}
            <Link
              href={showGone ? '/' : '/?gone=1'}
              className="text-muted underline hover:text-accent"
            >
              {showGone ? 'hide sold & gone' : 'show sold & gone'}
            </Link>
            {flaggedCount > 0 ? (
              <>
                {' · '}
                <Link href="/?sort=flagged" className="text-accent hover:underline">
                  {flaggedCount} flagged
                </Link>
              </>
            ) : null}
            {Number(f.counts?.unresolved ?? 0) > 0 ? (
              <>
                {' · '}
                <Link href="/unresolved" className="text-warn hover:underline">
                  {f.counts.unresolved} unresolved
                </Link>
              </>
            ) : null}
            {Number(f.counts?.due ?? 0) > 0 ? (
              <>
                {' · '}
                <Link href="/verify" className="text-warn hover:underline">
                  {f.counts.due} due re-check
                </Link>
              </>
            ) : null}
          </>
        }
      />

      <Filters facets={f} />

      {unshown > 0 ? (
        <p className="border-l-2 border-accent pl-3 text-[13px] leading-snug">
          <span className="font-semibold uppercase tracking-wide text-accent">
            Showing the {cards.length} most recent
          </span>{' '}
          of {matching} matching listings, so this ranking is over a slice rather than over
          everything. Narrow it with the filters above — by sub-line, source or price — and the
          sort will mean what it says.
        </p>
      ) : null}

      {ordered.length === 0 ? (
        <NoData />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {ordered.map((c) => (
            <Card
              key={c.id}
              card={c as unknown as CardData}
              score={scores.get(c.id)?.best}
            />
          ))}
        </div>
      )}
    </div>
  );
}
