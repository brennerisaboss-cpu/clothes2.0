import Link from 'next/link';
import { heatBoard } from '@/lib/queries';
import {
  priceMomentum, turnoverVelocity, supplyTrend, attentionTrend, heatScore, describeHeat, WEIGHTS,
} from '@/lib/heat.mjs';
import { PageHead } from '@/components/Plate';

export const dynamic = 'force-dynamic';

/**
 * The cultural-attention watchlist.
 *
 * The model, its tables, its refresh command, its server actions and its tests
 * all shipped; this screen did not, so none of it was reachable — two actions
 * were calling `revalidatePath('/heat')` on a route that returned 404.
 *
 * What it shows, and what it refuses to show, follows the module: every
 * component is separate and traceable, a component with too little data is
 * omitted rather than scored zero, and the reading says how much of itself is
 * actually standing on evidence. Heat never appears beside a profit figure and
 * never enters one — that separation is the whole reason the arbitrage number
 * can be trusted, and putting the two on one row would undo it by suggestion
 * where the code refuses to do it by arithmetic.
 */

const BANDS: Record<string, string> = {
  rising: 'text-accent',
  warm: 'text-fg',
  flat: 'text-muted',
  cooling: 'text-muted',
};

const pct = (n: number | null | undefined) =>
  n == null ? '—' : `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`;

export default async function HeatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const showQuiet = (Array.isArray(sp.quiet) ? sp.quiet[0] : sp.quiet) === '1';

  const board = await heatBoard();

  const rows = board.subjects.map((subject) => {
    const listings = board.listingsFor(subject);
    const signals = board.signalsFor(subject);

    // Exit observations only, exactly as scoring does: an acquisition price
    // answers a different question.
    const price = priceMomentum(listings);
    const turnover = turnoverVelocity(listings);
    const supply = supplyTrend(listings);
    const attention = attentionTrend(signals);
    const score = heatScore({ price, turnover, attention, supply });

    return { subject, price, turnover, supply, attention, score };
  });

  const read = rows
    .filter((r) => r.score.sufficient)
    .sort((a, b) => (b.score.score ?? 0) - (a.score.score ?? 0));
  const quiet = rows.filter((r) => !r.score.sufficient);

  // What is holding the quiet ones back, grouped. One line per reason says
  // whether the fix is `npm run heat` or simply more months of observations;
  // a hundred and fifty rows each saying "insufficient data" says neither.
  const quietReasons = new Map<string, number>();
  for (const r of quiet) {
    const why = [r.price, r.turnover, r.attention, r.supply].every((c) => !c.sufficient)
      ? 'no component has enough data yet'
      : (r.score.reason ?? 'insufficient data');
    quietReasons.set(why, (quietReasons.get(why) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <PageHead
        title="Heat"
        annot={
          <>
            Attention, read separately from price and{' '}
            <span className="font-semibold uppercase tracking-wide">never folded into it</span>. A
            profit figure is comps minus a fee stack, both measurable; this is inference from how
            much a thing is being looked at. Refresh with{' '}
            <code className="font-mono">npm run heat</code>.
          </>
        }
      />

      {board.subjects.length === 0 ? (
        <div className="border border-dashed border-edge-strong p-12 text-center text-sm text-muted">
          Nothing is being watched. <code className="font-mono">npm run seed</code> installs the
          roster, and the star on any item page adds that piece.
        </div>
      ) : read.length === 0 ? (
        <div className="border border-dashed border-edge-strong p-10 text-sm text-muted">
          <p className="mb-2 text-fg">
            {board.subjects.length} subjects watched, none with enough behind it to read yet.
          </p>
          <p>
            Every component needs history: two thirty-day windows of exit observations for price,
            three closed listings for turnover, eight points for attention. That is months of
            collecting, not a missing setting — and a reading drawn through two points is a line,
            not a trend.
          </p>
          <p className="mt-2">
            <code className="font-mono">PROBE_CONTACT=you@example.com npm run heat</code> starts the
            attention series, which is the only component that does not have to wait for the market.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-edge-strong">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="p-2 font-medium">Subject</th>
                <th className="p-2 font-medium">Reading</th>
                <th className="p-2 text-right font-medium">Exit median</th>
                <th className="p-2 text-right font-medium">On market</th>
                <th className="p-2 text-right font-medium">Attention</th>
                <th className="p-2 text-right font-medium">Supply</th>
                <th className="p-2 font-medium">Standing on</th>
              </tr>
            </thead>
            <tbody>
              {read.map(({ subject, price, turnover, supply, attention, score }) => {
                const band = describeHeat(score);
                return (
                  <tr key={subject.id} className="border-t border-edge align-top">
                    <td className="p-2">
                      {subject.item_id ? (
                        <Link href={`/item/${subject.item_id}`} className="hover:underline">
                          {subject.label}
                        </Link>
                      ) : (
                        subject.label
                      )}
                      <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">
                        {subject.subject_type}
                      </span>
                    </td>
                    <td className={`p-2 font-semibold uppercase tracking-wide ${BANDS[band] ?? ''}`}>
                      {band}
                      <span className="ml-1.5 font-mono text-[11px] font-normal text-muted tabular-nums">
                        {score.score?.toFixed(2)}
                      </span>
                    </td>
                    {/* A component with too little data is blank, never zero.
                        Zero would read as "cold", which is a claim nothing here
                        has earned. */}
                    <td className="p-2 text-right font-mono tabular-nums">
                      {price.sufficient ? pct(price.change) : <span className="text-muted">—</span>}
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums">
                      {turnover.sufficient ? `${turnover.medianDaysListed}d` : <span className="text-muted">—</span>}
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums">
                      {attention.sufficient ? pct(attention.change) : <span className="text-muted">—</span>}
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums">
                      {supply.sufficient ? pct(supply.change) : <span className="text-muted">—</span>}
                    </td>
                    <td className="p-2 text-[11px] leading-snug text-muted">
                      {/* How much of the model actually contributed. A one-legged
                          reading and a four-legged one are different claims and
                          must not look alike. */}
                      {score.componentsUsed} of {Object.keys(WEIGHTS).length} components,{' '}
                      {Math.round((score.coverage ?? 0) * 100)}% of the weight
                      {score.coverage != null && score.coverage < 0.5 ? (
                        <span className="text-accent"> — thin</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {quiet.length ? (
        <div className="border-t border-edge pt-3">
          <Link
            href={`/heat${showQuiet ? '' : '?quiet=1'}`}
            className="text-[12px] uppercase tracking-[0.08em] text-muted transition-colors hover:text-accent"
          >
            {showQuiet ? 'Hide' : 'Show'} {quiet.length} subject{quiet.length === 1 ? '' : 's'} with
            nothing to read yet
          </Link>

          {showQuiet ? (
            <>
              <ul className="mt-3 space-y-1 text-[12px] text-muted">
                {[...quietReasons]
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, n]) => (
                    <li key={reason}>
                      <span className="font-mono tabular-nums">{String(n).padStart(4)}</span>{' '}
                      {reason}
                    </li>
                  ))}
              </ul>
              <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                {quiet.map((r) => (
                  <span key={r.subject.id}>{r.subject.label}</span>
                ))}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
