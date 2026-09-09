// Alert delivery against a real database, with a fake webhook.
//
// The properties under test are the ones that decide whether you can trust the
// alerts: no duplicates, no silent drops, and a re-price alerting again.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAlerts } from '../src/lib/alertRunner.mjs';

const RULE_ID = 'test_rule';
const SOURCE_ID = 'test_alert_src';
const EXIT_ID = 'test_alert_exit';
let client;
let posts = [];

const fakeFetch = (status = 204) => async (url, init) => {
  posts.push({ url, body: JSON.parse(init.body) });
  return { status, text: async () => '' };
};

const ROUTES = [{
  id: 'test_route', display_name: 'Test → Exit',
  acquisition_source: SOURCE_ID, exit_source: EXIT_ID, active: true,
  proxy_fee_pct: 0, proxy_fee_flat: 0, domestic_ship_flat: 0, intl_ship_flat: 10,
  import_vat_pct: 0, customs_duty_pct: 0,
  sale_fee_pct: 0.1, payment_fee_pct: 0, outbound_ship_flat: 10,
}];

let itemId;
let listingId;

function observationsFor(id) {
  const comp = (price, over = {}) => ({
    price_base: price, evidence: 'active_ask', status: 'active',
    condition_tier: 'excellent', source_role: 'exit',
    date_seen: new Date(), last_verified_at: new Date(), entered_manually: true,
    ...over,
  });
  // At least one piece that actually left the market at a price. Alerts do not
  // fire on asks alone — a push notification reads as "act now", and an ask is
  // nobody's agreement — so a fixture of pure asks would be testing a listing
  // that is correctly ignored rather than the delivery mechanics below.
  return new Map([[id, [
    comp(1000, { evidence: 'inferred_disappearance', status: 'delisted' }),
    comp(1050), comp(980), comp(1020),
  ]]]);
}

async function candidate() {
  const { rows } = await client.query(
    `select l.id, l.item_id, l.title_raw, l.price_base, l.condition_tier::text as condition_tier,
            l.url, l.image_url, l.source_id, l.source_item_id, l.proxy_purchasable,
            l.date_seen, l.source_published_at, l.last_verified_at, l.entered_manually,
            s.display_name as source_name, s.role::text as source_role
       from listings l join sources s on s.id = l.source_id
      where l.id = $1`, [listingId]);
  return rows;
}

let quiesced = [];

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Isolate: runAlerts evaluates every enabled rule, so real rules would fire
  // on the fixture listing and skew every count in this file.
  const { rows } = await client.query(
    `update alert_rules set enabled = false where enabled and id <> $1 returning id`, [RULE_ID]);
  quiesced = rows.map((r) => r.id);
  await client.query(`delete from alert_rules where id = $1`, [RULE_ID]);
  await client.query(`delete from routes where id = 'test_route'`);
  await client.query(`delete from sources where id = any($1)`, [[SOURCE_ID, EXIT_ID]]);

  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed, automation_block_reason)
     values ($1,'Test Buy','manual','acquisition',false,'test'),
            ($2,'Test Sell','manual','exit',false,'test')`,
    [SOURCE_ID, EXIT_ID],
  );
  // The route must exist in the table, not just in memory — alerts carry a
  // foreign key to it so the history stays joinable.
  await client.query(`delete from routes where id = 'test_route'`);
  await client.query(
    `insert into routes (id, display_name, acquisition_source, exit_source, active,
        proxy_fee_pct, proxy_fee_flat, domestic_ship_flat, intl_ship_flat,
        import_vat_pct, customs_duty_pct, sale_fee_pct, payment_fee_pct, outbound_ship_flat)
     values ('test_route','Test → Exit',$1,$2,true,0,0,0,10,0,0,0.1,0,10)`,
    [SOURCE_ID, EXIT_ID],
  );

  const item = await client.query(
    `insert into items (brand_id, subline_id, canonical_name, ad_year, ad_year_status, identity_key)
     values ('cdg','cdg-homme-plus','alert test jacket',2002,'known','test-alert|ad2002|jacket|wool')
     returning id`);
  itemId = item.rows[0].id;

  const listing = await client.query(
    `insert into listings (item_id, source_id, title_raw, price, currency, price_base,
       fx_rate_at_snapshot, condition_tier, status, evidence, entered_manually,
       last_verified_at, date_seen)
     values ($1,$2,'CDG Homme Plus AD2002 alert test',300,'EUR',300,1,'excellent',
             'active','active_ask',true, now(), now()) returning id`,
    [itemId, SOURCE_ID],
  );
  listingId = listing.rows[0].id;
});

after(async () => {
  if (quiesced.length) {
    await client.query(`update alert_rules set enabled = true where id = any($1)`, [quiesced]);
  }
  await client.query(`delete from alerts where rule_id = $1`, [RULE_ID]);
  await client.query(`delete from alert_rules where id = $1`, [RULE_ID]);
  await client.query(`delete from listings where source_id = any($1)`, [[SOURCE_ID, EXIT_ID]]);
  await client.query(`delete from items where id = $1`, [itemId]);
  await client.query(`delete from routes where id = 'test_route'`);
  await client.query(`delete from sources where id = any($1)`, [[SOURCE_ID, EXIT_ID]]);
  await client.end();
});

beforeEach(() => { posts = []; });

async function makeRule(over = {}) {
  await client.query(`delete from alerts where rule_id = $1`, [RULE_ID]);
  await client.query(`delete from alert_rules where id = $1`, [RULE_ID]);
  const cols = {
    id: RULE_ID, display_name: 'Test rule', enabled: true,
    min_profit_base: 100, include_provisional: false, include_flagged: true,
    channel: 'discord', webhook_url: 'https://discord.test/hook', mode: 'realtime',
    ...over,
  };
  await client.query(
    `insert into alert_rules (id, display_name, enabled, min_profit_base,
        include_provisional, include_flagged, channel, webhook_url, mode)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [cols.id, cols.display_name, cols.enabled, cols.min_profit_base,
     cols.include_provisional, cols.include_flagged, cols.channel, cols.webhook_url, cols.mode],
  );
}

