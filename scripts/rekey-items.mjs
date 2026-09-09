// Recompute item identity, and merge or split what changes.
//
//   node scripts/rekey-items.mjs [--dry-run]
//
// Identity is derived from listing titles, so refining how it is derived —
// splitting an M.A+ accordion bag from an M.A+ tote, or a Guidi 788Z from a
// PL1 — changes what should be one item and what should be two. Existing rows
// keep whatever key they were created with, so without this the old pooling
// survives: the very listings that prompted the change stay merged, and new
// ones arrive under new keys and fail to join anything.
//
// Two kinds of change, and the split is the one that matters:
//
//   MERGE  two items whose listings now compute to one key. Listings move,
//          the emptied item is deleted.
//   SPLIT  one item whose listings now compute to several keys. Each group
//          moves to the item for its own key, created if needed.
//
// Nothing is invented: every listing is re-planned from its own title, and a
// listing the matcher can no longer read is left where it is rather than
// dropped.

import pg from 'pg';
import { planMatch } from '../src/lib/matching.mjs';
import { sublineById } from '../src/lib/brands/index.mjs';

const dryRun = process.argv.includes('--dry-run');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: listings } = await client.query(
  `select l.id, l.item_id, l.title_raw, l.brand_raw, i.identity_key as current_key
     from listings l
     join items i on i.id = l.item_id
    order by l.id`,
);

// What each listing SHOULD belong to, by its own title.
const wanted = new Map();          // listing id -> plan
const byKey = new Map();           // new key -> plan (for creating items)
let unreadable = 0;

for (const l of listings) {
  const plan = planMatch({ brand_raw: l.brand_raw, title_raw: l.title_raw });
  if (!plan.matchable || !plan.key) {
    // Still resolvable when it was first matched, not now. Leaving it attached
    // is better than orphaning a listing that has real comps behind it.
    unreadable++;
    continue;
  }
  wanted.set(l.id, plan);
  if (!byKey.has(plan.key)) byKey.set(plan.key, plan);
}

const moving = [...wanted.entries()].filter(([id, plan]) => {
  const l = listings.find((x) => x.id === id);
  return l.current_key !== plan.key;
});

if (!moving.length) {
  console.log(`\nNothing to re-key. ${listings.length} listings already sit under their computed identity.\n`);
  await client.end();
  process.exit(0);
}

// Report before touching anything: this rewrites what the platform considers
// the same piece, which is the assumption every comp rests on.
const summary = new Map();
for (const [id, plan] of moving) {
  const l = listings.find((x) => x.id === id);
  const k = `${l.current_key}  ->  ${plan.key}`;
  summary.set(k, (summary.get(k) ?? 0) + 1);
}
console.log('');
for (const [change, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)} × ${change}`);
}
console.log(`\n  ${moving.length} of ${listings.length} listings change identity.`);
if (unreadable) console.log(`  ${unreadable} left alone — no longer readable by the matcher.`);

if (dryRun) {
  console.log('\n--dry-run: nothing written.\n');
  await client.end();
  process.exit(0);
}

await client.query('begin');
try {
  for (const [listingId, plan] of moving) {
    const brandId =
      plan.resolved?.brandId ?? sublineById(plan.sublineId)?.brand_id ?? null;
    if (!brandId) continue;

    const { rows } = await client.query(
      `insert into items (brand_id, subline_id, canonical_name, ad_year, ad_year_status, identity_key)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (identity_key) do update set identity_key = excluded.identity_key
       returning id`,
      [brandId, plan.sublineId, plan.canonicalName, plan.adYear ?? null,
       plan.adYearStatus ?? 'unknown', plan.key],
    );
    await client.query('update listings set item_id = $1 where id = $2', [rows[0].id, listingId]);
  }

  // Items nothing points at any more. Deleted rather than left: an empty item
  // is a canonical name with no evidence behind it, and it would show up in
  // every count and every list as though it were a piece being tracked.
  const { rowCount: removed } = await client.query(
    `delete from items i
      where not exists (select 1 from listings l where l.item_id = i.id)
        and not exists (select 1 from realised_sales r where r.item_id = i.id)`,
  );
  await client.query('commit');
  console.log(`\n  Re-keyed. ${removed} emptied item${removed === 1 ? '' : 's'} removed.\n`);
} catch (err) {
  await client.query('rollback');
  console.error(`\n  Failed, nothing changed: ${err.message}\n`);
  process.exitCode = 1;
}

await client.end();
