// Evaluate alert rules and deliver.
//
//   node scripts/alert.mjs
//
// Intended to run straight after scripts/poll.mjs on the same schedule, so the
// gap between a listing appearing and an alert landing stays small — that gap
// is measured and shown on the dashboard.

import pg from 'pg';
import { runAlerts } from '../src/lib/alertRunner.mjs';
import { VISIBLE_ITEMS_CTE, HEAD_OF_CHAIN } from '../src/lib/comps.mjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// The same rows, the same comps and the same corrections the dashboard uses, so
// an alert can never disagree with what the UI shows for the same listing.
//
// It used to say that and not do it. The comp query below was written by hand
// here and had drifted from the one /opportunities runs, in three ways that all
// moved the number in the flattering direction:
//
//   * `marketplace_kind` was not selected, so `resaleEstimate`'s retail filter
//     compared `undefined <> 'retail'` and let every boutique's full price into
//     the pool. "Retail is never a comp" held on the screen and not here.
//   * `source_id` was not selected, so an estimate could never be scoped to the
//     venue actually being sold on.
//   * the borrowing rule in comps.mjs was not applied at all, so an item whose
//     material or model nobody stated drew on nothing.
//
// A screen carries a caveat beside a number. A push notification is read as
// "act on this now", so it is the one that can least afford its own arithmetic.
const { rows: candidates } = await client.query(
  `select l.id, l.item_id, l.title_raw, l.price, l.currency, l.price_base,
          l.condition_tier::text as condition_tier, l.size_raw,
          l.url, l.image_url, l.source_id, l.source_item_id, l.proxy_purchasable,
          s.display_name as source_name, s.role::text as source_role,
          l.date_seen, l.source_published_at, l.last_verified_at, l.entered_manually,
          sub.display_name as subline_name, sub.id as subline_id, i.ad_year, i.brand_id
     from listings l
     join sources s on s.id = l.source_id
     join items i on i.id = l.item_id
     left join sublines sub on sub.id = i.subline_id
    where l.status = 'active' and s.role in ('acquisition','both')
      and not exists (select 1 from listings sup where sup.supersedes_id = l.id)
    order by l.date_seen desc limit 500`,
);

const itemIds = [...new Set(candidates.map((c) => c.item_id))];
const { rows: obsRows } = itemIds.length
  ? await client.query(
      `with ${VISIBLE_ITEMS_CTE}
       select v.for_item as item_id, v.borrowed,
              l.id, l.price_base, l.condition_tier::text as condition_tier,
              l.evidence::text as evidence, l.status::text as status, l.date_seen,
              l.last_verified_at, l.entered_manually, l.source_id,
              s.role::text as source_role, s.marketplace_kind::text as marketplace_kind
         from visible v
         join listings l on l.item_id = v.from_item
         join sources s on s.id = l.source_id
        -- One comp per piece: the snapshot log holds every price a listing has
        -- worn, and counting them all lets one re-priced garment satisfy the
        -- three-comp minimum by itself.
        where ${HEAD_OF_CHAIN}`,
      [itemIds],
    )
  : { rows: [] };

const observations = new Map();
for (const row of obsRows) {
  if (!observations.has(row.item_id)) observations.set(row.item_id, []);
  observations.get(row.item_id).push(row);
}

const { rows: routes } = await client.query(`select * from routes where active`);

// What pieces of each brand actually fetched on each venue. Below three
// recorded sales it corrects nothing, which is what a fresh install does.
const { rows: calibrationRows } = await client.query(
  `select brand_id, venue, observations, ratio from calibration`,
);
const calibration = new Map(
  calibrationRows.map((r) => [
    `${r.brand_id ?? '?'}|${r.venue}`,
    { observations: Number(r.observations), ratio: Number(r.ratio) },
  ]),
);

const summary = await runAlerts({ client, candidates, observations, routes, calibration });
console.log(JSON.stringify(summary, null, 2));

await client.end();
