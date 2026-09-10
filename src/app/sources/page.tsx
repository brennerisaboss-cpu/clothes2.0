import Link from 'next/link';
import { listSources, listRoutes, recentPollRuns } from '@/lib/queries';
import { PageHead, SectionHead } from '@/components/Plate';

export const dynamic = 'force-dynamic';

const pct = (n: number) => `${(Number(n) * 100).toFixed(1)}%`;
const eur = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(Number(n));

const ROLE_LABEL: Record<string, string> = {
  acquisition: 'Buy',
  exit: 'Sell',
  both: 'Buy / Sell',
};

export default async function SourcesPage() {
  const [sources, routes, runs] = await Promise.all([
    listSources(),
    listRoutes(),
    recentPollRuns(20),
  ]);

  const unconfirmed = routes.filter((r) => !r.costs_confirmed_at).length;

  return (
    <div className="space-y-8">
      <PageHead title="Sources & routes" motif="asterisk" />

      <section>
        <SectionHead title="Sources" no="I" />
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="p-2 font-medium">Source</th>
                <th className="p-2 font-medium">Role</th>
                <th className="p-2 font-medium">Tier</th>
                <th className="p-2 font-medium">Automation</th>
                <th className="p-2 font-medium">Active</th>
                <th className="p-2 font-medium">Last poll</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-t border-edge align-top">
                  <td className="p-2">{s.display_name}</td>
                  <td className="p-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        s.role === 'exit' ? 'bg-fg text-ink' : 'border border-fg text-fg'
                      }`}
                    >
                      {ROLE_LABEL[s.role] ?? s.role}
                    </span>
                  </td>
                  <td className="p-2 text-muted">{s.tier}</td>
                  <td className="p-2">
                    {s.automation_allowed ? (
                      <span className="text-ok">permitted</span>
                    ) : (
                      <div className="max-w-md">
                        <span className="text-warn">blocked</span>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted">
                          {s.automation_block_reason}
                        </p>
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-muted">{s.active_listings}</td>
                  <td className="p-2 text-muted">
                    {s.tier !== 'feed' ? (
                      <span className="text-muted/70">never polled</span>
                    ) : s.last_run_at ? (
                      <>
                        <span className={s.last_run_ok ? 'text-ok' : 'text-alarm'}>
                          {s.last_run_ok ? 'ok' : 'not applied'}
                        </span>
                        <span className="ml-1">
                          {new Date(s.last_run_at).toISOString().slice(0, 16).replace('T', ' ')}
                        </span>
                        {s.last_run_error ? (
                          <p className="mt-0.5 max-w-sm text-[11px] leading-snug text-warn">
                            {s.last_run_error}
                          </p>
                        ) : null}
                        {/* A source being left alone is not a source that is
                            broken, and the two used to look identical: the row
                            showed a failure and the next poll simply did not
                            happen. Saying so is the difference between "this
                            stopped working" and "it asked for room, and it has
                            it until then". */}
                        {s.cooldown_until && new Date(s.cooldown_until) > new Date() ? (
                          <p className="mt-0.5 text-[11px] leading-snug text-accent">
                            rate limited — left alone until{' '}
                            {new Date(s.cooldown_until).toISOString().slice(11, 16)}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                    {s.tier === 'feed' && s.poll_interval_minutes ? (
                      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted/70">
                        every {s.poll_interval_minutes >= 60
                          ? `${Math.round(s.poll_interval_minutes / 60)}h`
                          : `${s.poll_interval_minutes}m`}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHead
          title="Routes"
          no="II"
          annot={
            unconfirmed
              ? `${unconfirmed} of ${routes.length} still carry the seeded cost guesses.`
              : 'Costs confirmed against real orders.'
          }
        />
        <div className="grid gap-3 lg:grid-cols-2">
          {routes.map((r) => {
            const acquisitionPct = Number(r.proxy_fee_pct) + Number(r.import_vat_pct) + Number(r.customs_duty_pct);
            const exitPct = Number(r.sale_fee_pct) + Number(r.payment_fee_pct);
            const flat =
              Number(r.proxy_fee_flat) + Number(r.domestic_ship_flat) +
              Number(r.intl_ship_flat) + Number(r.outbound_ship_flat);
            return (
              <div key={r.id} className="rounded-xl border border-edge bg-ink p-4">
                <h3 className="text-sm font-medium">{r.display_name}</h3>
                {/* Whether these numbers were ever checked matters more than any
                    one of them: they are subtracted from every margin computed
                    through this route, and a guess subtracts just as confidently
                    as a quote. */}
                {r.costs_confirmed_at ? (
                  <p className="mt-1 text-[11px] text-muted">
                    Costs confirmed {new Date(r.costs_confirmed_at).toISOString().slice(0, 10)}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-warn">
                    Seeded guesses — margins through this route are flagged.{' '}
                    <code className="text-fg">npm run route-costs</code>
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted">
                  {r.acquisition_name} → {r.exit_name}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted">
                  {Number(r.proxy_fee_pct) > 0 ? (
                    <>
                      <dt>Proxy fee</dt>
                      <dd className="text-fg">
                        {pct(r.proxy_fee_pct)} + {eur(r.proxy_fee_flat)}
                      </dd>
                      <dt>Domestic ship</dt>
                      <dd className="text-fg">{eur(r.domestic_ship_flat)}</dd>
                    </>
                  ) : null}
                  <dt>International ship</dt>
                  <dd className="text-fg">{eur(r.intl_ship_flat)}</dd>
                  <dt>Import VAT</dt>
                  <dd className="text-fg">{pct(r.import_vat_pct)}</dd>
                  <dt>Customs duty</dt>
                  <dd className="text-fg">{pct(r.customs_duty_pct)}</dd>
                  <dt>Sale fee</dt>
                  <dd className="text-fg">{pct(r.sale_fee_pct)}</dd>
                  <dt>Payment fee</dt>
                  <dd className="text-fg">{pct(r.payment_fee_pct)}</dd>
                  <dt>Outbound ship</dt>
                  <dd className="text-fg">{eur(r.outbound_ship_flat)}</dd>
                </dl>
                <p className="mt-3 border-t border-edge pt-2 text-[11px] leading-relaxed text-muted">
                  {/* Acquisition and exit percentages apply to different bases — VAT and
                      duty to what you pay, commission to what you receive — so they are
                      shown separately rather than summed into one meaningless figure.
                      Phase 4 computes the real number. */}
                  <span className="text-warn">{pct(acquisitionPct)}</span> on the way in,{' '}
                  <span className="text-warn">{pct(exitPct)}</span> on the way out, plus{' '}
                  <span className="text-warn">{eur(flat)}</span> flat. These apply to different
                  bases and are not additive.
                </p>
                {r.notes ? (
                  <p className="mt-2 text-[11px] leading-snug text-muted">{r.notes}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionHead title="Poll history" no="III" />
        {runs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">
            No polls yet. Manual-tier sources are never polled; add a feed shop to{' '}
            <code className="text-fg">config/shops.json</code> and run{' '}
            <code className="text-fg">npm run poll</code>.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-edge">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="p-2 font-medium">When</th>
                  <th className="p-2 font-medium">Source</th>
                  <th className="p-2 font-medium">Result</th>
                  <th className="p-2 font-medium">Seen</th>
                  <th className="p-2 font-medium">Previously</th>
                  <th className="p-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-edge align-top">
                    <td className="p-2 text-muted">
                      {new Date(run.started_at).toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="p-2 text-muted">{run.source_id}</td>
                    <td className="p-2">
                      <span className={run.ok ? 'text-ok' : 'text-alarm'}>
                        {run.ok ? 'applied' : 'not applied'}
                      </span>
                      {run.suspect_shrink ? (
                        <span className="ml-1 text-warn">shrink</span>
                      ) : null}
                    </td>
                    <td className="p-2 text-muted">{run.results_count ?? '—'}</td>
                    <td className="p-2 text-muted">{run.previous_count ?? '—'}</td>
                    <td className="p-2 max-w-md text-[11px] leading-snug text-muted">
                      {run.error ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-muted">
        <Link href="/" className="hover:text-fg">
          ← Back to grid
        </Link>
      </p>
    </div>
  );
}