const run = async (status = 204) =>
  runAlerts({
    client,
    candidates: await candidate(),
    observations: observationsFor(itemId),
    routes: ROUTES,
    fetchImpl: fakeFetch(status),
    sleep: async () => {},
  });

test('a qualifying listing fires once and delivers', async () => {
  await makeRule();
  const s = await run();
  assert.equal(s.fired, 1);
  assert.equal(s.delivered, 1);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.embeds[0].title, /alert test/);
});

test('a second run does not re-alert the same snapshot', async () => {
  const s = await run();
  assert.equal(s.fired, 0, 'the same listing at the same price is not a new event');
  assert.equal(posts.length, 0);
});

test('the alert row records what was true at the time', async () => {
  const { rows } = await client.query(
    `select profit_base, confidence, provisional, route_id, delivery_ok, sent_at, observed_at
       from alerts where rule_id = $1`, [RULE_ID]);
  assert.equal(rows.length, 1);
  assert.ok(Number(rows[0].profit_base) > 0);
  assert.equal(rows[0].delivery_ok, true);
  assert.ok(rows[0].sent_at);
  assert.equal(rows[0].route_id, 'test_route');
});

test('latency is computed and non-negative', async () => {
  const { rows } = await client.query(
    `select observed_to_sent_seconds from alert_latency where rule_id = $1`, [RULE_ID]);
  assert.equal(rows.length, 1);
  assert.ok(Number(rows[0].observed_to_sent_seconds) >= 0);
});

test('a re-priced listing is a new snapshot and alerts again', async () => {
  const repriced = await client.query(
    `insert into listings (item_id, source_id, title_raw, price, currency, price_base,
        fx_rate_at_snapshot, condition_tier, status, evidence, entered_manually,
        last_verified_at, date_seen, supersedes_id)
     select item_id, source_id, title_raw, 250, currency, 250, 1, condition_tier,
            'active','active_ask',true, now(), now(), id
       from listings where id = $1 returning id`, [listingId]);
  const newId = repriced.rows[0].id;
  await client.query(`update listings set status='relisted' where id=$1`, [listingId]);

  const { rows } = await client.query(
    `select l.id, l.item_id, l.title_raw, l.price_base, l.condition_tier::text as condition_tier,
            l.url, l.image_url, l.source_id, l.source_item_id, l.proxy_purchasable,
            l.date_seen, l.source_published_at, l.last_verified_at, l.entered_manually,
            s.display_name as source_name, s.role::text as source_role
       from listings l join sources s on s.id = l.source_id where l.id = $1`, [newId]);

  const s = await runAlerts({
    client, candidates: rows, observations: observationsFor(itemId), routes: ROUTES,
    fetchImpl: fakeFetch(), sleep: async () => {},
  });
  assert.equal(s.fired, 1, 'a genuine price change is a new event');
  await client.query(`delete from alerts where listing_id = $1`, [newId]);
  await client.query(`delete from listings where id = $1`, [newId]);
  await client.query(`update listings set status='active' where id=$1`, [listingId]);
});

test('a delivery failure is recorded rather than swallowed', async () => {
  await makeRule();
  const s = await run(500);
  assert.equal(s.fired, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.delivered, 0);
  const { rows } = await client.query(
    `select delivery_ok, delivery_error, sent_at from alerts where rule_id = $1`, [RULE_ID]);
  assert.equal(rows[0].delivery_ok, false);
  assert.match(rows[0].delivery_error, /500/);
  assert.equal(rows[0].sent_at, null, 'a failed send must not claim a sent time');
});

test('a rule below threshold fires nothing', async () => {
  await makeRule({ min_profit_base: 100000 });
  const s = await run();
  assert.equal(s.fired, 0);
  assert.equal(posts.length, 0);
});

test('a disabled rule is not even considered', async () => {
  await makeRule({ enabled: false });
  const s = await run();
  assert.equal(s.rules, 0);
});

test('digest mode sends one message for the batch', async () => {
  await makeRule({ mode: 'digest' });
  const s = await run();
  assert.equal(s.fired, 1);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.content, /Test rule/);
  assert.match(posts[0].body.content, /1 item/);
});

test('channel "none" records without notifying — useful while tuning', async () => {
  await makeRule({ channel: 'none', webhook_url: null });
  const s = await run();
  assert.equal(s.fired, 1);
  assert.equal(s.delivered, 1);
  assert.equal(posts.length, 0, 'nothing may be sent on channel none');
});
