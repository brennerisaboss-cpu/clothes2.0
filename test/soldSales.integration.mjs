// Recording a sale somebody actually made, against a real database.
//
// Every other source in this platform reports asking prices, so every margin on
// the screen is arithmetic on two hopes — which is why /opportunities holds
// ask-only rows behind a toggle and why the strongest evidence tier has been
// unreachable from any automated path since the beginning. A poll that stops
// seeing a listing cannot know it sold, and this codebase refuses to pretend
// otherwise.
//
// A Marketplace Insights record is different in kind: eBay stating that an item
// sold, on a date, at a price. This holds the three properties that make
// ingesting one safe rather than merely useful.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { runPoll } from '../src/lib/pollRunner.mjs';
import * as ebayInsights from '../src/lib/adapters/ebayInsights.mjs';

const SOURCE_ID = 'test_sold_insights';
let client;

// Mutable fixture: what the API is currently returning.
const state = { sales: [] };

const sale = (id, price, soldAt, title = 'Yohji Yamamoto Pour Homme AW03 wool coat') => ({
  itemId: id,
  title,
  lastSoldPrice: { value: String(price), currency: 'EUR' },
  lastSoldDate: soldAt,
  condition: 'Used',
  itemWebUrl: `https://example.invalid/${id}`,
  seller: { username: 'seller1' },
});

const fetchImpl = async () =>
  new Response(JSON.stringify({ total: state.sales.length, itemSales: state.sales }), {
    status: 200,
  });

const poll = async () => {
  const { rows } = await client.query(`select * from sources where id = $1`, [SOURCE_ID]);
  return runPoll({
    client,
    source: rows[0],
    adapter: ebayInsights,
    baseCurrency: 'EUR',
    fetchImpl,
  });
};

const rows = async () =>
  (await client.query(
    `select source_item_id, price_base, status::text as status, evidence::text as evidence,
            date_seen, first_seen_at, supersedes_id
       from listings where source_id = $1 order by date_seen, source_item_id`,
    [SOURCE_ID],
  )).rows;

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from poll_runs where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from sources where id = $1`, [SOURCE_ID]);
  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed, config, marketplace_kind)
     values ($1,'eBay sold (fixture)','api','exit',true,$2::jsonb,'secondhand')`,
    [SOURCE_ID, JSON.stringify({ adapter: 'ebay_insights', queries: ['Yohji Yamamoto'], token: 't' })],
  );
});

beforeEach(async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`update sources set last_good_count = null where id = $1`, [SOURCE_ID]);
});

after(async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from poll_runs where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from sources where id = $1`, [SOURCE_ID]);
  await client.end();
});

test('a stated sale becomes the one status that means a sale', async () => {
  // `sold_confirmed` is tied to `confirmed_sale` by a database constraint, and
  // nothing in the automated path could reach either until a source began
  // stating the outcome rather than being asked to infer it.
  state.sales = [sale('v1|1|0', 640, '2026-08-01T09:00:00.000Z')];

  const result = await poll();
  assert.equal(result.ok, true, result.error ?? '');
  assert.equal(result.sales, 1);

  const [row] = await rows();
  assert.equal(row.status, 'sold_confirmed');
  assert.equal(row.evidence, 'confirmed_sale');
  assert.equal(Number(row.price_base), 640);
});

test('the sale is dated when it happened, not when it was read', async () => {
  // A three-month-old result stamped with today's date would count as evidence
  // gathered this morning — which is precisely what the recency weighting
  // exists to prevent, and the error would be invisible.
  state.sales = [sale('v1|2|0', 500, '2026-07-02T10:00:00.000Z')];
  await poll();

  const [row] = await rows();
  assert.equal(new Date(row.date_seen).toISOString(), '2026-07-02T10:00:00.000Z');
});

test('a sale carries no first sighting, so it never enters the survival curve', async () => {
  // A completed-sale record says what a piece fetched and never says when it
  // was listed. Inventing a first sighting of now() would give it a span
  // running from today back to the sale — a negative duration, floored to zero
  // — and the venue would read as one where everything sells instantly.
  // survival.mjs already refuses a row without one.
  state.sales = [sale('v1|3|0', 700, '2026-06-01T00:00:00.000Z')];
  await poll();

  const [row] = await rows();
  assert.equal(row.first_seen_at, null);
});

test('the same sale seen again is the same event, not a second comp', async () => {
  // The window is ninety days wide and is re-read on every poll, so without
  // this a single sale would become a new comp every fifteen minutes — and
  // comp count is what decides whether an estimate is settled or provisional.
  state.sales = [sale('v1|4|0', 800, '2026-08-15T12:00:00.000Z')];

  const first = await poll();
  const second = await poll();
  const third = await poll();

  assert.equal(first.sales, 1);
  assert.equal(second.sales, 0);
  assert.equal(third.sales, 0);
  assert.equal((await rows()).length, 1);
});

test('the same item selling twice is two sales', async () => {
  // A multi-quantity listing keeps its item id across sales, so the id alone
  // cannot say whether this is a repeat reading or a second event. The date
  // can, and does.
  state.sales = [sale('v1|5|0', 800, '2026-08-15T12:00:00.000Z')];
  await poll();
  state.sales = [sale('v1|5|0', 760, '2026-08-29T12:00:00.000Z')];
  const second = await poll();

  assert.equal(second.sales, 1);
  const all = await rows();
  assert.equal(all.length, 2);
  // Neither supersedes the other: a sale is not a re-price of a listing, it is
  // a completed event, and chaining them would hide one from the comp pool.
  assert.deepEqual(all.map((r) => r.supersedes_id), [null, null]);
});

test('a sale ageing out of the window is never read as a disappearance', async () => {
  // The property the whole design rests on. The adapter never claims to have
  // enumerated a catalogue, so statusChangeVeto refuses to conclude an absence
  // — otherwise the strongest evidence the platform has would turn into a
  // phantom delisting ninety days after it was recorded.
  state.sales = [
    sale('v1|6|0', 800, '2026-08-01T12:00:00.000Z'),
    sale('v1|7|0', 820, '2026-08-02T12:00:00.000Z'),
  ];
  await poll();
  assert.equal((await rows()).length, 2);

  // The older one drops out of the window.
  state.sales = [sale('v1|7|0', 820, '2026-08-02T12:00:00.000Z')];
  const second = await poll();

  assert.equal(second.delisted, 0, 'nothing may be concluded gone from a ranked sample');
  const all = await rows();
  assert.equal(all.length, 2);
  assert.ok(all.every((r) => r.status === 'sold_confirmed'), 'a recorded sale is permanent');
});

test('a sale with no date is dropped, not written as an ask', async () => {
  // Falling through would write it as an ordinary observation, which says the
  // piece is ON the market at this price — the opposite of what the source
  // reported. And an undated comp cannot be weighted for recency, so it would
  // count as fresh for ever.
  state.sales = [
    sale('v1|8|0', 900, null),
    sale('v1|9|0', 950, '2026-08-20T12:00:00.000Z'),
  ];

  const result = await poll();
  assert.equal(result.ok, true, result.error ?? '');
  assert.equal(result.sales, 1, 'only the dated one is a sale');
  assert.equal(result.undatedSales, 1, 'and the other is counted rather than silent');

  const all = await rows();
  assert.equal(all.length, 1);
  assert.equal(all[0].source_item_id, 'v1|9|0');
});
