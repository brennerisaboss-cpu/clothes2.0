// Leaving a source alone, proved against the real database.
//
// Two clauses were missing and between them they are why a busy shop ends up
// rate-limiting even robots.txt:
//
//   `poll_interval_minutes` has been in the schema since the first migration
//   and was never read, so a shop configured for twice a day was polled on
//   every fifteen-minute tick — ninety-six times a day, by a platform whose own
//   documentation said it paced per source.
//
//   A 429 was treated as an ordinary failure, which is to say as a reason to
//   try again on the usual schedule. It is the one failure that is the source
//   telling you the schedule is the problem.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { runPoll } from '../src/lib/pollRunner.mjs';
import { DUE_FOR_POLL } from '../src/lib/ingest.mjs';
import * as shopify from '../src/lib/adapters/shopify.mjs';

const SOURCE_ID = 'test_cooldown_shop';
let client;

const state = { mode: 'ok' };

const product = (id) => ({
  id,
  title: `Comme des Garcons Homme Plus AD2002 wool jacket ${id}`,
  handle: `p${id}`,
  vendor: 'Comme des Garcons',
  images: [{ src: `https://img.invalid/${id}.jpg` }],
  variants: [{ id: id * 10, title: 'M', price: '500.00', available: true }],
});

const fetchImpl = async (url) => {
  if (String(url).endsWith('/robots.txt')) {
    return new Response('User-agent: *\nAllow: /\n', { status: 200 });
  }
  if (state.mode === 'limited') {
    return new Response('', { status: 429, headers: { 'retry-after': '600' } });
  }
  if (state.mode === 'limitedNoHeader') {
    return new Response('', { status: 429 });
  }
  return new Response(JSON.stringify({ products: [product(1), product(2)] }), { status: 200 });
};

const poll = async () => {
  const { rows } = await client.query(`select * from sources where id = $1`, [SOURCE_ID]);
  return runPoll({ client, source: rows[0], adapter: shopify, baseCurrency: 'EUR', fetchImpl });
};

/** The sources a scheduled run would pick up — the same clause both pollers use. */
const due = async () => {
  const { rows } = await client.query(
    `select s.id from sources s
      where s.tier = 'feed' and s.automation_allowed and s.permission_status <> 'declined'
        and ${DUE_FOR_POLL}`,
  );
  return rows.map((r) => r.id);
};

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed,
                          permission_status, poll_interval_minutes, marketplace_kind, config)
     values ($1, 'Cooldown fixture', 'feed', 'acquisition', true, 'granted', 360, 'secondhand',
             $2::jsonb)`,
    [SOURCE_ID, JSON.stringify({ domain: 'shop.invalid', currency: 'EUR', base: 'https://shop.invalid' })],
  );
  state.mode = 'ok';
});

async function cleanup() {
  await client.query(`delete from listings where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from poll_runs where source_id = $1`, [SOURCE_ID]);
  await client.query(`delete from sources where id = $1`, [SOURCE_ID]);
}

after(async () => {
  await cleanup();
  await client.end();
});

test('a source just polled is not due again on the next tick', async () => {
  assert.ok((await due()).includes(SOURCE_ID), 'a source never polled is due');

  await poll();

  assert.ok(
    !(await due()).includes(SOURCE_ID),
    'six hours were configured, and the cron fires every fifteen minutes',
  );
});

test('a rate limit records a cooldown from what the shop asked for', async () => {
  state.mode = 'limited';                       // Retry-After: 600
  const result = await poll();

  assert.equal(result.ok, false, 'page one limited, so nothing was collected');
  assert.equal(result.cooldownMinutes, 10, 'ten minutes, which is what it asked for');

  const { rows } = await client.query(
    `select cooldown_until > now() as cooling from sources where id = $1`,
    [SOURCE_ID],
  );
  assert.equal(rows[0].cooling, true);
});

test('a rate limit with no Retry-After still records one', async () => {
  // No number given is not no cooldown — that reading is what kept the poller
  // coming back every fifteen minutes.
  state.mode = 'limitedNoHeader';
  const result = await poll();
  assert.ok(result.cooldownMinutes >= 5, 'a default long enough to matter');
});

test('the cooldown outlasts the cadence, so the next tick still skips it', async () => {
  // The property that actually stops the hammering: even a source due by its
  // own interval is left alone while it is cooling.
  state.mode = 'limited';
  await poll();

  // Make it due by cadence, leaving only the cooldown in the way.
  await client.query(
    `update poll_runs set started_at = now() - interval '30 days' where source_id = $1`,
    [SOURCE_ID],
  );

  assert.ok(!(await due()).includes(SOURCE_ID), 'still cooling, so still skipped');

  await client.query(`update sources set cooldown_until = now() - interval '1 minute' where id = $1`, [SOURCE_ID]);
  assert.ok((await due()).includes(SOURCE_ID), 'and due again once it passes');
});

test('a good poll after a cooldown clears nothing it should not', async () => {
  state.mode = 'limited';
  await poll();
  await client.query(`update sources set cooldown_until = null where id = $1`, [SOURCE_ID]);

  state.mode = 'ok';
  const result = await poll();
  assert.equal(result.ok, true);
  assert.equal(result.cooldownMinutes, undefined, 'a poll that worked sets no cooldown');

  const { rows } = await client.query(
    `select cooldown_until from sources where id = $1`, [SOURCE_ID],
  );
  assert.equal(rows[0].cooldown_until, null);
});
