import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRule, latencyFor, formatLatency } from '../src/lib/alerting.mjs';
import { buildEmbed, send } from '../src/lib/notifiers/discord.mjs';

const rule = (over = {}) => ({
  id: 'r1', enabled: true, min_profit_base: 100,
  include_provisional: false, include_flagged: true,
  channel: 'discord', webhook_url: 'https://discord.test/hook', mode: 'realtime',
  ...over,
});

const score = (over = {}) => ({
  scored: true, profit: 500, spreadPct: 0.8, confidence: 0.5,
  price: 300, provisional: false, flags: [],
  route: { id: 'jp_to_grailed', display_name: 'Japan (proxy) → Grailed' },
  cost: { total: 481 }, proceeds: { total: 998 },
  resale: { value: 1150, comps: 4 }, dataAgeDays: 4,
  ...over,
});

// --- rule evaluation ---------------------------------------------------------

test('a score over the profit threshold fires', () => {
  const r = evaluateRule(score(), rule());
  assert.equal(r.fires, true);
  assert.match(r.reason, /profit/);
});

test('a score under the threshold does not fire, and says why', () => {
  const r = evaluateRule(score({ profit: 20 }), rule());
  assert.equal(r.fires, false);
  assert.match(r.reason, /profit below 100/);
});

test('a disabled rule never fires', () => {
  assert.equal(evaluateRule(score(), rule({ enabled: false })).fires, false);
});

test('an unscored listing never fires', () => {
  assert.equal(evaluateRule({ scored: false, flags: [] }, rule()).fires, false);
});

test('provisional scores are excluded by default', () => {
  const r = evaluateRule(score({ provisional: true }), rule());
  assert.equal(r.fires, false);
  assert.match(r.reason, /provisional/);
});

test('provisional scores fire when the rule opts in', () => {
  assert.equal(evaluateRule(score({ provisional: true }), rule({ include_provisional: true })).fires, true);
});

test('flagged scores fire by default — they are worth knowing about', () => {
  const flagged = score({ flags: [{ kind: 'steep_discount', severity: 'high', message: 'x' }] });
  assert.equal(evaluateRule(flagged, rule()).fires, true);
});

test('a rule can exclude flagged scores', () => {
  const flagged = score({ flags: [{ kind: 'steep_discount', severity: 'high', message: 'x' }] });
  const r = evaluateRule(flagged, rule({ include_flagged: false }));
  assert.equal(r.fires, false);
  assert.match(r.reason, /high-severity/);
});

test('a medium-severity flag does not trip the flagged exclusion', () => {
  const noted = score({ flags: [{ kind: 'thin_comps', severity: 'medium', message: 'x' }] });
  assert.equal(evaluateRule(noted, rule({ include_flagged: false })).fires, true);
});

test('spread and confidence thresholds are enforced', () => {
  assert.equal(evaluateRule(score({ spreadPct: 0.1 }), rule({ min_profit_base: null, min_spread_pct: 0.5 })).fires, false);
  assert.equal(evaluateRule(score({ confidence: 0.1 }), rule({ min_profit_base: null, min_confidence: 0.4 })).fires, false);
  assert.equal(evaluateRule(score(), rule({ min_profit_base: null, min_confidence: 0.4 })).fires, true);
});

test('a rule with no thresholds is treated as misconfigured, not as match-all', () => {
  const r = evaluateRule(score(), rule({ min_profit_base: null }));
  assert.equal(r.fires, false, 'a firehose is not an alert');
  assert.match(r.reason, /no thresholds/);
});

test('narrowing by sub-line, source and route all apply', () => {
  const listing = { subline_id: 'cdg-homme-plus', source_id: 'manual_other' };
  assert.equal(evaluateRule(score(), rule({ subline_id: 'cdg-shirt' }), listing).fires, false);
  assert.equal(evaluateRule(score(), rule({ subline_id: 'cdg-homme-plus' }), listing).fires, true);
  assert.equal(evaluateRule(score(), rule({ source_id: 'therealreal' }), listing).fires, false);
  assert.equal(evaluateRule(score(), rule({ route_id: 'trr_to_grailed' }), listing).fires, false);
  assert.equal(evaluateRule(score(), rule({ route_id: 'jp_to_grailed' }), listing).fires, true);
});

// --- latency -----------------------------------------------------------------

test('latency prefers the source publish time when it exists', () => {
  const sent = new Date('2026-09-04T12:00:00Z');
  const l = latencyFor(
    { date_seen: '2026-09-04T11:59:00Z', source_published_at: '2026-09-04T11:00:00Z' },
    sent,
  );
  assert.equal(l.observedToSent, 60);
  assert.equal(l.publishedToSent, 3600);
  assert.equal(l.best, 3600, 'the honest clock includes how long we took to notice');
  assert.equal(l.basis, 'source publish time');
});

test('without a publish time it measures from our own sighting, and says so', () => {
  const l = latencyFor({ date_seen: '2026-09-04T11:59:00Z' }, new Date('2026-09-04T12:00:00Z'));
  assert.equal(l.publishedToSent, null);
  assert.equal(l.best, 60);
  assert.equal(l.basis, 'our first sighting');
});

test('latency never goes negative on clock skew', () => {
  const l = latencyFor({ date_seen: '2026-09-04T12:05:00Z' }, new Date('2026-09-04T12:00:00Z'));
  assert.equal(l.best, 0);
});

