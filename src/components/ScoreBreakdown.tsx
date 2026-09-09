import type { Score } from '@/lib/scoring.mjs';

const eur = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(n);

const eur2 = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 2,
  }).format(n);

/**
 * The full working, shown rather than summarised.
 *
 * Every figure is an estimate and says so. The point of showing the whole stack
 * is that the fees are the story on the Japan route — a headline profit with
 * the costs hidden is exactly the kind of number that loses money.
 */
export default function ScoreBreakdown({ score }: { score: Score }) {
  if (!score.scored) {
    return (
      <div className="border border-edge-strong bg-ink p-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-warn">Insufficient data</p>
        <p className="mt-1 text-sm text-muted">{score.reason}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          No number is shown rather than a weak one. A confident-looking score built on one or two
          comps is worse than none, because it gets acted on.
        </p>
      </div>
    );
  }

  const { cost, proceeds, resale, route } = score;
  const profit = score.profit ?? 0;
  const positive = profit > 0;
  const provisional = Boolean(score.provisional);

  return (
    <div className="space-y-4">
      {provisional ? (
        <p className="border-2 border-dashed border-accent p-3 text-[12px] leading-relaxed">
          <span className="font-semibold uppercase tracking-wide">Provisional estimate</span> —
          built on {resale!.comps} exit comp{resale!.comps === 1 ? '' : 's'}, short of the{' '}
          {3} needed for a settled figure. The numbers below are shown so the lead is not
          invisible, not because they are reliable. Add exit-market comps before acting.
        </p>
      ) : null}

      <div className={`flex flex-wrap items-baseline gap-x-6 gap-y-2 pb-3 ${provisional ? 'border-b-2 border-dashed border-accent' : 'border-b-2 border-fg'}`}>
        <div>
          <p className="label mb-0">Expected profit</p>
          <p className={`text-2xl font-bold ${provisional ? 'text-muted' : positive ? 'text-ok' : 'text-alarm'}`}>
            {positive ? '+' : ''}
            {eur(profit)}
            {provisional ? <span className="text-base"> ?</span> : null}
          </p>
        </div>
        <div>
          <p className="label mb-0">Spread</p>
          <p className={`text-2xl font-bold ${positive ? 'text-ok' : 'text-alarm'}`}>
            {score.spreadPct == null ? '—' : `${(score.spreadPct * 100).toFixed(0)}%`}
          </p>
        </div>
        <div>
          <p className="label mb-0">Confidence</p>
          <p className="text-2xl font-bold">{score.confidence?.toFixed(2)}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="label mb-0">Route</p>
          <p className="text-sm font-medium">{route?.display_name as string}</p>
        </div>
      </div>

      {score.flags.length ? (
        <ul className="space-y-1.5">
          {score.flags.map((f) => (
            <li
              key={f.kind}
              className={`border-l-4 py-1 pl-3 text-[12px] leading-snug ${
                f.severity === 'high' ? 'border-accent text-fg' : 'border-warn text-muted'
              }`}
            >
              <span className="font-semibold uppercase tracking-wide">
                {f.severity === 'high' ? 'Verify' : 'Note'}
              </span>{' '}
              — {f.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="border border-edge-strong bg-ink p-3">
          <h4 className="label">What it costs you (estimate)</h4>
          <dl className="space-y-1 text-[12px]">
            <Row k="Item price" v={eur2(cost!.breakdown.item)} />
            {cost!.breakdown.proxyFee ? <Row k="Proxy service fee" v={eur2(cost!.breakdown.proxyFee)} /> : null}
            {cost!.breakdown.domesticShip ? <Row k="Domestic shipping (JP)" v={eur2(cost!.breakdown.domesticShip)} /> : null}
            <Row k="International shipping" v={eur2(cost!.breakdown.intlShip)} />
            <Row k="Customs duty" v={eur2(cost!.breakdown.customsDuty)} />
            <Row k="Import VAT" v={eur2(cost!.breakdown.importVat)} />
            <Row k="Landed cost" v={eur2(cost!.total)} strong />
          </dl>
        </div>

        <div className="border border-edge-strong bg-ink p-3">
          <h4 className="label">What reaches you (estimate)</h4>
          <dl className="space-y-1 text-[12px]">
            <Row k="Resale estimate" v={eur2(proceeds!.breakdown.resale)} />
            <Row k="Sale commission" v={eur2(proceeds!.breakdown.saleFee)} />
            <Row k="Payment fee" v={eur2(proceeds!.breakdown.paymentFee)} />
            <Row k="Outbound shipping" v={eur2(proceeds!.breakdown.outboundShip)} />
            <Row k="Net proceeds" v={eur2(proceeds!.total)} strong />
          </dl>
        </div>
      </div>

      <div className="border border-edge-strong bg-ink p-3 text-[11px] leading-relaxed text-muted">
        <p>
          Resale estimated from{' '}
          <span className={provisional ? 'text-accent' : 'text-fg'}>
            {resale!.comps} exit-market comp{resale!.comps === 1 ? '' : 's'}
          </span>{' '}
          in the{' '}
          <span className="text-fg">{score.resale?.value != null ? '' : ''}</span>
          same condition tier —{' '}
          {resale!.counts
            ? `${resale!.counts.confirmed_sale} confirmed sale${resale!.counts.confirmed_sale === 1 ? '' : 's'}, ${resale!.counts.active_ask} asking price${resale!.counts.active_ask === 1 ? '' : 's'}, ${resale!.counts.inferred_disappearance} inferred`
            : ''}
          . Freshest comp {resale!.newestAgeDays}d old, oldest {resale!.oldestAgeDays}d.
          Acquisition price freshness {score.listingFreshness}.
        </p>
        <p className="mt-2">
          Comps come only from venues you sell on. Prices where you <em>buy</em> are excluded —
          they answer a different question, and pooling them drags the estimate toward the
          acquisition side.
        </p>
        <p className="mt-2 text-warn">
          Every figure is an estimate. Duty and VAT rates in particular are placeholders, not
          quoted rates.
        </p>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-edge pt-1 font-semibold' : ''}`}>
      <dt className={strong ? 'text-fg' : 'text-muted'}>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
