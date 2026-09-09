import Link from 'next/link';
import { listAlertRules, listAlerts, latencyStats } from '@/lib/queries';
import { formatLatency } from '@/lib/alerting.mjs';
import { PageHead, SectionHead } from '@/components/Plate';

export const dynamic = 'force-dynamic';

const eur = (n: number | null) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'EUR',
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: 0,
      }).format(Number(n));

const when = (d: Date | null) =>
  d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—';

export default async function AlertsPage() {
  const [rules, alerts, latency] = await Promise.all([
    listAlertRules(),
    listAlerts(40),
    latencyStats(),
  ]);

  const undelivered = alerts.filter((a) => !a.delivery_ok).length;

  return (
    <div className="space-y-8">
      <PageHead title="Alerts" motif="star" />

      <section>
        <SectionHead title="Latency" no="I" />
        {latency.length === 0 ? (
          <p className="border border-dashed border-edge-strong p-6 text-center text-sm text-muted">
            No delivered alerts yet, so there is nothing to measure.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {latency.map((l) => (
              <div key={l.basis} className="border border-edge-strong bg-ink p-4">
                <h3 className="text-sm font-medium">Measured from {l.basis}</h3>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                  <div>
                    <p className="label mb-0">Median</p>
                    <p className="text-2xl font-bold">{formatLatency(l.median_seconds)}</p>
                  </div>
                  <div>
                    <p className="label mb-0">p90</p>
                    <p className="text-2xl font-bold">{formatLatency(l.p90_seconds)}</p>
                  </div>
                  <div>
                    <p className="label mb-0">Worst</p>
                    <p className="text-2xl font-bold text-muted">{formatLatency(l.worst_seconds)}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  {l.n} delivered alert{Number(l.n) === 1 ? '' : 's'}
                  {l.basis === 'our first sighting'
                    ? ' — an optimistic figure; poll interval is not counted.'
                    : ' — the honest figure.'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHead title="Rules" no="II" />
        {rules.length === 0 ? (
          <p className="border border-dashed border-edge-strong p-6 text-center text-sm text-muted">
            No rules yet. Insert one into <code className="text-fg">alert_rules</code>; see{' '}
            <code className="text-fg">docs/phase-6-handoff.md</code>.
          </p>
        ) : (
          <div className="overflow-x-auto border border-edge-strong">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="p-2 font-medium">Rule</th>
                  <th className="p-2 font-medium">Thresholds</th>
                  <th className="p-2 font-medium">Includes</th>
                  <th className="p-2 font-medium">Delivery</th>
                  <th className="p-2 font-medium">Fired</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t border-edge align-top">
                    <td className="p-2">
                      {r.display_name}
                      {!r.enabled ? <span className="ml-1 text-warn">(disabled)</span> : null}
                    </td>
                    <td className="p-2 text-[11px] text-muted">
                      {[
                        r.min_profit_base != null ? `profit ≥ ${eur(r.min_profit_base)}` : null,
                        r.min_spread_pct != null
                          ? `spread ≥ ${(Number(r.min_spread_pct) * 100).toFixed(0)}%`
                          : null,
                        r.min_confidence != null ? `confidence ≥ ${r.min_confidence}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || <span className="text-alarm">none — will never fire</span>}
                    </td>
                    <td className="p-2 text-[11px] text-muted">
                      {r.include_provisional ? 'provisional' : 'settled only'}
                      {' · '}
                      {r.include_flagged ? 'flagged included' : 'flagged excluded'}
                    </td>
                    <td className="p-2 text-[11px] text-muted">
                      {r.channel} · {r.mode}
                      {r.channel === 'discord' && !r.webhook_url ? (
                        <span className="text-alarm"> · no webhook</span>
                      ) : null}
                    </td>
                    <td className="p-2 text-[11px] text-muted">
                      {r.fired_count}
                      {r.last_fired_at ? ` · last ${when(r.last_fired_at)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionHead title="History" no="III" />
        <p className="mb-3 max-w-3xl text-sm text-muted">
          {undelivered > 0 ? (
            <span className="text-alarm">
              {' '}
              {undelivered} undelivered; these are retried on the next run.
            </span>
          ) : null}
        </p>
        {alerts.length === 0 ? (
          <p className="border border-dashed border-edge-strong p-6 text-center text-sm text-muted">
            No alerts fired yet.
          </p>
        ) : (
          <div className="overflow-x-auto border border-edge-strong">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="p-2 font-medium">When</th>
                  <th className="p-2 font-medium">Item</th>
                  <th className="p-2 font-medium">Rule</th>
                  <th className="p-2 font-medium">Profit</th>
                  <th className="p-2 font-medium">Spread</th>
                  <th className="p-2 font-medium">Conf</th>
                  <th className="p-2 font-medium">Latency</th>
                  <th className="p-2 font-medium">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className="border-t border-edge align-top">
                    <td className="p-2 text-muted">{when(a.created_at)}</td>
                    <td className="p-2">
                      <Link href={`/listing/${a.listing_id}`} className="hover:underline">
                        {a.title_raw}
                      </Link>
                      <span className="block text-[11px] text-muted">
                        {a.source_name}
                        {a.provisional ? (
                          <span className="ml-1 font-semibold text-accent">provisional</span>
                        ) : null}
                        {a.flags?.length ? (
                          <span className="ml-1 text-accent">
                            {a.flags.map((f) => f.replace(/_/g, ' ')).join(' · ')}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="p-2 text-muted">{a.rule_name}</td>
                    <td className={`p-2 ${Number(a.profit_base) > 0 ? 'text-ok' : 'text-alarm'}`}>
                      {eur(a.profit_base)}
                    </td>
                    <td className="p-2 text-muted">
                      {a.spread_pct == null ? '—' : `${(Number(a.spread_pct) * 100).toFixed(0)}%`}
                    </td>
                    <td className="p-2 text-muted">{a.confidence ?? '—'}</td>
                    <td className="p-2 text-muted">{formatLatency(a.latency_seconds)}</td>
                    <td className="p-2">
                      {a.delivery_ok ? (
                        <span className="text-ok">sent</span>
                      ) : (
                        <>
                          <span className="text-alarm">failed</span>
                          <span className="block text-[11px] text-muted">{a.delivery_error}</span>
                        </>
                      )}
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
