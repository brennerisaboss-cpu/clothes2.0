// One comp per piece, proved against the real database.
//
// `listings` is a snapshot log: a re-price inserts a new row pointing at the
// one it supersedes, and the table IS the price history. That makes the table
// the wrong thing to count. Counting every row let one garment, on one venue,
// whose seller had cut its price twice, satisfy the three-comp minimum by
// itself — reported as a settled estimate, with a confidence figure built from
// a volume factor that had counted the same jacket three times, at a median
// sitting on a price the seller had already abandoned.
//
// Nothing about that surfaces as an error. It surfaces as a number, on the
// screen the whole platform exists to put numbers on. So it is held here,
// against Postgres, running the same SQL the application runs.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { VISIBLE_ITEMS_CTE, HEAD_OF_CHAIN } from '../src/lib/comps.mjs';
import { summariseItem, MIN_COMPS } from '../src/lib/priceHistory.mjs';

const PREFIX = 'test-comp-pool';
const SOURCE = 'test_comp_pool_exit';
let client;

const cleanup = async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE]);
  await client.query(`delete from items where identity_key like $1`, [`${PREFIX}|%`]);
  await client.query(`delete from sources where id = $1`, [SOURCE]);
};

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup();
  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed,
                          automation_block_reason, permission_status, marketplace_kind)
     values ($1, 'Comp pool fixture', 'manual', 'exit', false,
             'fixture source, never polled', 'not_asked', 'secondhand')`,
    [SOURCE],
  );
});

beforeEach(async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE]);
  await client.query(`delete from items where identity_key like $1`, [`${PREFIX}|%`]);
});

after(async () => {
  await cleanup();
  await client.end();
});

async function item(rest) {
  const key = `${PREFIX}|${rest}`;
  const { rows } = await client.query(
    `insert into items (brand_id, subline_id, canonical_name, ad_year_status, identity_key)
     values ('ann', null, $1, 'unknown', $1)
     on conflict (identity_key) do update set identity_key = excluded.identity_key
     returning id`,
    [key],
  );
  return rows[0].id;
}

/**
 * One physical listing, re-priced down the given sequence.
 *
 * Each price is a new snapshot pointing at the one before it, exactly as
 * pollRunner writes them. `date_seen` is spread across distinct days because
 * the table's unique index is on (source, source item, date seen) — two
 * snapshots of one listing in the same instant are not a thing a poll produces.
 */
async function repricedListing(itemId, sourceItemId, prices) {
  let previous = null;
  let daysAgo = prices.length;
  for (const price of prices) {
    const { rows } = await client.query(
      `insert into listings (item_id, source_id, source_item_id, title_raw, price, currency,
                             price_base, fx_rate_at_snapshot, status, evidence,
                             entered_manually, supersedes_id, first_seen_at, date_seen)
       values ($1, $2, $3, 'Comp pool fixture piece', $4, 'EUR', $4, 1, 'active', 'active_ask',
               false, $5, now(), now() - ($6 || ' days')::interval)
       returning id`,
      [itemId, SOURCE, sourceItemId, price, previous, String(daysAgo)],
    );
    if (previous) {
      await client.query(`update listings set status = 'relisted' where id = $1`, [previous]);
    }
    previous = rows[0].id;
    daysAgo -= 1;
  }
  return previous;
}

/** The comps scoring would see for an item — the same SQL observationsForItems runs. */
async function comps(itemId) {
  const { rows } = await client.query(
    `with ${VISIBLE_ITEMS_CTE}
     select v.for_item as item_id, v.borrowed, l.id, l.price_base,
            l.condition_tier::text as condition_tier, l.evidence::text as evidence,
            l.status::text as status, l.date_seen, l.last_verified_at, l.entered_manually,
            l.source_id, s.role::text as source_role,
            s.marketplace_kind::text as marketplace_kind
       from visible v
       join listings l on l.item_id = v.from_item
       join sources s on s.id = l.source_id
      where ${HEAD_OF_CHAIN}`,
    [[itemId]],
  );
  return rows;
}

test('a re-priced listing is one comp, not one per price it has worn', async () => {
  const id = await item('ad2002|jacket|wool|reprice');
  await repricedListing(id, 'L1', [1000, 900, 800]);

  const rows = await comps(id);
  assert.equal(rows.length, 1, 'three snapshots of one jacket are one comp');
  assert.equal(Number(rows[0].price_base), 800, 'the comp is the price it stands at now');
});

test('one garment can never satisfy the comp minimum by re-pricing', async () => {
  // The failure this test exists for. Three snapshots passed the MIN_COMPS gate,
  // so `sufficient` was true, the estimate was reported as settled rather than
  // provisional, and the median landed on a price nobody was asking any more.
  const id = await item('ad2002|coat|wool|minimum');
  await repricedListing(id, 'L1', [1000, 900, 800]);

  const summary = summariseItem(await comps(id));
  assert.equal(summary.untiered.count, 1);
  assert.equal(summary.untiered.sufficient, false, `one piece cannot reach ${MIN_COMPS} comps alone`);
  assert.equal(summary.untiered.median, null, 'and it produces no settled median');
});

test('three separate pieces still make a settled estimate', async () => {
  // The rule must not have bought its safety by refusing real comps.
  const id = await item('ad2002|coat|leather|three');
  await repricedListing(id, 'A', [1000, 900]);
  await repricedListing(id, 'B', [820]);
  await repricedListing(id, 'C', [780]);

  const rows = await comps(id);
  assert.equal(rows.length, 3);
  const summary = summariseItem(rows);
  assert.equal(summary.untiered.sufficient, true);
  assert.equal(summary.untiered.median, 820);
});

test('a piece that left the market keeps the evidence it left with', async () => {
  // Head-of-chain is also where planAbsences writes the disappearance, so the
  // one tier of evidence the automated path can produce is not filtered away
  // with the superseded rows.
  const id = await item('ad2002|jacket|leather|gone');
  const head = await repricedListing(id, 'L1', [1200, 1100]);
  await client.query(
    `update listings set status = 'delisted', evidence = 'inferred_disappearance' where id = $1`,
    [head],
  );

  const rows = await comps(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].evidence, 'inferred_disappearance');
  assert.equal(Number(rows[0].price_base), 1100);
});
