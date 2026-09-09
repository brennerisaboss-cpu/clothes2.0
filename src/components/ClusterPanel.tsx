'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { resolveCluster } from '@/app/actions';

type Subline = { id: string; display_name: string; monitored: boolean; ambiguous: boolean };

export type Cluster = {
  members: { id: string; title_raw: string; source_name: string; price: number; currency: string }[];
  shared: {
    brandId: string | null;
    sublineId: string | null;
    adYear: string | null;
    type: string | null;
    material: string | null;
    model: string | null;
  };
  assumptions: string[];
  agreements: string[];
};

/**
 * A group of listings that look like each other, made into one item at once.
 *
 * This is the case the suggestion engine cannot reach: it proposes items that
 * already exist, and a fresh paste has none — two rows of one unnamed coat have
 * nothing to be proposed against, so they sit here forever, pooling with
 * nothing and unable to be scored.
 *
 * What it does NOT do is choose the sub-line. None of these listings names one,
 * and it decides which comp pool the piece joins; a wrong one corrupts two
 * pools at once. So the group makes it one decision instead of four rather than
 * making it for you.
 */
export default function ClusterPanel({
  cluster,
  sublines,
}: {
  cluster: Cluster;
  sublines: Subline[];
}) {
  const [sublineId, setSublineId] = useState(cluster.shared.sublineId ?? '');
  const [adYear, setAdYear] = useState(cluster.shared.adYear ?? '');
  const [done, setDone] = useState<{ itemId: string; linked: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="border border-ok p-3 text-sm">
        <span className="text-ok">
          {done.linked} listing{done.linked === 1 ? '' : 's'} now one item.
        </span>{' '}
        <Link href={`/item/${done.itemId}`} className="underline">
          View item
        </Link>
      </div>
    );
  }

  return (
    <div className="border border-edge bg-panel p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          {cluster.members.length} listings that look like each other
        </p>
        <p className="text-[11px] text-muted">
          agrees on {cluster.agreements.join(', ') || 'the house only'}
        </p>
      </div>

      <ul className="mt-2 space-y-0.5">
        {cluster.members.map((m) => (
          <li key={m.id} className="text-[12px]">
            <span className="text-muted">{m.source_name}</span> · {m.title_raw}{' '}
            <span className="text-muted">
              {m.price} {m.currency}
            </span>
          </li>
        ))}
      </ul>

      {/* Stated, not buried: applying the group's facts to a member that never
          said them is an inference about that member. */}
      {cluster.assumptions.length ? (
        <p className="mt-2 text-[11px] ink-madder">Assumes: {cluster.assumptions.join('; ')}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <label className="label">Sub-line for all {cluster.members.length}</label>
          <select className="field" value={sublineId} onChange={(e) => setSublineId(e.target.value)}>
            <option value="">— choose —</option>
            {sublines.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
                {s.monitored ? '' : ' (not monitored)'}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <label className="label">AD year</label>
          <input
            className="field"
            value={adYear}
            placeholder="2002"
            onChange={(e) => setAdYear(e.target.value)}
          />
        </div>
        <button
          className="btn btn-primary"
          disabled={pending || !sublineId}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await resolveCluster(
                cluster.members.map((m) => m.id),
                { sublineId, adYear: adYear || undefined },
              );
              if (res.ok) setDone({ itemId: res.itemId, linked: res.linked });
              else setError(res.error);
            })
          }
        >
          {pending ? 'Linking…' : 'Make one item'}
        </button>
      </div>

      {error ? <p className="mt-2 text-[12px] ink-madder">{error}</p> : null}
    </div>
  );
}
