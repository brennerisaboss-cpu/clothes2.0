import Link from 'next/link';
import { listItems, type ItemSort } from '@/lib/queries';
import { MIN_COMPS } from '@/lib/priceHistory.mjs';
import { PageHead } from '@/components/Plate';

export const dynamic = 'force-dynamic';

const eur = (n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(n);

const SORTS: [ItemSort, string][] = [
  ['name', 'Name'],
  ['subline', 'Sub-line'],
  ['ad_year', 'AD year'],
  ['listings', 'Most listings'],
  ['lowest', 'Lowest price'],
  ['newest', 'Recently seen'],
];

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.sort) ? sp.sort[0] : sp.sort) ?? 'name';
  const sort = (SORTS.some(([k]) => k === raw) ? raw : 'name') as ItemSort;

  const items = await listItems(sort);

  return (
    <div className="space-y-5">
      <PageHead title="Items" motif="target" />

      <div className="flex flex-wrap items-center gap-2 border-y border-edge py-2">
        <span className="label mb-0 mr-1">Sort</span>
        {SORTS.map(([key, label]) => (
          <Link
            key={key}
            href={`/items?sort=${key}`}
            className={`px-2 py-1 text-[12px] uppercase tracking-wide ${
              sort === key ? 'bg-fg text-ink' : 'border border-edge-strong hover:bg-fg hover:text-ink'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="border border-dashed border-edge-strong p-12 text-center text-sm text-muted">
          No items yet. Matching runs when you save a listing, or from{' '}
          <Link href="/unresolved" className="underline hover:text-accent">
            Unresolved
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-x-auto border border-edge-strong">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="p-2 font-medium">Item</th>
                <th className="p-2 font-medium">Sub-line</th>
                <th className="p-2 font-medium">AD year</th>
                <th className="p-2 font-medium">Listings</th>
                <th className="p-2 font-medium">Exit comps</th>
                <th className="p-2 font-medium">Lowest active</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-edge">
                  <td className="p-2">
                    <Link href={`/item/${i.id}`} className="hover:underline">
                      {i.canonical_name}
                    </Link>
                  </td>
                  <td className="p-2 text-muted">{i.subline_name ?? '—'}</td>
                  <td className="p-2 text-muted">
                    {i.ad_year ?? (i.ad_year_status === 'pre_ad_era' ? 'pre-AD' : '—')}
                    {/* A year off a season code is the same number as one off an
                        AD tag and not the same kind of claim: one is printed on
                        the garment, the other is what a seller wrote about when
                        they think it was made. Marked, so the inference is
                        visible on the screen that pools on it. */}
                    {i.ad_year_basis === 'season' ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-accent">
                        season
                      </span>
                    ) : null}
                  </td>
                  <td className="p-2 text-muted">{i.listing_count}</td>
                  <td className="p-2">
                    {/* Exit comps are what makes an item scoreable at all, so the
                        shortfall is shown here rather than only on the item page. */}
                    <span className={i.exit_comps >= MIN_COMPS ? 'text-muted' : 'text-accent'}>
                      {i.exit_comps}
                      {i.exit_comps < MIN_COMPS ? ` / ${MIN_COMPS}` : ''}
                    </span>
                  </td>
                  <td className="p-2 text-muted">
                    {i.lowest_active != null ? eur(Number(i.lowest_active)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