test('latency formats at human scales', () => {
  assert.equal(formatLatency(45), '45s');
  assert.equal(formatLatency(600), '10m');
  assert.equal(formatLatency(7200), '2.0h');
  assert.equal(formatLatency(null), 'unknown');
});

// --- discord -----------------------------------------------------------------

test('the embed carries item, price, spread and a link', () => {
  const e = buildEmbed({
    listing: { title_raw: 'CDG Homme Plus AD2002 jacket', url: 'https://example.test/x', source_name: 'Yahoo' },
    score: score(),
    latency: { best: 60, label: '60s', basis: 'our first sighting' },
  });
  assert.match(e.title, /Homme Plus/);
  assert.equal(e.url, 'https://example.test/x');
  const profit = e.fields.find((f) => f.name === 'Profit');
  assert.match(profit.value, /€500/);
  assert.match(profit.value, /80%/);
});

test('a flagged score is coloured for verification and lists its flags', () => {
  const e = buildEmbed({
    listing: { title_raw: 'x' },
    score: score({ flags: [{ kind: 'steep_discount', severity: 'high', message: 'Priced 74% below.' }] }),
  });
  assert.equal(e.color, 0xb3341f);
  assert.ok(e.fields.some((f) => f.name.includes('Verify')));
});

test('a provisional score is coloured distinctly and labelled', () => {
  const e = buildEmbed({ listing: { title_raw: 'x' }, score: score({ provisional: true }) });
  assert.equal(e.color, 0x8a5e12);
  assert.match(e.fields.find((f) => f.name === 'Evidence').value, /PROVISIONAL/);
});

test('proxy links appear when supplied', () => {
  const e = buildEmbed({
    listing: { title_raw: 'x' },
    score: score(),
    proxyLinks: [{ id: 'buyee', label: 'Buyee', href: 'https://buyee.test/1' }],
  });
  assert.match(e.fields.find((f) => f.name === 'Buy via proxy').value, /Buyee/);
});

test('over-long titles are truncated to Discord limits', () => {
  const e = buildEmbed({ listing: { title_raw: 'x'.repeat(500) }, score: score() });
  assert.ok(e.title.length <= 256);
});

test('delivery posts and reports success', async () => {
  const calls = [];
  const r = await send({
    webhookUrl: 'https://discord.test/hook',
    embeds: [{ title: 'a' }],
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { status: 204, text: async () => '' }; },
  });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).embeds.length, 1);
});

test('more than ten embeds are split into batches', async () => {
  let posts = 0;
  const r = await send({
    webhookUrl: 'https://discord.test/hook',
    embeds: Array.from({ length: 23 }, (_, i) => ({ title: String(i) })),
    fetchImpl: async () => { posts++; return { status: 204, text: async () => '' }; },
  });
  assert.equal(r.ok, true);
  assert.equal(posts, 3, 'Discord caps embeds at 10 per message');
});

test('a 429 is retried after the interval Discord asks for', async () => {
  let posts = 0;
  const waits = [];
  const r = await send({
    webhookUrl: 'https://discord.test/hook',
    embeds: [{ title: 'a' }],
    sleep: async (ms) => { waits.push(ms); },
    fetchImpl: async () => {
      posts++;
      if (posts === 1) return { status: 429, text: async () => JSON.stringify({ retry_after: 1.5 }) };
      return { status: 204, text: async () => '' };
    },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(waits, [1500]);
});

test('a hard failure is reported rather than swallowed', async () => {
  const r = await send({
    webhookUrl: 'https://discord.test/hook',
    embeds: [{ title: 'a' }],
    fetchImpl: async () => ({ status: 500, text: async () => '' }),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /500/);
});

test('a missing webhook fails cleanly instead of posting nowhere', async () => {
  const r = await send({ webhookUrl: null, embeds: [] });
  assert.equal(r.ok, false);
});

// --- what an alert is allowed to push ---------------------------------------

test('a margin resting only on asking prices does not send a notification', () => {
  // A screen you chose to look at can carry a caveat beside a number. A push
  // notification cannot — it reads as "act on this now" — so the fabricated
  // margin the opportunities screen already holds back must not arrive by
  // another door.
  const verdict = evaluateRule(
    { scored: true, profit: 500, evidenceBasis: 'asks_only', flags: [] },
    { enabled: true, min_profit_base: 100 },
  );
  assert.equal(verdict.fires, false);
  assert.match(verdict.reason, /asking prices/);
});

test('a rule may opt back in, explicitly', () => {
  const verdict = evaluateRule(
    { scored: true, profit: 500, evidenceBasis: 'asks_only', flags: [] },
    { enabled: true, min_profit_base: 100, include_asks_only: true },
  );
  assert.equal(verdict.fires, true);
});

test('a piece that vanished at a price is evidence enough to alert on', () => {
  const verdict = evaluateRule(
    { scored: true, profit: 500, evidenceBasis: 'disappearances', flags: [] },
    { enabled: true, min_profit_base: 100 },
  );
  assert.equal(verdict.fires, true);
});

test('a recorded sale alerts, of course', () => {
  const verdict = evaluateRule(
    { scored: true, profit: 500, evidenceBasis: 'confirmed_sales', flags: [] },
    { enabled: true, min_profit_base: 100 },
  );
  assert.equal(verdict.fires, true);
});
