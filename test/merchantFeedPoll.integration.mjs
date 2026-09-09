// A merchant feed through the real poll, into the real database.
//
// The adapter is well covered on its own, but "the adapter returns the right
// objects" and "a poll of that feed leaves the right rows" are different
// claims — and the gap between them is where the disappearance evidence bug
// lived for two commits: every unit test passed while the mechanism did
// nothing, because the tests wrote the rows they then asserted on.
//
// This is the route into The RealReal and Vestiaire, so it is the one worth
// proving end to end rather than assuming.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import pg from 'pg';
import { runPoll } from '../src/lib/pollRunner.mjs';
import * as merchantFeed from '../src/lib/adapters/merchantFeed.mjs';

const SOURCE_ID = 'test_merchant_feed';
let client;
let server;
let port;

// A pipe-delimited, gzipped feed: how Rakuten Advertising actually serves one.
const ROWS = [
  'id|title|brand|price|link|condition|availability',
  'M1|Comme des Garcons Homme Plus AD2004 wool tailored jacket|Comme des Garcons|1150.00 USD|https://example.invalid/m1|Pre-owned|in stock',
  'M2|Yohji Yamamoto Pour Homme wool gabardine long coat|Yohji Yamamoto|1490.00 USD|https://example.invalid/m2|Pre-owned|in stock',
  'M3|Guidi 992 horse leather boot|Guidi|780.00 USD|https://example.invalid/m3|Pre-owned|in stock',
  'M4|Nike running shoe|Nike|90.00 USD|https://example.invalid/m4|New|in stock',
];
const state = { rows: ROWS };

const cleanup = async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from poll_runs where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from sources where id = $1`, [SOURCE_ID]);
  await client.query(`delete from items where identity_key like '%|ad2004|%'`);
};

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup();

  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/gzip' });
    res.end(gzipSync(Buffer.from(state.rows.join('\n'), 'utf8')));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed,
                          permission_status, marketplace_kind, config)
     values ($1,'Test merchant','feed','both',true,'granted','secondhand',$2::jsonb)`,
    [SOURCE_ID, JSON.stringify({
      adapter: 'merchant_feed',
      url: `http://127.0.0.1:${port}/feed.txt.gz`,
      currency: 'USD',
    })],
  );
  await client.query(
    `insert into fx_rates (base_currency, quote_currency, rate, as_of, source)
     values ('USD','EUR',0.92, now(), 'test')
     on conflict (base_currency, quote_currency, as_of) do nothing`,
  );
});

after(async () => {
  await cleanup();
  await client.end();
  await new Promise((r) => server.close(r));
});

const poll = async () => {
  const { rows } = await client.query('select * from sources where id = $1', [SOURCE_ID]);
  return runPoll({ client, source: rows[0], adapter: merchantFeed, baseCurrency: 'EUR', userAgent: 'test' });
};

test('a gzipped pipe-delimited feed lands as real rows', async () => {
  const r = await poll();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.count, 4, 'all four rows parsed');
  assert.equal(r.kept, 3, 'the Nike is off the roster and must not be kept');
  assert.equal(r.inserted, 3);
});

test('prices are converted, not stored raw', async () => {
  const { rows } = await client.query(
    `select price, currency, price_base, fx_rate_at_snapshot from listings
      where source_id = $1 and source_item_id = 'M1'`,
    [SOURCE_ID],
  );
  assert.equal(Number(rows[0].price), 1150);
  assert.equal(rows[0].currency, 'USD');
  // 1150 USD at 0.92 — the check that would catch a currency read as another.
  assert.equal(Number(rows[0].price_base), 1058);
});

test('feed listings are attached to items, so they can be compared', async () => {
  // A listing with no item is invisible to every comparison in the platform.
  const { rows } = await client.query(
    `select count(*)::int as n from listings
      where source_id = $1 and item_id is not null`,
    [SOURCE_ID],
  );
  assert.equal(rows[0].n, 3);
});

test('a piece that leaves the feed is delisted AND recorded as evidence', async () => {
  // The bug this file exists for. A merchant feed is the whole catalogue, so
  // absence from it is meaningful — but only if the evidence class is written.
  state.rows = ROWS.filter((r) => !r.startsWith('M1|'));
  const r = await poll();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.delisted, 1);

  const { rows } = await client.query(
    `select status::text, evidence::text from listings
      where source_id = $1 and source_item_id = 'M1'`,
    [SOURCE_ID],
  );
  assert.equal(rows[0].status, 'delisted');
  assert.equal(rows[0].evidence, 'inferred_disappearance');
});

test('an unreachable feed changes nothing', async () => {
  const before = await client.query(
    `select status::text, id from listings where source_id = $1 order by id`, [SOURCE_ID],
  );
  await client.query(
    `update sources set config = jsonb_set(config, '{url}', '"http://127.0.0.1:1/gone"')
      where id = $1`, [SOURCE_ID],
  );
  const r = await poll();
  assert.equal(r.ok, false);

  const after = await client.query(
    `select status::text, id from listings where source_id = $1 order by id`, [SOURCE_ID],
  );
  assert.deepEqual(after.rows, before.rows, 'a failed poll must not touch a single row');
});
