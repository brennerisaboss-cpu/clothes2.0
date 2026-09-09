import Link from 'next/link';
import { query } from '@/lib/db';

/**
 * What to do when there is nothing here.
 *
 * The old empty state said the manual tier was the main input and offered a
 * link to type a listing in by hand. That was true of the first version and is
 * now the opposite of the point: entering listings by hand is the work this
 * exists to remove.
 *
 * So it names the routes that actually pull data, and — more usefully — says
 * which of them are already set up, because "nothing here" has several very
 * different causes and they need different fixes. A configured source that has
 * never polled is a different problem from no sources at all.
 */
export default async function NoData() {
  let feeds: { id: string; display_name: string; polled: boolean }[] = [];
  try {
    feeds = await query(
      `select s.id, s.display_name,
              exists (select 1 from poll_runs p where p.source_id = s.id and p.ok) as polled
         from sources s where s.tier = 'feed' order by s.id`,
    );
  } catch {
    return null; // No database; the setup path must stay reachable.
  }

  const configured = new Set(feeds.map((f) => f.id));
  const routes = [
    {
      id: 'ebay',
      name: 'eBay',
      what: 'the exit venue — without one, nothing can be valued',
      how: 'npm run add-ebay',
      needs: 'a free key from developer.ebay.com',
      done: configured.has('ebay'),
    },
    {
      id: 'yahoo_jp',
      name: 'Yahoo! Shopping Japan',
      what: 'Japanese secondhand, used goods only',
      how: 'npm run add-yahoo',
      needs: 'a free application id from e.developer.yahoo.co.jp',
      done: configured.has('yahoo_jp'),
    },
    {
      id: 'feed',
      name: 'The RealReal, Vestiaire',
      what: 'their whole catalogue, published for ingestion',
      how: 'npm run add-feed -- --id therealreal --url-env TRR_FEED_URL --currency USD',
      needs: 'joining their affiliate programme for the feed url',
      done: feeds.some((f) => !['ebay', 'yahoo_jp'].includes(f.id) && f.id.includes('feed')),
    },
    {
      id: 'shops',
      name: 'Independent shops',
      what: 'archive dealers with public product feeds',
      how: 'npm run discover',
      needs: 'nothing',
      done: feeds.some((f) => !['ebay', 'yahoo_jp'].includes(f.id) && !f.id.includes('feed')),
    },
  ];

  const silent = feeds.filter((f) => !f.polled);

  return (
    <div className="border border-dashed border-edge-strong p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.1em]">No listings yet</p>
      <p className="annot mt-1 text-[13px] text-muted">
        Two ways in, and the first one works right now on any site.
      </p>

      {/* Listed above the automated sources, not below them. The venues this
          person actually buys from publish no feed, so the route that works
          for those must not sit underneath four that need credentials. */}
      <div className="mt-4 border-l-4 border-fg bg-panel px-4 py-3">
        <p className="text-sm font-semibold">
          <Link href="/add" className="underline hover:text-accent">Paste a page</Link>
          {' '}— The RealReal, Grailed, Vestiaire, anything
        </p>
        <p className="annot mt-0.5 text-[13px] text-muted">
          Open a search result, select all, copy, paste. A whole page arrives as drafts,
          each with its picture and a link back to the listing. No key, no waiting.
        </p>
      </div>

      <p className="mt-5 text-[11px] uppercase tracking-[0.1em] text-muted">
        Or collect on a schedule
      </p>

      <ul className="mt-5 space-y-3">
        {routes.map((r) => (
          <li key={r.id} className="flex gap-3 border-t border-edge pt-3">
            <span
              className={`mt-0.5 shrink-0 text-[11px] font-semibold uppercase tracking-wide ${
                r.done ? 'text-ok' : 'text-muted/60'
              }`}
            >
              {r.done ? 'set up' : 'not yet'}
            </span>
            <div className="min-w-0">
              <p className="text-sm">
                {r.name} <span className="text-muted">— {r.what}</span>
              </p>
              <code className="mt-0.5 block break-all text-[11px] text-fg">{r.how}</code>
              {!r.done && r.needs !== 'nothing' ? (
                <p className="annot text-[11px] text-muted">needs {r.needs}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {silent.length ? (
        <p className="mt-5 border-t border-edge pt-3 text-[12px] text-warn">
          {silent.length} source{silent.length === 1 ? '' : 's'} configured but never polled
          successfully — <Link href="/sources" className="underline">see why</Link>. Run{' '}
          <code className="text-fg">npm run poll</code>.
        </p>
      ) : null}
    </div>
  );
}
