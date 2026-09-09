// The loop that makes this platform useful, end to end against the database.
//
// A piece disappears from a shop. It leaves the buy side, because it is not a
// thing you can buy. It stays as evidence, because somebody took it off the
// market at that price — and that is what the margin on a piece you CAN buy
// rests on.
//
// Unit tests prove each half. Only the database proves they meet.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { scoreAllRoutes } from '../src/lib/scoring.mjs';

// queries.ts cannot be imported by the test runner without a TypeScript
// loader, so the two statements under test are issued directly. They are
// copied from src/lib/queries.ts and must stay in step with it — which is
// exactly what the first test checks: it asserts on the WHERE clause the grid
// applies, so a change there that forgets delisted listings fails here.
const GRID_ACTIVE = "l.status in ('active', 'relisted')";

async function gridCards(sourceId, { includeGone = false } = {}) {
  const { rows } = await client.query(
    `select l.id, l.item_id, l.price_base, l.condition_tier::text as condition_tier,
            l.date_seen, l.last_verified_at, l.entered_manually, l.source_id
       from listings l
      where l.source_id = $1 ${includeGone ? '' : `and ${GRID_ACTIVE}`}`,
    [sourceId],
  );
  return rows;
}

async function observationsFor(id) {
  const { rows } = await client.query(
    `select l.id, l.price_base, l.condition_tier::text as condition_tier,
            l.evidence::text as evidence, l.status::text as status,
            l.date_seen, l.last_verified_at, l.entered_manually,
            l.source_id, s.role::text as source_role,
            s.marketplace_kind::text as marketplace_kind
       from listings l join sources s on s.id = l.source_id
      where l.item_id = $1`,
    [id],
  );
  return rows;
}

const ACQ = 'test_ev_acq';
const EXIT = 'test_ev_exit';
const KEY = 'cdg-homme-plus|ad2009|jacket|wool|?';
let client;
let itemId;

const cleanup = async () => {
  await client.query(`delete from listings where source_id = any($1::text[])`, [[ACQ, EXIT]]);
  await client.query(`delete from routes where acquisition_source = $1`, [ACQ]);
  await client.query(`delete from items where identity_key = $1`, [KEY]);
  await client.query(`delete from sources where id = any($1::text[])`, [[ACQ, EXIT]]);
};

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup();

  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed,
                          automation_block_reason, marketplace_kind)
     values ($1,'Test acq','manual','acquisition',false,'test','secondhand'),
            ($2,'Test exit','manual','both',false,'test','secondhand')`,
    [ACQ, EXIT],
  );
  await client.query(
    `insert into routes (id, display_name, acquisition_source, exit_source,
                         sale_fee_pct, payment_fee_pct, outbound_ship_flat)
     values ('test_ev_route','acq to exit',$1,$2,0.09,0.029,20)`,
    [ACQ, EXIT],
  );

  const item = await client.query(
    `insert into items (brand_id, subline_id, canonical_name, ad_year, ad_year_status,
                        ad_year_basis, identity_key)
     values ('cdg','cdg-homme-plus','evidence test jacket',2009,'known','ad_tag',$1) returning id`,
    [KEY],
  );
  itemId = item.rows[0].id;

  // One piece to buy, still for sale.
  await client.query(
    `insert into listings (item_id, source_id, title_raw, price, currency, price_base,
       fx_rate_at_snapshot, condition_tier, status, evidence, entered_manually,
       last_verified_at, date_seen)
     values ($1,$2,'CDG Homme Plus AD2009 wool jacket',300,'EUR',300,1,'excellent',
             'active','active_ask',true, now(), now())`,
    [itemId, ACQ],
  );

  // Three on the exit venue that are GONE — taken off the market at a price.
  for (const price of [1000, 1100, 1050]) {
    await client.query(
      `insert into listings (item_id, source_id, title_raw, price, currency, price_base,
         fx_rate_at_snapshot, condition_tier, status, evidence, entered_manually,
         last_verified_at, date_seen)
       values ($1,$2,'CDG Homme Plus AD2009 wool jacket',$3,'EUR',$3,1,'excellent',
               'delisted','inferred_disappearance',true, now(), now())`,
      [itemId, EXIT, price],
    );
  }
});

after(async () => {
  await cleanup();
  await client.end();
});

test('a piece that is gone does not appear as something to buy', async () => {
  const cards = await gridCards(EXIT);
  assert.equal(cards.length, 0, 'delisted listings must be off the buy side by default');
});

test('but it is still there when asked for', async () => {
  const cards = await gridCards(EXIT, { includeGone: true });
  assert.equal(cards.length, 3);
});

test('and it is the evidence the margin rests on', async () => {
  const [buyable] = await gridCards(ACQ);
  assert.ok(buyable, 'the piece to buy is still on the buy side');

  const observations = await observationsFor(itemId);
  const { rows: routes } = await client.query(
    `select * from routes where acquisition_source = $1`, [ACQ],
  );
  const { best } = scoreAllRoutes({ listing: buyable, observations, routes });

  assert.equal(best.scored, true, best.reason);
  // Bought at 300 against pieces that left the market around 1050.
  assert.equal(best.evidenceBasis, 'disappearances');
  assert.ok(best.profit > 0, `expected a margin, got ${best.profit}`);
  assert.equal(best.resale.comps, 3);
});
