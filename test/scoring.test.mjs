import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  landedCost,
  netProceeds,
  resaleEstimate,
  scoreOpportunity,
  scoreAllRoutes,
  STEEP_DISCOUNT_RATIO,
} from '../src/lib/scoring.mjs';

const NOW = new Date('2026-09-04T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

const JP_ROUTE = {
  id: 'jp_to_grailed',
  acquisition_source: 'manual_other',
  exit_source: 'grailed',
  proxy_fee_pct: 0.05, proxy_fee_flat: 3,
  domestic_ship_flat: 7, intl_ship_flat: 35,
  import_vat_pct: 0.21, customs_duty_pct: 0.12,
  sale_fee_pct: 0.09, payment_fee_pct: 0.029, outbound_ship_flat: 15,
};

const DOMESTIC_ROUTE = {
  id: 'trr_to_grailed',
  acquisition_source: 'therealreal',
  exit_source: 'grailed',
  proxy_fee_pct: 0, proxy_fee_flat: 0,
  domestic_ship_flat: 0, intl_ship_flat: 25,
  import_vat_pct: 0.21, customs_duty_pct: 0.12,
  sale_fee_pct: 0.09, payment_fee_pct: 0.029, outbound_ship_flat: 15,
};

const comp = (price, over = {}) => ({
  price_base: price,
  evidence: 'active_ask',
  status: 'active',
  condition_tier: 'excellent',
  source_role: 'exit',
  date_seen: daysAgo(5),
  last_verified_at: daysAgo(5),
  entered_manually: true,
  ...over,
});

const listing = (over = {}) => ({
  price_base: 300,
  condition_tier: 'excellent',
  source_id: 'manual_other',
  date_seen: daysAgo(1),
  last_verified_at: daysAgo(1),
  entered_manually: true,
  ...over,
});

// --- cost stack --------------------------------------------------------------

test('landed cost charges VAT on goods plus freight plus duty, not on the bare price', () => {
  const c = landedCost(100, JP_ROUTE);
  // dutiable = 100 + 35 = 135; duty = 16.20; vat = 0.21 * 151.20 = 31.752
  assert.equal(c.breakdown.customsDuty, 16.2);
  assert.equal(c.breakdown.importVat, 31.75);
  // total = 100 + (5 + 3) + 7 + 35 + 16.20 + 31.75
  assert.equal(c.total, 197.95);
});

test('the Japan proxy stack costs far more than the item price suggests', () => {
  const c = landedCost(100, JP_ROUTE);
  assert.ok(c.total > 190, `expected heavy drag, got ${c.total}`);
  // The fees the brief warns about are itemised, not folded into shipping.
  assert.ok(c.breakdown.proxyFee > 0);
  assert.ok(c.breakdown.domesticShip > 0);
  assert.ok(c.breakdown.intlShip > 0);
});

test('a domestic route carries no proxy fee or second shipping leg', () => {
  const c = landedCost(100, DOMESTIC_ROUTE);
  assert.equal(c.breakdown.proxyFee, 0);
  assert.equal(c.breakdown.domesticShip, 0);
  assert.ok(c.total < landedCost(100, JP_ROUTE).total);
});

test('net proceeds subtract commission, payment fee and outbound shipping', () => {
  const p = netProceeds(500, JP_ROUTE);
  // 500 - 45 - 14.50 - 15
  assert.equal(p.total, 425.5);
});

test('an invalid price yields null rather than a plausible number', () => {
  assert.equal(landedCost(NaN, JP_ROUTE), null);
  assert.equal(netProceeds(undefined, JP_ROUTE), null);
});

// --- the direction correction ------------------------------------------------

test('resale value uses exit-source comps and ignores acquisition-source ones', () => {
  const observations = [
    comp(1000), comp(1000), comp(1000),                       // exit venue
    comp(300, { source_role: 'acquisition' }),                 // where you buy
    comp(300, { source_role: 'acquisition' }),
    comp(300, { source_role: 'acquisition' }),
  ];
  const r = resaleEstimate(observations, 'excellent', NOW);
  assert.equal(r.sufficient, true);
  assert.equal(r.comps, 3, 'only the exit comps may count');
  assert.ok(r.value > 900, `acquisition prices must not drag the estimate down, got ${r.value}`);
});

test('acquisition-only comps produce no resale estimate at all', () => {
  const observations = [
    comp(300, { source_role: 'acquisition' }),
    comp(310, { source_role: 'acquisition' }),
    comp(320, { source_role: 'acquisition' }),
  ];
  const r = resaleEstimate(observations, 'excellent', NOW);
  assert.equal(r.sufficient, false);
  assert.equal(r.exitCompsTotal, 0);
});

test('a "both" source counts as an exit venue', () => {
  const observations = [
    comp(900, { source_role: 'both' }),
    comp(900, { source_role: 'both' }),
    comp(900, { source_role: 'both' }),
  ];
  assert.equal(resaleEstimate(observations, 'excellent', NOW).sufficient, true);
});

test('comps from a different condition tier are never borrowed', () => {
  const observations = [comp(1000), comp(1000), comp(1000)];
  const r = resaleEstimate(observations, 'damaged', NOW);
  assert.equal(r.sufficient, false);
  assert.match(r.reason, /no exit-market comps in condition tier "damaged"/);
});

// --- scoring -----------------------------------------------------------------

test('a profitable Japan buy scores positive after the full stack', () => {
  const observations = [comp(1200), comp(1150), comp(1250), comp(1180)];
  const s = scoreOpportunity({ listing: listing({ price_base: 300 }), observations, route: JP_ROUTE, now: NOW });
  assert.equal(s.scored, true);
  assert.ok(s.profit > 0, `expected profit, got ${s.profit}`);
  assert.ok(s.spreadPct > 0);
  assert.equal(s.cost.breakdown.item, 300);
});

test('a marginal-looking spread is killed by the Japan cost stack', () => {
  // 300 in, ~430 resale: looks like a 43% gross spread and is actually a loss.
  const observations = [comp(430), comp(425), comp(435), comp(428)];
  const s = scoreOpportunity({ listing: listing({ price_base: 300 }), observations, route: JP_ROUTE, now: NOW });
  assert.equal(s.scored, true);
  assert.ok(s.profit < 0, `expected the fee stack to eat this, got ${s.profit}`);
});

test('below the minimum it scores provisionally rather than withholding', () => {
  const s = scoreOpportunity({ listing: listing(), observations: [comp(1000), comp(1100)], route: JP_ROUTE, now: NOW });
  assert.equal(s.scored, true, 'a thin signal is shown rather than hidden');
  assert.equal(s.provisional, true);
  assert.ok(Number.isFinite(s.profit));
  const flag = s.flags.find((f) => f.kind === 'provisional_estimate');
  assert.ok(flag, 'a provisional score must carry its own flag');
  assert.equal(flag.severity, 'high');
  assert.equal(s.actionable, false, 'provisional can never be actionable');
});

test('a provisional score is penalised against an equivalent settled one', () => {
  const thin = scoreOpportunity({
    listing: listing(), observations: [comp(1000), comp(1000)], route: JP_ROUTE, now: NOW });
  const settled = scoreOpportunity({
    listing: listing(), observations: [comp(1000), comp(1000), comp(1000), comp(1000)], route: JP_ROUTE, now: NOW });
  assert.ok(
    thin.confidence < settled.confidence,
    `thin ${thin.confidence} should be under settled ${settled.confidence}`,
  );
  assert.equal(thin.resale.settled, false);
  assert.equal(settled.resale.settled, true);
});

test('one comp still scores, and says so plainly', () => {
  const s = scoreOpportunity({ listing: listing(), observations: [comp(1000)], route: JP_ROUTE, now: NOW });
  assert.equal(s.scored, true);
  assert.equal(s.provisional, true);
  assert.match(s.flags.find((f) => f.kind === 'provisional_estimate').message, /Only 1 exit comp\b/);
});

test('zero exit comps is still a refusal — no data is not a thin estimate', () => {
  const s = scoreOpportunity({
    listing: listing(),
    observations: [comp(300, { source_role: 'acquisition' })],
    route: JP_ROUTE, now: NOW,
  });
  assert.equal(s.scored, false);
  assert.equal(s.profit, undefined, 'no number may be produced from nothing');
});

test('a provisional score does not also raise the thin-comps note', () => {
  const s = scoreOpportunity({ listing: listing(), observations: [comp(1000), comp(1100)], route: JP_ROUTE, now: NOW });
  assert.ok(!s.flags.some((f) => f.kind === 'thin_comps'), 'provisional already says this');
});

test('a listing with no base price is not scored', () => {
  const s = scoreOpportunity({
    listing: listing({ price_base: null }),
    observations: [comp(1000), comp(1100), comp(1050)],
    route: JP_ROUTE, now: NOW,
  });
  assert.equal(s.scored, false);
  assert.match(s.reason, /no base-currency price/);
});

test('a steep discount is flagged high severity and never actionable', () => {
  const observations = [comp(1000), comp(1000), comp(1000), comp(1000)];
  const s = scoreOpportunity({ listing: listing({ price_base: 200 }), observations, route: JP_ROUTE, now: NOW });
  assert.ok(s.profit > 0, 'this would otherwise look like a great buy');
  const flag = s.flags.find((f) => f.kind === 'steep_discount');
  assert.ok(flag, 'a >50% discount must be flagged');
  assert.equal(flag.severity, 'high');
  assert.equal(s.actionable, false, 'a high-severity flag must block "actionable"');
});

test('the steep-discount threshold is where it says it is', () => {
  const observations = [comp(1000), comp(1000), comp(1000), comp(1000)];
  const justUnder = scoreOpportunity({
    listing: listing({ price_base: 1000 * STEEP_DISCOUNT_RATIO - 1 }), observations, route: JP_ROUTE, now: NOW });
  const justOver = scoreOpportunity({
    listing: listing({ price_base: 1000 * STEEP_DISCOUNT_RATIO + 1 }), observations, route: JP_ROUTE, now: NOW });
  assert.ok(justUnder.flags.some((f) => f.kind === 'steep_discount'));
  assert.ok(!justOver.flags.some((f) => f.kind === 'steep_discount'));
});

test('stale comps are flagged and block actionability', () => {
  const old = { date_seen: daysAgo(300), last_verified_at: daysAgo(300) };
  const observations = [comp(1200, old), comp(1150, old), comp(1250, old), comp(1180, old)];
  const s = scoreOpportunity({ listing: listing({ price_base: 300 }), observations, route: JP_ROUTE, now: NOW });
  assert.ok(s.flags.some((f) => f.kind === 'stale_comps'));
  assert.equal(s.actionable, false);
});

test('an unverified acquisition price is flagged', () => {
  const observations = [comp(1200), comp(1150), comp(1250), comp(1180)];
  const s = scoreOpportunity({
    listing: listing({ price_base: 300, last_verified_at: daysAgo(45), date_seen: daysAgo(45) }),
    observations, route: JP_ROUTE, now: NOW,
  });
  assert.ok(s.flags.some((f) => f.kind === 'stale_listing'));
  assert.equal(s.actionable, false);
});

test('an estimate resting only on asking prices says so', () => {
  const observations = [comp(1200), comp(1150), comp(1250), comp(1180)];
  const s = scoreOpportunity({ listing: listing({ price_base: 300 }), observations, route: JP_ROUTE, now: NOW });
  assert.ok(s.flags.some((f) => f.kind === 'no_confirmed_sales'));
});

test('confirmed sales remove the asking-price caveat and lift confidence', () => {
  const sold = { evidence: 'confirmed_sale', status: 'sold_confirmed' };
  const asks = [comp(1200), comp(1150), comp(1250), comp(1180)];
  const sales = [comp(1200, sold), comp(1150, sold), comp(1250, sold), comp(1180, sold)];
  const a = scoreOpportunity({ listing: listing({ price_base: 300 }), observations: asks, route: JP_ROUTE, now: NOW });
  const b = scoreOpportunity({ listing: listing({ price_base: 300 }), observations: sales, route: JP_ROUTE, now: NOW });
  assert.ok(!b.flags.some((f) => f.kind === 'no_confirmed_sales'));
  assert.ok(b.confidence > a.confidence);
});

test('scoring picks the best route and reports the alternatives', () => {
  const observations = [comp(1200), comp(1150), comp(1250), comp(1180)];
  const routes = [
    JP_ROUTE,
    { ...JP_ROUTE, id: 'jp_to_vestiaire', exit_source: 'vestiaire', sale_fee_pct: 0.15, payment_fee_pct: 0.03 },
  ];
  const { best, all } = scoreAllRoutes({ listing: listing({ price_base: 300 }), observations, routes, now: NOW });
  assert.equal(all.length, 2);
  assert.equal(best.route.id, 'jp_to_grailed', 'the lower-commission exit should win here');
  assert.ok(best.profit >= all[1].profit);
});

test('a listing whose source has no route is not scored', () => {
  const observations = [comp(1200), comp(1150), comp(1250), comp(1180)];
  const { best } = scoreAllRoutes({
    listing: listing({ source_id: 'somewhere_else' }), observations, routes: [JP_ROUTE], now: NOW });
  assert.equal(best.scored, false);
  assert.match(best.reason, /no route configured/);
});

test('spread is measured against what you lay out, not the sticker price', () => {
  const observations = [comp(1200), comp(1150), comp(1250), comp(1180)];
  const s = scoreOpportunity({ listing: listing({ price_base: 300 }), observations, route: JP_ROUTE, now: NOW });
  assert.equal(s.spreadPct, s.profit / s.cost.total);
  assert.ok(s.cost.total > 300, 'landed cost must exceed the item price');
});

test('null prices are rejected everywhere, not silently treated as zero', () => {
  assert.equal(landedCost(null, JP_ROUTE), null);
  assert.equal(netProceeds(null, JP_ROUTE), null);
});

// --- listings whose condition nobody stated ---------------------------------
//
// The normal case for an automated feed: a shop's product JSON says what a
// piece is and what it costs, almost never what condition it is in.

test('an unstated condition is valued against the cheapest tier, never the dearest', () => {
  const observations = [
    comp(1200, { condition_tier: 'excellent' }),
    comp(1200, { condition_tier: 'excellent' }),
    comp(1200, { condition_tier: 'excellent' }),
    comp(400, { condition_tier: 'fair' }),
    comp(400, { condition_tier: 'fair' }),
    comp(400, { condition_tier: 'fair' }),
  ];
  const r = resaleEstimate(observations, null, NOW);

  // Assuming mint would overstate profit on a piece that turns out to be
  // thrashed, and that mistake costs real money. Assuming the worst only costs
  // a missed opportunity.
  assert.equal(r.assumedTier, 'fair');
  assert.ok(r.value <= 400, `expected the cheapest tier's median, got ${r.value}`);
});

test('an assumed condition is reported and its confidence cut', () => {
  const tiered = [comp(1000), comp(1000), comp(1000)];
  const stated = resaleEstimate(tiered, 'excellent', NOW);
  const assumed = resaleEstimate(tiered, null, NOW);

  assert.equal(stated.assumedTier, null);
  assert.equal(assumed.assumedTier, 'excellent');
  assert.match(assumed.reason, /condition unstated/);
  // A guess about condition standing in for an observation of it is a weaker
  // claim, and must not read as the same kind of number.
  assert.ok(
    assumed.confidence < stated.confidence,
    `assumed ${assumed.confidence} should be below stated ${stated.confidence}`,
  );
});

test('a stated condition still never borrows a different tier', () => {
  // The fallback is only for listings with NO stated condition. A piece known
  // to be 'fair' must not be priced off mint comps.
  const r = resaleEstimate([comp(1200), comp(1200), comp(1200)], 'fair', NOW);
  assert.equal(r.sufficient, false);
  assert.equal(r.value, null);
});

// --- which venue's comps price the piece ------------------------------------

test('resale is estimated from the venue actually being exited on', () => {
  // The two venues genuinely differ — which is the whole reason this platform
  // exists — and the route charges one venue's fees, so pooling every venue
  // answers a different question than the one being asked.
  const observations = [
    comp(1000, { source_id: 'venue_a' }), comp(1000, { source_id: 'venue_a' }), comp(1000, { source_id: 'venue_a' }),
    comp(400, { source_id: 'venue_b' }), comp(400, { source_id: 'venue_b' }), comp(400, { source_id: 'venue_b' }),
  ];
  const a = resaleEstimate(observations, 'excellent', NOW, 'venue_a');
  const b = resaleEstimate(observations, 'excellent', NOW, 'venue_b');

  assert.equal(a.venueScoped, true);
  assert.equal(b.venueScoped, true);
  assert.ok(a.value > 900, `venue A should price near 1000, got ${a.value}`);
  assert.ok(b.value < 500, `venue B should price near 400, got ${b.value}`);
});

test('a venue without enough comps of its own falls back, and says so', () => {
  const observations = [
    comp(1000, { source_id: 'venue_a' }), comp(1000, { source_id: 'venue_a' }), comp(1000, { source_id: 'venue_a' }),
    comp(400, { source_id: 'venue_b' }),
  ];
  // An approximate answer labelled as one beats no answer at all — but it must
  // never read as though venue B itself produced it.
  const r = resaleEstimate(observations, 'excellent', NOW, 'venue_b');
  assert.equal(r.venueScoped, false);
  assert.ok(r.value != null);
});

test('with no exit venue named, every sellable venue counts', () => {
  const observations = [comp(1000), comp(1000), comp(1000)];
  const r = resaleEstimate(observations, 'excellent', NOW);
  assert.equal(r.venueScoped, false);
  assert.equal(r.comps, 3);
});

test('a venue with no recorded sales is flagged, not silently preferred', () => {
  // Correcting one venue downward from real outcomes ranks it below a venue
  // nobody has sold on — whose estimate is unadjusted, not better. Left
  // unmarked, the ranking would steer every decision toward whichever venue is
  // least understood, and more strongly the more honestly sales were recorded.
  const observations = [comp(1000), comp(1000), comp(1000)];
  const routes = [
    { id: 'r1', acquisition_source: 'shop', exit_source: 'known', sale_fee_pct: 0.09 },
    { id: 'r2', acquisition_source: 'shop', exit_source: 'unknown', sale_fee_pct: 0.09 },
  ];
  const { all } = scoreAllRoutes({
    listing: listing({ source_id: 'shop' }),
    observations,
    routes,
    brandId: 'cdg',
    calibration: new Map([['cdg|known', { observations: 20, ratio: 0.6 }]]),
  });

  const known = all.find((s) => s.route.exit_source === 'known');
  const unknown = all.find((s) => s.route.exit_source === 'unknown');

  assert.equal(known.resale.calibration.applied, true);
  assert.ok(known.resale.value < known.resale.uncalibrated, 'the measured venue is corrected down');
  assert.ok(
    unknown.flags.some((f) => f.kind === 'uncalibrated_venue'),
    'the venue that now outranks it must say why it looks better',
  );
  assert.ok(!known.flags.some((f) => f.kind === 'uncalibrated_venue'));
});

test('with nothing calibrated, no venue is flagged for it', () => {
  const { all } = scoreAllRoutes({
    listing: listing({ source_id: 'shop' }),
    observations: [comp(1000), comp(1000), comp(1000)],
    routes: [{ id: 'r1', acquisition_source: 'shop', exit_source: 'a', sale_fee_pct: 0.09 }],
  });
  assert.ok(!all[0].flags.some((f) => f.kind === 'uncalibrated_venue'));
});

test('an estimate built only from other models says so', () => {
  // The M.A+ case: an accordion bag with no comps of its own, priced from the
  // other bags the house makes. Worth showing — no comps at all tells you
  // nothing — but it prices the category, not the piece.
  const observations = [
    comp(900, { borrowed: true }), comp(1100, { borrowed: true }), comp(1000, { borrowed: true }),
  ];
  const { best } = scoreAllRoutes({
    listing: listing({ source_id: 'shop' }),
    observations,
    routes: [{ id: 'r', acquisition_source: 'shop', exit_source: 'x', sale_fee_pct: 0.09 }],
  });
  assert.equal(best.resale.borrowedComps, 3);
  assert.ok(best.flags.some((f) => f.kind === 'other_models'));
});

test('comps of the piece itself carry no such warning', () => {
  const { best } = scoreAllRoutes({
    listing: listing({ source_id: 'shop' }),
    observations: [comp(900), comp(1100), comp(1000)],
    routes: [{ id: 'r', acquisition_source: 'shop', exit_source: 'x', sale_fee_pct: 0.09 }],
  });
  assert.equal(best.resale.borrowedComps, 0);
  assert.ok(!best.flags.some((f) => f.kind === 'other_models'));
});

test('a mix of its own comps and others is not flagged as category-only', () => {
  // One real comp for this model changes what the number is about.
  const { best } = scoreAllRoutes({
    listing: listing({ source_id: 'shop' }),
    observations: [comp(900, { borrowed: true }), comp(1100, { borrowed: true }), comp(1000)],
    routes: [{ id: 'r', acquisition_source: 'shop', exit_source: 'x', sale_fee_pct: 0.09 }],
  });
  assert.ok(!best.flags.some((f) => f.kind === 'other_models'));
});

// --- what a margin rests on --------------------------------------------------

test('a recorded sale is the strongest basis', () => {
  const obs = [
    comp(1000, { evidence: 'confirmed_sale' }), comp(1000), comp(1000),
  ];
  const { best } = scoreAllRoutes({
    listing: listing({ source_id: 'shop' }),
    observations: obs,
    routes: [{ id: 'r', acquisition_source: 'shop', exit_source: 'x', sale_fee_pct: 0.09 }],
  });
  assert.equal(best.evidenceBasis, 'confirmed_sales');
  assert.ok(!best.flags.some((f) => f.kind === 'no_confirmed_sales'));
});

test('a piece that vanished at a price counts as evidence it moved', () => {
  // Gating on confirmed sales alone would leave this screen permanently empty:
  // nothing in the automated path ever writes one, because a poll that stops
  // seeing a listing cannot know it sold. A disappearance is weaker than a
  // sale and much stronger than an ask — somebody took it off the market at
  // that number.
  const obs = [
    comp(1000, { evidence: 'inferred_disappearance' }), comp(1000), comp(1000),
  ];
  const { best } = scoreAllRoutes({
    listing: listing({ source_id: 'shop' }),
    observations: obs,
    routes: [{ id: 'r', acquisition_source: 'shop', exit_source: 'x', sale_fee_pct: 0.09 }],
  });
  assert.equal(best.evidenceBasis, 'disappearances');
});

test('asking prices alone are held back and say why', () => {
  const { best } = scoreAllRoutes({
    listing: listing({ source_id: 'shop' }),
    observations: [comp(1000), comp(1000), comp(1000)],
    routes: [{ id: 'r', acquisition_source: 'shop', exit_source: 'x', sale_fee_pct: 0.09 }],
  });
  assert.equal(best.evidenceBasis, 'asks_only');
  assert.ok(best.flags.some((f) => f.kind === 'no_confirmed_sales'));
});

// --- costs nobody has checked -----------------------------------------------

test('a margin through an unconfirmed cost stack says so', () => {
  // The seeded numbers are guesses — 12% duty, 21% VAT, a 5% proxy fee — and
  // they subtract more from a €600 piece than most of what this screen sorts
  // on. Unflagged they read exactly like measured ones.
  const s = scoreOpportunity({
    listing: listing({ price_base: 300 }),
    observations: [comp(1000), comp(1050), comp(1100)],
    route: JP_ROUTE,
    now: NOW,
  });
  const flag = s.flags.find((f) => f.kind === 'estimated_costs');
  assert.ok(flag, 'an unconfirmed route must flag its own deductions');
  assert.match(flag.message, /npm run route-costs/);

  // High, so it withholds "actionable". A profit figure whose deductions are
  // guesses is arithmetic on guesses, and `actionable` is the one word on this
  // screen that has to mean something.
  assert.equal(flag.severity, 'high');
  assert.equal(s.actionable, false);

  // The arithmetic itself is unchanged — only what the screen is willing to
  // claim about it.
  const confirmed = scoreOpportunity({
    listing: listing({ price_base: 300 }),
    observations: [comp(1000), comp(1050), comp(1100)],
    route: { ...JP_ROUTE, costs_confirmed_at: new Date('2026-08-01') },
    now: NOW,
  });
  assert.equal(s.profit, confirmed.profit);
});

test('nothing is actionable until some route has had its costs checked', () => {
  // The state every fresh install is in. A clean, profitable, well-comped
  // opportunity through an unconfirmed route is a lead, not a decision.
  const clean = {
    listing: listing({ price_base: 780 }),
    observations: [
      comp(1400, { evidence: 'confirmed_sale' }),
      comp(1450, { evidence: 'confirmed_sale' }),
      comp(1500, { evidence: 'confirmed_sale' }),
      comp(1420, { evidence: 'confirmed_sale' }),
    ],
    now: NOW,
  };
  const unchecked = scoreOpportunity({ ...clean, route: JP_ROUTE });
  assert.equal(unchecked.scored, true);
  assert.ok(unchecked.profit > 0);
  assert.equal(unchecked.actionable, false, 'a guessed cost stack is not a basis for acting');

  const checked = scoreOpportunity({
    ...clean,
    route: { ...JP_ROUTE, costs_confirmed_at: new Date('2026-08-01') },
  });
  assert.equal(checked.actionable, true, 'and confirming the route is what clears it');
});

test('a confirmed cost stack does not nag', () => {
  const s = scoreOpportunity({
    listing: listing({ price_base: 300 }),
    observations: [comp(1000), comp(1050), comp(1100)],
    route: { ...JP_ROUTE, costs_confirmed_at: new Date('2026-08-01') },
    now: NOW,
  });
  assert.equal(s.flags.some((f) => f.kind === 'estimated_costs'), false);
});
