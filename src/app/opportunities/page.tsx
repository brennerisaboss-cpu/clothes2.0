import Link from 'next/link';
import {
  scoringCandidates, observationsForItems, listRoutes, calibrationRatios, pipelineCensus,
  marketSpans, SCORING_CANDIDATE_LIMIT,
} from '@/lib/queries';
import { firstBlocker, showAsks } from '@/lib/diagnose.mjs';
import {
  spansFrom, survivalCurve, chanceGoneWithin, urgency, ageInDays,
} from '@/lib/survival.mjs';
import { scoreAllRoutes } from '@/lib/scoring.mjs';
import { MIN_COMPS } from '@/lib/priceHistory.mjs';
import { compareByScore, isFlagged, SORT_LABELS, type SortKey } from '@/lib/scoreBoard';
import Thumb from '@/components/Thumb';
import { PageHead } from '@/components/Plate';

export const dynamic = 'force-dynamic';

const eur = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(n);

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const sort = ((Array.isArray(sp.sort) ? sp.sort[0] : sp.sort) ?? 'profit') as SortKey;
  const showUnscored = (Array.isArray(sp.unscored) ? sp.unscored[0] : sp.unscored) === '1';
  // A margin computed from asking prices is arithmetic on two hopes. It is
  // worth seeing — for thin archive pieces it is often all there is — but not
  // worth mistaking for a checked number, so it is held back while there is
  // anything better to show. The decision is in diagnose.mjs: it is a default,
  // not a rule, because on a paste-driven install nothing better ever arrives.
  const asksRequested = (Array.isArray(sp.asks) ? sp.asks[0] : sp.asks) === '1';
  const salesOnlyRequested = (Array.isArray(sp.asks) ? sp.asks[0] : sp.asks) === '0';

  const [candidates, routes, calibration, census, spanRows] = await Promise.all([
    scoringCandidates(),
    listRoutes(),
    // What pieces of each brand actually fetched on each venue. Read once for
    // the page; below three recorded sales it corrects nothing.
    calibrationRatios().catch(() => new Map()),
    // The counts behind an empty screen. Cheap, and the only thing that can
    // tell the difference between the five ways of having nothing to show.
    pipelineCensus().catch(() => null),
    // How long listings last on each venue. A margin says what a piece is
    // worth; this says whether it will still be there when you decide.
    marketSpans().catch(() => new Map()),
  ]);

  // One curve per source, not per listing: survival is a property of a venue.
  const curves = new Map(
    [...spanRows].map(([sourceId, rows]) => [sourceId, survivalCurve(spansFrom(rows))]),
  );
  const observations = await observationsForItems([...new Set(candidates.map((c) => c.item_id))]);

  const scored = candidates.map((listing) => ({
    listing,
    ...scoreAllRoutes({
      listing,
      observations: observations.get(listing.item_id) ?? [],
      routes,
      calibration,
      brandId: listing.brand_id ?? null,
    }),
  }));

  // Attach each row's survival chance to its score, so the comparator can rank
  // on it without recomputing a curve per comparison.
  for (const s of scored) {
    // Age from the first sighting, not from date_seen — which a poll bumps to
    // now() on every re-confirmation, so an automated listing that has been up
    // for months reads as minutes old and the curve is asked the wrong
    // question about it.
    const age = ageInDays(s.listing.first_seen_at);
    const chance = age == null ? null : chanceGoneWithin(curves.get(s.listing.source_id) ?? null, age);
    (s.best as { goneWithinWeek?: number | null }).goneWithinWeek = chance;
  }

  const allScored = scored.filter((s) => s.best.scored);
  // Anything somebody acted on — a recorded sale, or a piece taken off the
  // market at a price. Held back: numbers nobody has agreed to at all.
  const backedBySales = allScored.filter((s) => s.best.evidenceBasis !== 'asks_only');
  const asksOnly = allScored.filter((s) => s.best.evidenceBasis === 'asks_only');
  // A loss is not an opportunity.
  //
  // Every scored row was listed, losses included, and a negative one merely
  // got red text — on the screen whose entire job is "what is worth buying".
  // Worth keeping reachable, because a near miss says how far off a piece is
  // and whether another route would carry it, but not worth showing by
  // default: they are noise on the list you act from, and they are computed
  // through route costs nobody has confirmed yet, so a small negative number
  // is as likely to be the seeded duty rate as the piece.
  const showLosses = (Array.isArray(sp.losses) ? sp.losses[0] : sp.losses) === '1';

  const showAsksOnly = salesOnlyRequested
    ? false
    : showAsks({ requested: asksRequested, salesBacked: backedBySales.length, asksOnly: asksOnly.length });
  const visible = showAsksOnly ? allScored : backedBySales;
  const losing = visible.filter((s) => (s.best.profit ?? 0) <= 0);
  const withScore = showLosses ? visible : visible.filter((s) => (s.best.profit ?? 0) > 0);
  const withoutScore = scored.filter((s) => !s.best.scored);

  // Why the screen is empty, if it is. Everything before this point is what
  // the page can compute about itself; the census supplies what it cannot see,
  // which is the shape of the data that never reached it.
  const blocker = withScore.length === 0 && census
    ? firstBlocker({
        ...census,
        scored: allScored.length,
        salesBacked: backedBySales.length,
        asksOnly: asksOnly.length,
        profitable: allScored.filter((s) => (s.best.profit ?? 0) > 0).length,
      })
    : null;

  // The toggle has three positions on the wire and two on screen: absent means
  // "decide for me", which is what makes the fallback possible. Turning the
  // ask-based rows OFF therefore has to say so explicitly — dropping the
  // parameter would just let the fallback switch them straight back on.
  const asksParam = showAsksOnly ? '&asks=1' : '&asks=0';
  const lossParam = showLosses ? '&losses=1' : '';

  // Same comparator the grid uses, so the two views can never disagree about
  // what "highest profit" means.
  const scoreMap = new Map(scored.map((s) => [s.listing.id, { best: s.best, routeCount: s.all.length }]));
  withScore.sort((a, b) => compareByScore(sort, scoreMap)(a.listing, b.listing));

  const sorts: SortKey[] = ['profit', 'urgent', 'spread', 'discount', 'confidence', 'flagged', 'newest'];
  const flaggedCount = withScore.filter((s) => isFlagged(s.best)).length;
  const provisionalCount = withScore.filter((s) => s.best.provisional).length;

  // Was this ranking computed over everything, or over a slice of it?
  //
  // Candidates come back newest first under a cap, so once a catalogue outgrows
  // the cap the best opportunity in the database can be absent from the screen
  // whose job is to name it — and a ranked list gives no sign that it was cut.
  // The census counts what the cap could not reach, so the page can say so.
  const unranked = census ? Math.max(0, census.acquisitionActive - candidates.length) : 0;

  return (
    <div className="space-y-6">
      <div>
        <PageHead
          title="Opportunities"
          motif="stipple"
          annot={
            provisionalCount ? (
              <>
                <span className="not-italic font-semibold uppercase tracking-wide text-accent">
                  {provisionalCount} provisional
                </span>{' '}
                — under {MIN_COMPS} exit comps.
              </>
            ) : null
          }
        />
      </div>

      {/* An index line, not a button bar.
          A printed contents page separates its entries with space and a rule
          and marks the current one — it does not put a box round each. Ten
          bordered chips was the second most app-like thing on the page after
          the nav, and like the nav they carried nothing the words did not. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-y border-edge py-2">
        <span className="label mb-0">Sort</span>
        {sorts.map((key) => (
          <Link
            key={key}
            href={`/opportunities?sort=${key}${showUnscored ? '&unscored=1' : ''}${asksParam}${lossParam}`}
            className={`text-[12px] uppercase tracking-[0.08em] transition-colors hover:text-accent ${
              sort === key ? 'border-b-2 border-fg pb-0.5 font-semibold' : 'text-muted'
            }`}
          >
            {SORT_LABELS[key]}
            {key === 'flagged' && flaggedCount ? (
              <sup className="ml-0.5 text-[10px] text-accent">{flaggedCount}</sup>
            ) : null}
          </Link>
        ))}

        <span className="ml-auto flex items-baseline gap-x-4">
          <Link
            href={`/opportunities?sort=${sort}${showUnscored ? '' : '&unscored=1'}${asksParam}${lossParam}`}
            className="text-[12px] uppercase tracking-[0.08em] text-muted transition-colors hover:text-accent"
          >
            {showUnscored ? 'Hide unscored' : 'Unscored'}
            {!showUnscored && withoutScore.length ? (
              <sup className="ml-0.5 text-[10px]">{withoutScore.length}</sup>
            ) : null}
          </Link>
          <Link
            href={`/opportunities?sort=${sort}${showUnscored ? '&unscored=1' : ''}${asksParam}${showLosses ? '' : '&losses=1'}`}
            className={`text-[12px] uppercase tracking-[0.08em] transition-colors hover:text-accent ${
              showLosses ? 'border-b-2 border-fg pb-0.5 font-semibold' : 'text-muted'
            }`}
          >
            {showLosses ? 'Hide losses' : 'Losses'}
            {!showLosses && losing.length ? (
              <sup className="ml-0.5 text-[10px]">{losing.length}</sup>
            ) : null}
          </Link>
          <Link
            href={`/opportunities?sort=${sort}${showUnscored ? '&unscored=1' : ''}&asks=${showAsksOnly ? '0' : '1'}${lossParam}`}
            className={`text-[12px] uppercase tracking-[0.08em] transition-colors hover:text-accent ${
              showAsksOnly ? 'border-b-2 border-accent pb-0.5 font-semibold text-accent' : 'text-muted'
            }`}
          >
            {showAsksOnly ? 'Sales-backed only' : 'Ask-based'}
            {!showAsksOnly && asksOnly.length ? (
              <sup className="ml-0.5 text-[10px]">{asksOnly.length}</sup>
            ) : null}
          </Link>
        </span>
      </div>

      {unranked > 0 ? (
        <p className="border-l-2 border-accent pl-3 text-[13px] leading-snug">
          <span className="font-semibold uppercase tracking-wide text-accent">
            Ranked over {candidates.length} of {census!.acquisitionActive}
          </span>{' '}
          buyable listings — the {unranked} least recently seen were not scored, so a
          better one may be among them. Narrow the grid by source or sub-line, or raise{' '}
          <code className="font-mono">SCORING_CANDIDATE_LIMIT</code> ({SCORING_CANDIDATE_LIMIT}).
        </p>
      ) : null}

      {withScore.length === 0 ? (
        /* The empty state used to guess, and it guessed the same thing every
           time: "no venue you can sell on has enough comps". That is one of
           five ways this screen is empty, and it was the wrong one for the
           commonest case by far — a collection pasted entirely from Grailed
           and Vestiaire, which are exit venues, so every row is a comp and
           none is a candidate. The counts now decide which sentence appears. */
        <div className="border border-dashed border-edge-strong p-10 text-center">
          {blocker ? (
            <>
              <p className="mx-auto max-w-[54ch] text-sm text-muted">{blocker.what}</p>
              <p className="mx-auto mt-3 max-w-[54ch] text-sm">
                {blocker.href ? (
                  <Link href={blocker.href} className="text-accent underline underline-offset-2">
                    {blocker.fix}
                  </Link>
                ) : (
                  <code className="not-italic text-fg">{blocker.fix}</code>
                )}
              </p>
              <p className="mt-4 text-[11px] text-muted">
                <code className="not-italic">npm run status</code> walks the same chain from the
                command line and prints every stage, not only the first one blocking.
              </p>
            </>
          ) : (
            <p className="mx-auto max-w-[54ch] text-sm text-muted">
              Nothing scoreable yet. A score needs at least {MIN_COMPS} comps from a venue you can
              sell on, in the same condition tier as the piece you would buy.
            </p>
          )}
        </div>
      ) : (
        <ul>
          {withScore.map(({ listing, best, all }) => {
            const positive = (best.profit ?? 0) > 0;
            const highFlag = best.flags.some((f) => f.severity === 'high');
            return (
              <li
                key={listing.id}
                // The accent is a marginal rule, not a box.
                //
                // Painting a whole card vermillion for "steep discount" meant
                // every card was vermillion — a steep discount is precisely
                // what this screen exists to find — so the colour stopped
                // carrying information and the page read as one alarm. It is
                // now a single stroke down the margin, the way a printer marks
                // a line for attention without reprinting it in red, and the
                // box itself says something quieter: a heavy rule for a
                // positive margin, a hairline for the rest, dashed while the
                // estimate is provisional.
                className={`ruled-row flex flex-wrap items-stretch gap-3 p-3${
                  best.provisional ? ' is-provisional' : ''
                }${positive ? ' is-positive' : ''}${highFlag ? ' is-flagged' : ''}`}
              >
                <Link href={`/listing/${listing.id}`} className="h-24 w-20 shrink-0 overflow-hidden">
                  <Thumb src={listing.image_url} className="h-full w-full" />
                </Link>

                <div className="min-w-[220px] flex-1">
                  <Link href={`/item/${listing.item_id}`} className="text-sm hover:underline">
                    {listing.title_raw}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {listing.subline_name ?? 'unresolved'}
                    {listing.ad_year ? ` · AD${listing.ad_year}` : ''} · {listing.source_name}
                    {listing.size_raw ? ` · ${listing.size_raw}` : ''}
                    {listing.condition_tier ? ` · ${listing.condition_tier.replace(/_/g, ' ')}` : ''}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    Buy {eur(best.price ?? 0)} → landed {eur(best.cost?.total ?? 0)} → resale{' '}
                    {eur(best.resale?.value ?? 0)} → net {eur(best.proceeds?.total ?? 0)}
                  </p>
                  {best.flags.length ? (
                    <p className="mt-1 text-[11px] leading-snug text-accent">
                      {/* High-severity flags crowd out the rest, which is right
                          for most of them — except the one saying this venue
                          only leads because nothing is known about it. That is
                          a warning about the ranking itself, so it is never
                          suppressed by a warning about the listing. */}
                      {(() => {
                        // Unconfirmed route costs are high-severity — they stop
                        // a row being actionable — but until the first route is
                        // confirmed they are on EVERY row, so letting them
                        // decide the crowding would hide every warning specific
                        // to the listing behind one that is universal.
                        const universal = (f: { kind: string }) => f.kind === 'estimated_costs';
                        const high = best.flags.filter((f) => f.severity === 'high' && !universal(f));
                        const shown = high.length ? high : best.flags.filter((f) => !universal(f));
                        // These are about whether the NUMBER can be trusted
                        // rather than about the listing, so they are never
                        // crowded out by a warning about the listing.
                        const always = best.flags.filter(
                          (f) =>
                            f.kind === 'uncalibrated_venue' ||
                            f.kind === 'other_models' ||
                            f.kind === 'off_size' ||
                            universal(f),
                        );
                        const all = [...shown, ...always.filter((f) => !shown.includes(f))];
                        return all.map((f) => f.kind.replace(/_/g, ' ')).join(' · ');
                      })()}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col justify-center gap-0.5 text-right">
                  <p className={`text-lg font-bold ${positive ? 'text-ok' : 'text-alarm'}`}>
                    {positive ? '+' : ''}
                    {eur(best.profit ?? 0)}
                  </p>
                  <p className="ink-indigo text-[11px]">
                    {best.spreadPct == null ? '—' : `${(best.spreadPct * 100).toFixed(0)}% spread`}
                  </p>
                  <p className="ink-indigo text-[11px]">
                    conf {best.confidence?.toFixed(2)} · {best.resale?.comps} comp
                    {best.resale?.comps === 1 ? '' : 's'}
                    {/* Where the comps came from, which is not always the venue
                        being sold on. Saying "via grailed" beside a figure
                        derived from other venues reads as though Grailed
                        produced it. */}
                    {best.resale?.venueScoped === false ? ' from all venues' : ''}
                    {best.resale?.borrowedComps === best.resale?.comps && (best.resale?.comps ?? 0) > 0
                      ? ', other models'
                      : ''}
                  </p>
                  {best.provisional ? (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                      provisional
                    </p>
                  ) : null}
                  <p className="text-[11px] text-muted">
                    sell via {(best.route?.exit_source as string) ?? '—'}
                    {all.length > 1 ? ` (${all.length} routes)` : ''}
                  </p>
                  {/* How long this venue's listings last, read from where
                      this one already is. Kept beside the margin and never
                      folded into it: a margin is money and this is a
                      probability, and a product of the two would read like
                      money and be sorted against real euro figures. */}
                  {(() => {
                    const curve = curves.get(listing.source_id) ?? null;
                    const age = ageInDays(listing.first_seen_at);
                    const chance = age == null ? null : chanceGoneWithin(curve, age);
                    if (chance == null) return null;
                    const { band, label } = urgency(chance);
                    return (
                      <p
                        className={`mt-1 text-[11px] ${
                          band === 'now' ? 'font-semibold text-accent' : 'text-muted'
                        }`}
                        title={label}
                      >
                        {band === 'now' ? 'going fast' : band === 'soon' ? 'moves in weeks' : 'sits'}
                        {' · '}
                        {Math.round(chance * 100)}%/wk
                      </p>
                    );
                  })()}
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-muted">
                    data {best.dataAgeDays}d old
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showUnscored && withoutScore.length ? (
        <section>
          <h2 className="mb-2 text-base font-semibold">Not scored</h2>
          <ul className="space-y-1">
            {withoutScore.map(({ listing, best }) => (
              <li key={listing.id} className="flex flex-wrap gap-x-3 border-b border-edge py-1.5 text-[12px]">
                <Link href={`/listing/${listing.id}`} className="min-w-[240px] flex-1 hover:underline">
                  {listing.title_raw}
                </Link>
                <span className="text-muted">{listing.source_name}</span>
                <span className="text-warn">{best.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
