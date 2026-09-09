// End-to-end poll test against a real Postgres and a fixture Shopify feed.
//
// The rule under test is the one the brief calls the most important in the
// system: a broken or partial poll must never mark anything as gone.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';
import { runPoll } from '../src/lib/pollRunner.mjs';
import * as shopify from '../src/lib/adapters/shopify.mjs';

const SOURCE_ID = 'test_shop';
let client;
let server;
let port;

// Mutable fixture state, so a test can break the feed mid-run.
const state = {
  mode: 'full',
  robots: 'User-agent: *\nDisallow: /cart\n',
};

const product = (id, title, price, vendor = 'Comme des Garcons') => ({
  id,
  title,
  handle: `p${id}`,
  vendor,
  images: [{ src: `https://img.invalid/${id}.jpg` }],
  variants: [{ id: id * 10, title: 'M', price: String(price), available: true }],
});

const FULL = [
  product(1, 'Comme des Garcons Homme Plus AD2002 wool coat', 900),
  product(2, 'Comme des Garcons Shirt striped poplin', 180),
  product(3, 'Junya Watanabe MAN denim jacket', 420),
  product(4, 'Comme des Garcons Homme cotton trousers', 210),
  product(5, 'Black Comme des Garcons wool skirt', 260),
  product(6, 'Comme des Garcons Homme Deux blazer', 540),
  product(7, 'Tricot Comme des Garcons knit', 300),
  product(8, 'Noir Kei Ninomiya bonded top', 480),
  product(9, 'Nike running shoe', 90, 'Nike'), // off-brand: must be filtered out
];

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from poll_runs where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from sources where id = $1`, [SOURCE_ID]);

  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(state.robots);
      return;
    }
    if (url.pathname === '/products.json') {
      if (state.mode === 'error') { res.writeHead(500).end('boom'); return; }
      if (state.mode === 'html') { res.writeHead(200).end('<!doctype html>'); return; }
      if (state.mode === 'ratelimited') { res.writeHead(429, { 'retry-after': '30' }).end(''); return; }
      const products =
        state.mode === 'empty' ? []
        : state.mode === 'shrunk' ? FULL.slice(0, 2)
        : state.mode === 'oneGone' ? FULL.filter((p) => p.id !== 2)
        : state.mode === 'repriced' ? FULL.filter((p) => p.id !== 2).map((p) => (p.id === 1 ? { ...p, variants: [{ ...p.variants[0], price: '650.00' }] } : p))
        : FULL;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ products }));
      return;
    }
    res.writeHead(404).end('');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed, config)
     values ($1,'Test Shop','feed','acquisition',true,$2::jsonb)`,
    [SOURCE_ID, JSON.stringify({ domain: '127.0.0.1', currency: 'EUR', base: `http://127.0.0.1:${port}` })],
  );
});

