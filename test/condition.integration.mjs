// The condition a feed states, carried through to the tier it means.
//
// `condition_mappings` has existed since the first migration and is seeded with
// the grading vocabularies of the venues that publish feeds; the merchant-feed
// adapter pulls `g:condition` out of every record it reads. The poll runner
// then wrote `null, null` into condition_raw and condition_tier
// unconditionally, so the whole chain existed except its last link.
//
// The cost was not a blank column. resaleEstimate values an unstated condition
// against the CHEAPEST tier available and halves its confidence, both on
// purpose — so every listing the automated half of the platform produced sat
// permanently in the weakest branch of the valuation, including the ones whose
// seller had said plainly what condition the piece was in.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';
import { runPoll } from '../src/lib/pollRunner.mjs';
import * as merchantFeed from '../src/lib/adapters/merchantFeed.mjs';
import { normalizeAlias } from '../src/lib/normalize.mjs';

const SOURCE_ID = 'test_condition_feed';
let client;
let server;
let port;

const state = { rows: [] };

const row = (id, title, price, condition) => `
  <item>
    <g:id>${id}</g:id>
    <title>${title}</title>
    <g:price>${price} EUR</g:price>
    <link>https://example.invalid/${id}</link>
    ${condition == null ? '' : `<g:condition>${condition}</g:condition>`}
  </item>`;

const feed = () => `<?xml version="1.0"?>
<rss xmlns:g="http://base.google.com/ns/1.0"><channel>${state.rows.join('')}</channel></rss>`;

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/xml' }).end(feed());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from poll_runs where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from condition_mappings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from sources where id = $1`, [SOURCE_ID]);

  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed, config, marketplace_kind)
     values ($1,'Condition feed fixture','feed','acquisition',true,$2::jsonb,'secondhand')`,
    [SOURCE_ID, JSON.stringify({ adapter: 'merchant_feed', url: `http://127.0.0.1:${port}/feed.xml`, currency: 'EUR' })],
  );

  // This source's own grading words. Per source, because "Very Good" means
  // different things on different venues and a shared table would flatten that.
  for (const [label, tier] of [['Pristine', 'new'], ['Very Good', 'good'], ['Fair', 'fair']]) {
    await client.query(
      `insert into condition_mappings (source_id, raw_label, raw_label_norm, tier)
       values ($1,$2,$3,$4::condition_tier)`,
      [SOURCE_ID, label, normalizeAlias(label).compact, tier],
    );
  }
});

beforeEach(async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`update sources set last_good_count = null where id = $1`, [SOURCE_ID]);
});

after(async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from poll_runs where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from condition_mappings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from sources where id = $1`, [SOURCE_ID]);
  await client.end();
  server.close();
});

const poll = async () => {
  const { rows } = await client.query(`select * from sources where id = $1`, [SOURCE_ID]);
  return runPoll({ client, source: rows[0], adapter: merchantFeed, baseCurrency: 'EUR' });
};

const stored = async (sourceItemId) => {
  const { rows } = await client.query(
    `select condition_raw, condition_tier::text as condition_tier
       from listings where source_id = $1 and source_item_id = $2`,
    [SOURCE_ID, sourceItemId],
  );
  return rows[0] ?? null;
};

test('a stated condition reaches the listing as a tier', async () => {
  state.rows = [
    row('a1', 'Comme des Garcons Homme Plus AD2002 wool jacket', '900.00', 'Pristine'),
    row('a2', 'Comme des Garcons Homme Plus AD2002 wool coat', '800.00', 'Very Good'),
  ];

  const result = await poll();
  assert.equal(result.ok, true, result.error ?? '');

  assert.deepEqual(await stored('a1'), { condition_raw: 'Pristine', condition_tier: 'new' });
  assert.deepEqual(await stored('a2'), { condition_raw: 'Very Good', condition_tier: 'good' });
});

test('an unmapped word keeps its text and gets no tier', async () => {
  // Never a guess. An unrecognised word leaves the listing exactly where it was
  // before — valued against the cheapest tier, confidence halved — rather than
  // being assigned a tier nobody has said it means.
  state.rows = [row('b1', 'Comme des Garcons Homme Plus AD2002 wool jacket', '900.00', 'Lightly Loved')];

  const result = await poll();
  assert.equal(result.ok, true, result.error ?? '');
  assert.deepEqual(await stored('b1'), { condition_raw: 'Lightly Loved', condition_tier: null });

  // And it is named on the run, because the fix is one row in
  // condition_mappings and the only thing in the way is knowing the word.
  assert.deepEqual(result.unmappedConditions, { 'Lightly Loved': 1 });
});

test('a feed that states no condition is unchanged', async () => {
  state.rows = [row('c1', 'Comme des Garcons Homme Plus AD2002 wool jacket', '900.00', null)];

  const result = await poll();
  assert.equal(result.ok, true, result.error ?? '');
  assert.deepEqual(await stored('c1'), { condition_raw: null, condition_tier: null });
  assert.equal(result.unmappedConditions, undefined);
});

test('the mapping is case- and spacing-insensitive, as aliases are', async () => {
  state.rows = [row('d1', 'Comme des Garcons Homme Plus AD2002 wool jacket', '900.00', 'very  good')];

  const result = await poll();
  assert.equal(result.ok, true, result.error ?? '');
  assert.equal((await stored('d1')).condition_tier, 'good');
});
