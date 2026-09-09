// Evaluate alert rules and deliver.
//
//   node scripts/alert.mjs
//
// Intended to run straight after scripts/poll.mjs on the same schedule, so the
// gap between a listing appearing and an alert landing stays small — that gap
// is measured and shown on the dashboard.

import pg from 'pg';
import { runAlerts } from '../src/lib/alertRunner.mjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Reuse the same queries the dashboard uses so an alert can never disagree
// with what the UI shows for the same listing.
const { rows: candidates } = await client.query(
  `select l.id, l.item_id, l.title_raw, l.price, l.currency, l.price_base,
          l.condition_tier::text as condition_tier, l.size_raw,
          l.url, l.image_url, l.source_id, l.source_item_id, l.proxy_purchasable,
          s.display_name as source_name, s.role::text as source_role,
          l.date_seen, l.source_published_at, l.last_verified_at, l.entered_manually,
          sub.display_name as subline_name, sub.id as subline_id, i.ad_year
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
      `select l.item_id, l.id, l.price_base, l.condition_tier::text as condition_tier,
              l.evidence::text as evidence, l.status::text as status, l.date_seen,
              l.last_verified_at, l.entered_manually, s.role::text as source_role
         from listings l join sources s on s.id = l.source_id
        where l.item_id = any($1::uuid[])`,
      [itemIds],
    )
  : { rows: [] };

const observations = new Map();
for (const row of obsRows) {
  if (!observations.has(row.item_id)) observations.set(row.item_id, []);
  observations.get(row.item_id).push(row);
}

const { rows: routes } = await client.query(`select * from routes where active`);

const summary = await runAlerts({ client, candidates, observations, routes });
console.log(JSON.stringify(summary, null, 2));

await client.end();
