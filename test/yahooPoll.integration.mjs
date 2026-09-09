// Yahoo Shopping through the real poll runner and a real database.
//
// Proves the adapter conforms to the contract in the place it matters: that a
// rate-limited or partial Yahoo response cannot mark anything gone, and that
// proxy eligibility survives into the row.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { runPoll } from '../src/lib/pollRunner.mjs';
import * as yahoo from '../src/lib/adapters/yahooShopping.mjs';

const SOURCE_ID = 'test_yahoo';
let client;

const hit = (code, name, price, over = {}) => ({
  code,
  name,
  price,
  url: `https://store.shopping.yahoo.co.jp/x/${code}.html`,
  image: { medium: `https://img.invalid/${code}.jpg` },
  seller: { sellerId: 'jp-shop', name: 'JP Shop' },
  inStock: true,
  ...over,
});

const CATALOGUE = [
  hit('a1', 'コムデギャルソン オムプリュス ウール ジャケット AD2002', 48000, { purchaseAgency: 1 }),
  hit('a2', 'コムデギャルソン シャツ ストライプ', 12000, { purchaseAgency: 0 }),
  hit('a3', 'ジュンヤワタナベマン デニム ジャケット', 32000),
  hit('a4', 'ブラックコムデギャルソン ウール コート', 55000, { purchaseAgency: 1 }),
  hit('a5', 'Comme des Garcons Homme cotton trousers', 21000, { purchaseAgency: 1 }),
  hit('a6', 'コムデギャルソン オムドゥ ブレザー', 61000, { purchaseAgency: 1 }),
  hit('a7', 'トリコ コムデギャルソン ニット', 18000, { purchaseAgency: 1 }),
  hit('a8', 'ノワールケイニノミヤ トップス', 44000, { purchaseAgency: 1 }),
  hit('z9', 'ナイキ ランニングシューズ', 9000), // off-brand, must be filtered
];

const state = { mode: 'full' };

function fakeFetch() {
  return async () => {
    if (state.mode === 'ratelimited') {
      return { ok: false, status: 429, headers: { get: () => '30' }, text: async () => '' };
    }
    if (state.mode === 'error') {
      return { ok: false, status: 500, headers: { get: () => null }, text: async () => '' };
    }
    const hits =
      state.mode === 'empty' ? []
      : state.mode === 'shrunk' ? CATALOGUE.slice(0, 2)
      : CATALOGUE;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ totalResultsAvailable: hits.length, hits }),
    };
  };
}

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  for (const sql of [
    `delete from listings where source_id = $1`,
    `delete from poll_runs where source_id = $1`,
    `delete from sources where id = $1`,
  ]) await client.query(sql, [SOURCE_ID]);

  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed, config)
     values ($1,'Yahoo Shopping (test)','feed','acquisition',true,$2::jsonb)`,
    [SOURCE_ID, JSON.stringify({
      adapter: 'yahoo_shopping', domain: 'shopping.yahooapis.jp',
      currency: 'JPY', appId: 'test-app', query: 'コムデギャルソン',
    })],
  );
});

after(async () => {
  for (const sql of [
    `delete from listings where source_id = $1`,
    `delete from poll_runs where source_id = $1`,
    `delete from sources where id = $1`,
  ]) await client.query(sql, [SOURCE_ID]);
  await client.end();
});

async function poll() {
  const source = (await client.query('select * from sources where id = $1', [SOURCE_ID])).rows[0];
  return runPoll({ client, source, adapter: yahoo, baseCurrency: 'EUR', fetchImpl: fakeFetch() });
}

const activeCount = async () =>
  Number((await client.query(
    `select count(*) from listings where source_id=$1 and status='active'`, [SOURCE_ID])).rows[0].count);

test('Japanese titles are matched and off-brand rows filtered out', async () => {
  state.mode = 'full';
  const r = await poll();
  assert.equal(r.ok, true);
  assert.equal(r.count, 9);
  assert.equal(r.kept, 8, 'the Nike listing must not survive the brand filter');
  assert.equal(await activeCount(), 8);
});

test('JPY prices are converted with the rate recorded alongside them', async () => {
  const row = (await client.query(
    `select price, currency, price_base, fx_rate_at_snapshot from listings
      where source_id=$1 and source_item_id='a1'`, [SOURCE_ID])).rows[0];
  assert.equal(Number(row.price), 48000);
  assert.equal(row.currency, 'JPY');
  assert.ok(Number(row.price_base) > 0 && Number(row.price_base) < 1000);
  assert.ok(Number(row.fx_rate_at_snapshot) > 0);
});

test('proxy eligibility is stored in three states, not two', async () => {
  const rows = (await client.query(
    `select source_item_id, proxy_purchasable from listings
      where source_id=$1 and source_item_id in ('a1','a2','a3')`, [SOURCE_ID])).rows;
  const by = Object.fromEntries(rows.map((r) => [r.source_item_id, r.proxy_purchasable]));
  assert.equal(by.a1, true, 'stated as purchasable');
  assert.equal(by.a2, false, 'merchant excluded it');
  assert.equal(by.a3, null, 'not stated is null, never an assumed yes');
});

test('a rate-limited poll changes nothing', async () => {
  state.mode = 'ratelimited';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.match(r.error, /rate limited/);
  assert.equal(await activeCount(), before);
});

test('a 500 changes nothing', async () => {
  state.mode = 'error';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.equal(await activeCount(), before);
});

test('an empty result set after a real baseline changes nothing', async () => {
  state.mode = 'empty';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.match(r.error, /returned 0 results/);
  assert.equal(await activeCount(), before);
});

test('a suspicious shrink changes nothing', async () => {
  state.mode = 'shrunk';
  const before = await activeCount();
  const r = await poll();
  assert.equal(r.ok, false);
  assert.equal(r.suspectShrink, true);
  assert.equal(await activeCount(), before);
});

test('recovery leaves the catalogue intact', async () => {
  state.mode = 'full';
  const r = await poll();
  assert.equal(r.ok, true);
  assert.equal(await activeCount(), 8);
});