after(async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from poll_runs where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from sources where id = $1`, [SOURCE_ID]);
  await client.end();
  server.close();
});

async function poll() {
  const source = (await client.query('select * from sources where id = $1', [SOURCE_ID])).rows[0];
  return runPoll({ client, source, adapter: shopify, baseCurrency: 'EUR' });
}

const activeCount = async () =>
  Number(
    (await client.query(
      `select count(*) from listings where source_id = $1 and status = 'active'`, [SOURCE_ID],
    )).rows[0].count,
  );

test('first poll ingests only monitored brands', async () => {
  state.mode = 'full';
  const r = await poll();
  assert.equal(r.ok, true);
  assert.equal(r.count, 9, 'adapter saw all nine products');
  assert.equal(r.kept, 8, 'the Nike listing must be filtered out');
  assert.equal(await activeCount(), 8);
});

test('a repeat poll with no changes writes no duplicate snapshots', async () => {
  const before = Number((await client.query('select count(*) from listings where source_id=$1', [SOURCE_ID])).rows[0].count);
  const r = await poll();
  assert.equal(r.inserted, 0);
  assert.equal(r.unchanged, 8);
  const after = Number((await client.query('select count(*) from listings where source_id=$1', [SOURCE_ID])).rows[0].count);
  assert.equal(after, before, 'an unchanged poll must not grow the table');
});

test('a 500 error changes nothing and marks the poll not-ok', async () => {
  state.mode = 'error';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.equal(r.vetoed, true);
  assert.equal(await activeCount(), before, 'a failed poll must not delist anything');
  const flagged = Number((await client.query(
    `select count(*) from listings where source_id=$1 and last_poll_ok = false`, [SOURCE_ID])).rows[0].count);
  assert.ok(flagged > 0, 'listings must be flagged as having a failed poll');
});

test('an empty feed changes nothing — the classic broken-adapter case', async () => {
  state.mode = 'empty';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.match(r.error, /returned 0 results/);
  assert.equal(await activeCount(), before, 'an empty poll must never empty the shop');
});

test('a suspicious shrink changes nothing', async () => {
  state.mode = 'shrunk';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.equal(r.suspectShrink, true);
  assert.equal(await activeCount(), before);
});

test('the feed being switched off is not treated as an empty catalogue', async () => {
  state.mode = 'html';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.match(r.error, /not JSON|feed is not available/);
  assert.equal(await activeCount(), before);
});

test('a 429 backs off without changing anything', async () => {
  state.mode = 'ratelimited';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.match(r.error, /rate limited/);
  assert.equal(await activeCount(), before);
});

test('recovery: a good poll after failures restores last_poll_ok', async () => {
  state.mode = 'full';
  const r = await poll();
  assert.equal(r.ok, true);
  const flagged = Number((await client.query(
    `select count(*) from listings where source_id=$1 and status='active' and last_poll_ok = false`,
    [SOURCE_ID])).rows[0].count);
  assert.equal(flagged, 0);
});

test('a genuinely absent listing is delisted, never marked sold', async () => {
  state.mode = 'oneGone';
  const r = await poll();
  assert.equal(r.ok, true);
  assert.equal(r.delisted, 1);
  const gone = (await client.query(
    `select status::text, evidence::text from listings
      where source_id=$1 and source_item_id = '2:20'`, [SOURCE_ID])).rows[0];
  assert.equal(gone.status, 'delisted');
  assert.notEqual(gone.status, 'sold_confirmed');
  // The evidence class is what makes this useful later, not just the status.
  assert.equal(gone.evidence, 'inferred_disappearance');
});

test('that disappearance is evidence a real poll produced, and it scores', async () => {
  // The evidence tier rests on this chain, and until now every part of it was
  // proven separately: the poll detects absence, the ingest records WHY, and
  // scoring reads that to decide whether a margin is worth showing. Verified
  // here with a disappearance an actual poll produced rather than a row typed
  // into the database, which is the difference between testing the mechanism
  // and testing an assumption about it.
  const { scoreAllRoutes } = await import('../src/lib/scoring.mjs');

  // The fixture shop is acquisition-only; a comp has to come from somewhere
  // sellable, so it stands in as one for the length of this test.
  await client.query(`update sources set role = 'both' where id = $1`, [SOURCE_ID]);
  try {
    const { rows: observations } = await client.query(
      `select l.id, l.price_base, l.condition_tier::text as condition_tier,
              l.evidence::text as evidence, l.status::text as status,
              l.date_seen, l.last_verified_at, l.entered_manually,
              l.source_id, s.role::text as source_role,
              s.marketplace_kind::text as marketplace_kind
         from listings l join sources s on s.id = l.source_id
        where l.source_id = $1`,
      [SOURCE_ID],
    );
    assert.ok(
      observations.some((o) => o.evidence === 'inferred_disappearance'),
      'the poll should have left a disappearance behind',
    );

    const { best } = scoreAllRoutes({
      listing: {
        price_base: 50, condition_tier: null, source_id: SOURCE_ID,
        date_seen: new Date(), last_verified_at: new Date(), entered_manually: false,
      },
      observations,
      routes: [{
        id: 'r', acquisition_source: SOURCE_ID, exit_source: SOURCE_ID,
        sale_fee_pct: 0.09, payment_fee_pct: 0.029, outbound_ship_flat: 20,
      }],
    });

    assert.equal(best.scored, true, best.reason);
    assert.equal(
      best.evidenceBasis, 'disappearances',
      'a piece that left the market must count as evidence it moved',
    );
  } finally {
    await client.query(`update sources set role = 'acquisition' where id = $1`, [SOURCE_ID]);
  }
});

test('a price change writes a new snapshot and preserves the old one', async () => {
  state.mode = 'repriced';
  const r = await poll();
  assert.equal(r.ok, true);
  assert.equal(r.inserted, 1);
  const rows = (await client.query(
    `select price, status::text from listings
      where source_id=$1 and source_item_id = '1:10' order by date_seen`, [SOURCE_ID])).rows;
  assert.equal(rows.length, 2, 'the original price must survive as history');
  assert.equal(Number(rows[0].price), 900);
  assert.equal(rows[0].status, 'relisted');
  assert.equal(Number(rows[1].price), 650);
});

test('FX conversion is recorded with the rate that produced it', async () => {
  const row = (await client.query(
    `select price, price_base, fx_rate_at_snapshot from listings
      where source_id=$1 and source_item_id='1:10' order by date_seen desc limit 1`, [SOURCE_ID])).rows[0];
  assert.equal(Number(row.price), 650);
  assert.equal(Number(row.price_base), 650, 'EUR shop into EUR base is identity');
  assert.equal(Number(row.fx_rate_at_snapshot), 1);
});

test('robots.txt disallowing the feed stops the poll entirely', async () => {
  state.mode = 'full';
  state.robots = 'User-agent: *\nDisallow: /products.json\n';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.match(r.error, /robots\.txt disallows/);
  assert.equal(await activeCount(), before);
  state.robots = 'User-agent: *\nDisallow: /cart\n';
});

test('a source that is not cleared for automation is never polled', async () => {
  await client.query(
    `update sources set automation_allowed = false,
            automation_block_reason = 'test: shop asked us to stop' where id = $1`,
    [SOURCE_ID],
  );
  const r = await poll();
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.match(r.error, /automation not permitted/);
  await client.query(
    `update sources set automation_allowed = true, automation_block_reason = null where id = $1`,
    [SOURCE_ID],
  );
});

test('a catalogue priced in the wrong currency is refused, and writes nothing', async () => {
  // The bug this guards: a EUR shop read as JPY. Every €500 piece converts to
  // about €3 and tops the opportunities table wearing a 99% margin, and every
  // number after that is arithmetically correct. Ingesting and flagging
  // afterwards would leave prices wrong by two orders of magnitude in the
  // table that drives every decision, so nothing is written at all.
  await client.query(
    `update sources set config = jsonb_set(config, '{currency}', '"JPY"') where id = $1`,
    [SOURCE_ID],
  );
  await client.query(
    `insert into fx_rates (base_currency, quote_currency, rate, as_of, source)
     values ('JPY','EUR',0.0058, now(), 'test')
     on conflict (base_currency, quote_currency, as_of) do nothing`,
  );
  const before = await client.query(`select count(*)::int as n from listings where source_id = $1`, [SOURCE_ID]);

  state.mode = 'full';
  const res = await runPoll({
    client, source: (await client.query('select * from sources where id = $1', [SOURCE_ID])).rows[0],
    adapter: shopify, baseCurrency: 'EUR', userAgent: 'test',
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /implausible for JPY/);

  const after = await client.query(`select count(*)::int as n from listings where source_id = $1`, [SOURCE_ID]);
  assert.equal(after.rows[0].n, before.rows[0].n, 'a vetoed poll must write nothing');

  await client.query(
    `update sources set config = jsonb_set(config, '{currency}', '"EUR"') where id = $1`,
    [SOURCE_ID],
  );
});
