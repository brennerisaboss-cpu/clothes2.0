'use client';

import { useRouter, useSearchParams } from 'next/navigation';

type Facets = {
  sublines: { id: string; display_name: string; monitored: boolean; ambiguous: boolean }[];
  sources: { id: string; display_name: string }[];
  tiers: { tier: string }[];
  regions: { region: string }[];
};

export default function Filters({ facets }: { facets: Facets }) {
  const router = useRouter();
  const params = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/?${next.toString()}`);
  };

  const value = (k: string) => params.get(k) ?? '';
  const active = Array.from(params.keys()).length > 0;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-edge bg-ink p-3">
      <div className="w-52">
        <label className="label">Sub-line</label>
        <select className="field" value={value('subline')} onChange={(e) => setParam('subline', e.target.value)}>
          <option value="">All</option>
          {facets.sublines.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
              {!s.monitored ? ' (not monitored)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="w-40">
        <label className="label">Source</label>
        <select className="field" value={value('source')} onChange={(e) => setParam('source', e.target.value)}>
          <option value="">All</option>
          {facets.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
            </option>
          ))}
        </select>
      </div>

      <div className="w-36">
        <label className="label">Condition</label>
        <select className="field" value={value('condition')} onChange={(e) => setParam('condition', e.target.value)}>
          <option value="">All</option>
          {facets.tiers.map((t) => (
            <option key={t.tier} value={t.tier}>
              {t.tier.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="w-28">
        <label className="label">Size region</label>
        <select className="field" value={value('region')} onChange={(e) => setParam('region', e.target.value)}>
          <option value="">All</option>
          {facets.regions.map((r) => (
            <option key={r.region} value={r.region}>
              {r.region}
            </option>
          ))}
        </select>
      </div>

      <div className="w-24">
        <label className="label">Min</label>
        <input
          className="field"
          inputMode="decimal"
          defaultValue={value('min')}
          onBlur={(e) => setParam('min', e.target.value)}
        />
      </div>
      <div className="w-24">
        <label className="label">Max</label>
        <input
          className="field"
          inputMode="decimal"
          defaultValue={value('max')}
          onBlur={(e) => setParam('max', e.target.value)}
        />
      </div>

      <div className="w-36">
        <label className="label">Freshness</label>
        <select className="field" value={value('freshness')} onChange={(e) => setParam('freshness', e.target.value)}>
          <option value="">Any</option>
          <option value="fresh">Fresh</option>
          <option value="due">Due re-check</option>
          <option value="stale">Stale</option>
        </select>
      </div>

      <div className="w-52">
        <label className="label">Sort</label>
        <select className="field" value={value('sort')} onChange={(e) => setParam('sort', e.target.value)}>
          <optgroup label="Score">
            <option value="profit">Highest profit</option>
            <option value="spread">Largest spread</option>
            <option value="discount">Largest discount</option>
            <option value="confidence">Highest confidence</option>
            <option value="flagged">Flagged for review</option>
          </optgroup>
          <optgroup label="Listing">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="stalest">Least recently verified</option>
          </optgroup>
        </select>
      </div>

      {active ? (
        <button className="btn ml-auto" onClick={() => router.push('/')}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
