import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priceMomentum, turnoverVelocity, supplyTrend, attentionTrend,
  heatScore, describeHeat, MIN_OBSERVATIONS, WEIGHTS,
} from '../src/lib/heat.mjs';

const NOW = new Date('2026-09-04T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

const obs = (price, days, over = {}) => ({
  price_base: price, date_seen: daysAgo(days), source_role: 'exit', ...over,
});

// --- price momentum ----------------------------------------------------------

test('rising exit prices register as positive momentum', () => {
  const r = priceMomentum(
    [obs(1000, 50), obs(1050, 45), obs(980, 40), obs(1300, 10), obs(1350, 5), obs(1280, 2)],
    { now: NOW },
  );
  assert.equal(r.sufficient, true);
  assert.ok(r.change > 0.2, `expected a clear rise, got ${r.change}`);
});

test('falling exit prices register as negative momentum', () => {
  const r = priceMomentum(
    [obs(1300, 50), obs(1350, 45), obs(1280, 40), obs(900, 10), obs(950, 5), obs(880, 2)],
    { now: NOW },
  );
  assert.ok(r.change < -0.2);
});

test('acquisition prices are excluded from momentum', () => {
  const rows = [
    obs(1000, 50), obs(1050, 45), obs(980, 40),
    obs(300, 10, { source_role: 'acquisition' }),
    obs(310, 5, { source_role: 'acquisition' }),
    obs(305, 2, { source_role: 'acquisition' }),
  ];
  const r = priceMomentum(rows, { now: NOW });
  assert.equal(r.sufficient, false, 'no exit data in the recent window means no trend');
});

test('momentum refuses below the observation minimum', () => {
  const r = priceMomentum([obs(1000, 40), obs(1200, 5)], { now: NOW });
  assert.equal(r.sufficient, false);
  assert.match(r.reason, new RegExp(String(MIN_OBSERVATIONS)));
  assert.equal(r.change, null);
});

test('momentum refuses when one window is empty', () => {
  const rows = Array.from({ length: 8 }, (_, i) => obs(1000, i + 1));
  assert.equal(priceMomentum(rows, { now: NOW }).sufficient, false);
});

// --- turnover ----------------------------------------------------------------

const closed = (seenDays, goneDays) => ({
  status: 'delisted', first_seen: daysAgo(seenDays),
  date_seen: daysAgo(goneDays), closed_at: daysAgo(goneDays),
});

test('fast turnover is measured from listings that actually closed', () => {
  const r = turnoverVelocity([closed(20, 17), closed(30, 26), closed(15, 12), { status: 'active', first_seen: daysAgo(2), date_seen: daysAgo(2) }]);
  assert.equal(r.sufficient, true);
  assert.ok(r.medianDaysListed <= 5);
  assert.equal(r.closed, 3);
  assert.equal(r.active, 1);
});

test('turnover refuses on too few closed listings', () => {
  const r = turnoverVelocity([closed(20, 17), { status: 'active', first_seen: daysAgo(2), date_seen: daysAgo(2) }]);
  assert.equal(r.sufficient, false);
  assert.equal(r.medianDaysListed, null);
});

test('a row with no first_seen is discarded rather than counted as zero dwell', () => {
  const r = turnoverVelocity([closed(20, 17), closed(30, 26), closed(15, 12),
    { status: 'delisted', date_seen: daysAgo(5), closed_at: daysAgo(5) }]);
  assert.equal(r.closed, 3);
});

test('a listing closed before it was seen is discarded, not counted negative', () => {
  const r = turnoverVelocity([closed(10, 20), closed(20, 18), closed(30, 28), closed(15, 13)]);
  assert.equal(r.closed, 3, 'the impossible row must be dropped');
  assert.ok(r.medianDaysListed > 0);
});

// --- supply ------------------------------------------------------------------

test('more listings recently than before is rising supply', () => {
  const rows = [
    { date_seen: daysAgo(50) }, { date_seen: daysAgo(45) },
    { date_seen: daysAgo(10) }, { date_seen: daysAgo(8) },
    { date_seen: daysAgo(5) }, { date_seen: daysAgo(2) },
  ];
  const r = supplyTrend(rows, { now: NOW });
  assert.equal(r.sufficient, true);
  assert.ok(r.change > 0);
});

test('a piece appearing for the first time is new supply, not infinite growth', () => {
  const rows = [
    { date_seen: daysAgo(10) }, { date_seen: daysAgo(8) },
    { date_seen: daysAgo(5) }, { date_seen: daysAgo(2) },
  ];
  const r = supplyTrend(rows, { now: NOW });
  assert.equal(r.sufficient, true);
  assert.equal(r.change, 1);
  assert.ok(Number.isFinite(r.change));
});

// --- attention ---------------------------------------------------------------

const series = (values) =>
  values.map((v, i) => ({ value: v, period_start: daysAgo(values.length - i) }));

test('a rising attention series is detected', () => {
  const r = attentionTrend(series([100, 110, 95, 120, 200, 260, 240, 300, 320]));
  assert.equal(r.sufficient, true);
  assert.ok(r.change > 1, `expected a strong rise, got ${r.change}`);
});

test('attention refuses on too few points', () => {
  const r = attentionTrend(series([100, 200, 300]));
  assert.equal(r.sufficient, false);
  assert.equal(r.change, null);
});

test('a zero baseline is refused rather than dividing by it', () => {
  const r = attentionTrend(series([0, 0, 0, 50, 100, 150, 200, 250, 300]));
  assert.equal(r.sufficient, false);
  assert.match(r.reason, /baseline/);
});

// --- combined ----------------------------------------------------------------

const sufficientPrice = (change) => ({ sufficient: true, change });
const sufficientTurnover = (days) => ({ sufficient: true, medianDaysListed: days });

test('a hot piece scores above a cold one', () => {
  const hot = heatScore({
    price: sufficientPrice(0.4), turnover: sufficientTurnover(6),
    attention: { sufficient: true, change: 1.2 }, supply: { sufficient: true, change: 0.3 },
  });
  const cold = heatScore({
    price: sufficientPrice(-0.3), turnover: sufficientTurnover(90),
    attention: { sufficient: true, change: -0.4 }, supply: { sufficient: true, change: -0.2 },
  });
  assert.ok(hot.score > 0.7, `hot scored ${hot.score}`);
  assert.ok(cold.score < 0.3, `cold scored ${cold.score}`);
});

test('missing components are omitted and weights renormalised, never scored zero', () => {
  const priceOnly = heatScore({ price: sufficientPrice(0.4) });
  assert.equal(priceOnly.sufficient, true);
  assert.equal(priceOnly.componentsUsed, 1);
  assert.ok(priceOnly.score > 0.5, 'a positive component must not be dragged down by absent ones');
  assert.ok(priceOnly.coverage < 1, 'thin coverage must be reported');
});

test('coverage reflects how much of the model actually had data', () => {
  const all = heatScore({
    price: sufficientPrice(0.1), turnover: sufficientTurnover(20),
    attention: { sufficient: true, change: 0.1 }, supply: { sufficient: true, change: 0.1 },
  });
  assert.equal(all.coverage, 1);
  assert.equal(all.componentsUsed, 4);
});

test('with no usable component it refuses rather than returning a middling score', () => {
  const r = heatScore({ price: { sufficient: false }, turnover: { sufficient: false } });
  assert.equal(r.sufficient, false);
  assert.equal(r.score, null);
});

test('every component is traceable in the output', () => {
  const r = heatScore({ price: sufficientPrice(0.4), turnover: sufficientTurnover(6) });
  assert.deepEqual(r.parts.map((p) => p.key).sort(), ['price', 'turnover']);
  assert.ok(r.parts.every((p) => typeof p.detail === 'string'));
  assert.ok(r.parts.every((p) => p.share > 0 && p.share <= 1));
});

test('price carries the most weight and supply the least', () => {
  assert.ok(WEIGHTS.price > WEIGHTS.attention);
  assert.ok(WEIGHTS.supply < WEIGHTS.turnover);
});

test('the label matches the score band', () => {
  assert.equal(describeHeat({ sufficient: true, score: 0.8 }), 'rising');
  assert.equal(describeHeat({ sufficient: true, score: 0.5 }), 'flat');
  assert.equal(describeHeat({ sufficient: true, score: 0.2 }), 'cooling');
  assert.equal(describeHeat({ sufficient: false }), 'insufficient data');
});

// --- who is making this request ---------------------------------------------
//
// The pageviews adapter returned 403 live for weeks and it was never the
// adapter. PROBE_CONTACT defaulted to the string "contact not set" across four
// callers; the adapter's guard was `if (!contact)`, which that string passes.
// So the request went out under a User-Agent that had been given a slot to
// identify itself in and had written a placeholder into it — and Wikimedia's
// policy exists precisely to make a client reachable, so it answered 403.

test('a contact has to be something a person could be reached at', async () => {
  const { usableContact, userAgent } = await import('../src/lib/userAgent.mjs');

  // The exact string that caused it, and its siblings.
  for (const bad of ['contact not set', 'set PROBE_CONTACT to your email', 'TODO', 'none', '', '   ']) {
    assert.equal(usableContact(bad), false, JSON.stringify(bad));
    assert.equal(userAgent(bad), null, 'and no User-Agent is built from it');
  }

  // undefined and null are tested through usableContact only. userAgent
  // defaults its argument to process.env.PROBE_CONTACT, so passing undefined
  // asks the environment rather than the function — and this suite runs in
  // whatever environment it is handed. That is a test that reports on the
  // machine instead of on the code, which is how the same shape of mistake
  // made two gate tests fail earlier in this project under a shell that
  // happened to export APP_BIND.
  for (const missing of [undefined, null]) {
    assert.equal(usableContact(missing), false, String(missing));
  }
  for (const good of ['a@b.co', 'mailto:a@b.co', 'https://example.com/me']) {
    assert.equal(usableContact(good), true, good);
    assert.match(userAgent(good), /resale-tracker/);
  }
});

test('an unset PROBE_CONTACT yields no User-Agent, and a set one does', async (t) => {
  const { userAgent } = await import('../src/lib/userAgent.mjs');
  const original = process.env.PROBE_CONTACT;
  t.after(() => {
    if (original === undefined) delete process.env.PROBE_CONTACT;
    else process.env.PROBE_CONTACT = original;
  });

  delete process.env.PROBE_CONTACT;
  assert.equal(userAgent(), null, 'nothing to identify with');

  process.env.PROBE_CONTACT = 'contact not set';
  assert.equal(userAgent(), null, 'and a placeholder is still nothing');

  process.env.PROBE_CONTACT = 'someone@example.com';
  assert.match(userAgent(), /mailto:someone@example\.com/);
});

test('an email is written as a mailto so it reads as an address', async () => {
  const { userAgent } = await import('../src/lib/userAgent.mjs');
  assert.match(userAgent('a@b.co'), /mailto:a@b\.co/);
  // And an address that already says so is not doubled.
  assert.match(userAgent('mailto:a@b.co'), /\(personal price tracker; mailto:a@b\.co\)/);
});

test('the pageviews adapter refuses a placeholder contact before sending anything', async () => {
  const { fetchPageviews } = await import('../src/lib/adapters/wikipediaPageviews.mjs');
  let called = false;
  const result = await fetchPageviews({
    title: 'Yohji Yamamoto',
    contact: 'contact not set',
    fetchImpl: async () => { called = true; throw new Error('must not be reached'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /email or a URL/);
  assert.equal(called, false, 'an unidentifiable request must not go out at all');
});

test('a 403 shows what was sent and what came back, and invents no reason', async () => {
  const { fetchPageviews } = await import('../src/lib/adapters/wikipediaPageviews.mjs');
  const forbid = (body) => async () => ({ ok: false, status: 403, text: async () => body });

  // Reporting "HTTP 403" is what let this sit unexplained across several rounds
  // of review — the number and none of the reason.
  const policy = await fetchPageviews({
    title: 'Yohji Yamamoto', contact: 'a@b.co',
    fetchImpl: forbid('Please use a descriptive User-Agent with contact information'),
  });
  assert.match(policy.error, /mailto:a@b\.co/, 'the User-Agent actually sent');
  assert.match(policy.error, /User-Agent/);
  assert.match(policy.error, /PROBE_CONTACT/);

  // And the trap: a 403 from a network in between has nothing to do with
  // Wikimedia's policy, and blaming the header would send you to fix something
  // that was already right.
  const proxied = await fetchPageviews({
    title: 'Yohji Yamamoto', contact: 'a@b.co',
    fetchImpl: forbid('Host not in allowlist: wikimedia.org. Add this host to your network egress settings.'),
  });
  assert.match(proxied.error, /network between you and Wikimedia/);
  assert.doesNotMatch(proxied.error, /set PROBE_CONTACT to an email/);
});

test('no script builds a User-Agent by hand any more', async () => {
  // The defect was four copies of the same fabricated string, so the standing
  // check is that there is one builder.
  const { readdirSync, readFileSync } = await import('node:fs');
  const offenders = [];
  for (const dir of ['scripts', 'src/lib', 'src/lib/adapters', 'src/app/api/cron/poll']) {
    let names;
    try { names = readdirSync(new URL(`../${dir}`, import.meta.url)); } catch { continue; }
    for (const name of names) {
      if (!/\.(mjs|ts)$/.test(name)) continue;
      // Comments stripped first: the module that documents this pattern
      // describes the string it exists to prevent, and must not trip its own
      // check.
      const src = readFileSync(new URL(`../${dir}/${name}`, import.meta.url), 'utf8')
        .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      if (/PROBE_CONTACT\s*\?\?\s*['"]/.test(src)) offenders.push(`${dir}/${name}`);
    }
  }
  assert.deepEqual(offenders, [], 'a fabricated contact fallback is a header that lies');
});

// --- collecting must never stop for want of a contact ------------------------
//
// Fixing the fabricated contact by making it a hard exit was worse than the
// bug: `npm run poll` and `npm run discover` began refusing outright, so
// nothing was collected and no shop was ever added — which reads exactly like
// every source disappearing, and did.
//
// Three states, not two. A contact is best; none is acceptable for a shop that
// never asked; a FABRICATED one is never acceptable, because a header that
// claims to identify you and does not is worse than one making no claim.

test('with no contact, collection continues under a header that claims nothing', async () => {
  const { collectingUserAgent } = await import('../src/lib/userAgent.mjs');

  const { ua, anonymous } = collectingUserAgent('');
  assert.equal(anonymous, true);
  assert.ok(ua, 'there is still a User-Agent — collection does not stop');
  // And it makes no claim it cannot keep.
  assert.doesNotMatch(ua, /contact not set|mailto:|set PROBE_CONTACT/i);
  assert.doesNotMatch(ua, /;/, 'no contact clause at all, rather than an empty one');

  const identified = collectingUserAgent('a@b.co');
  assert.equal(identified.anonymous, false);
  assert.match(identified.ua, /mailto:a@b\.co/);
});

test('no collecting script exits when PROBE_CONTACT is missing', async () => {
  // The regression, as a standing check. These four run on a schedule and
  // gather everything the platform has; a refusal in any of them is silent
  // afterwards, because an empty screen looks the same either way.
  const { readFileSync } = await import('node:fs');
  const offenders = [];
  for (const name of ['poll.mjs', 'discover.mjs', 'fx.mjs', 'probe-shops.mjs']) {
    const src = readFileSync(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
    // A process.exit in the contact check specifically: the file may exit for
    // other reasons (a bad flag, no database), which is fine.
    if (/NO_CONTACT\b[\s\S]{0,200}?process\.exit\(1\)/.test(src)) offenders.push(name);
    if (!/collectingUserAgent/.test(src)) offenders.push(`${name} (not using the shared builder)`);
  }
  assert.deepEqual(offenders, []);
});
