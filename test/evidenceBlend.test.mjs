// Sales and asks are not two modes.
//
// The question this answers: does recording what a piece SOLD for replace what
// people are ASKING for it, or join it?
//
// It joins it, and it always has — the comp pool is a weighted median, and the
// weights are what encode the difference between a price somebody paid and a
// price somebody hoped for. `evidenceBasis` names the strongest evidence in the
// pool; it is a description, not a switch. The screen used to partition rows by
// that label, hiding every ask-based row the moment one sales-backed row
// existed, which is what made the two look mutually exclusive when the
// arithmetic never treated them that way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resaleEstimate, scoreOpportunity } from '../src/lib/scoring.mjs';
import { EVIDENCE_WEIGHT } from '../src/lib/priceHistory.mjs';

const now = new Date();
const comp = (price, evidence) => ({
  price_base: price,
  evidence,
  status: evidence === 'confirmed_sale' ? 'sold_confirmed' : 'active',
  date_seen: now,
  entered_manually: false,
  source_role: 'exit',
  source_id: 'grailed',
  venue_id: 'grailed',
  marketplace_kind: 'secondhand',
  condition_tier: null,
  size_raw: null,
});

test('a recorded sale moves an ask-based estimate rather than replacing it', () => {
  const asks = [comp(1400, 'active_ask'), comp(1500, 'active_ask'), comp(1450, 'active_ask')];

  const before = resaleEstimate(asks, null, now);
  const after = resaleEstimate([comp(1000, 'confirmed_sale'), ...asks], null, now);

  assert.equal(before.value, 1450);
  // Pulled toward the sale, not onto it: three asks still have a say.
  assert.ok(after.value < before.value, 'the sale must move the figure');
  assert.ok(after.value > 1000, 'and must not simply become the sale');
  assert.equal(after.comps, 4, 'the asks are still comps');
});

test('one sale outweighs one ask, by the ratio the weights state', () => {
  // The whole distinction, and it lives in a table rather than in a filter.
  assert.equal(EVIDENCE_WEIGHT.confirmed_sale, 1);
  assert.ok(EVIDENCE_WEIGHT.active_ask < EVIDENCE_WEIGHT.confirmed_sale);
  assert.ok(EVIDENCE_WEIGHT.inferred_disappearance < EVIDENCE_WEIGHT.active_ask);
});

test('adding a sale raises confidence without discarding what was there', () => {
  const asks = [comp(1400, 'active_ask'), comp(1500, 'active_ask'), comp(1450, 'active_ask')];
  const mixed = resaleEstimate([comp(1000, 'confirmed_sale'), ...asks], null, now);
  const askOnly = resaleEstimate(asks, null, now);

  assert.ok(mixed.confidence > askOnly.confidence);
});

test('the basis names the strongest evidence present, and is not a mode', () => {
  const route = {
    id: 'r', exit_source: 'grailed', exit_venue: 'grailed', acquisition_source: 'shop',
    sale_fee_pct: 0, payment_fee_pct: 0, outbound_ship_flat: 0,
    proxy_fee_pct: 0, proxy_fee_flat: 0, domestic_ship_flat: 0, intl_ship_flat: 0,
    import_vat_pct: 0, customs_duty_pct: 0, costs_confirmed_at: new Date(),
  };
  const listing = {
    price_base: 400, condition_tier: null, date_seen: now, last_verified_at: now,
    entered_manually: false, source_id: 'shop', size_raw: null,
  };

  const asks = [comp(1400, 'active_ask'), comp(1500, 'active_ask'), comp(1450, 'active_ask')];

  const askBased = scoreOpportunity({ listing, observations: asks, route, now });
  assert.equal(askBased.evidenceBasis, 'asks_only');
  assert.equal(askBased.scored, true, 'an ask-based row is still a scored row');

  const withSale = scoreOpportunity({
    listing, observations: [comp(1000, 'confirmed_sale'), ...asks], route, now,
  });
  assert.equal(withSale.evidenceBasis, 'confirmed_sales');
  assert.equal(withSale.confirmedSales, 1);
  // Both are scored, both carry a profit, and they differ in what stands behind
  // the number rather than in whether there is one.
  assert.ok(Number.isFinite(askBased.profit));
  assert.ok(Number.isFinite(withSale.profit));
  assert.notEqual(askBased.profit, withSale.profit);
});

test('a disappearance sits between the two, as its weight says', () => {
  const gone = [
    comp(1200, 'inferred_disappearance'),
    comp(1400, 'active_ask'),
    comp(1500, 'active_ask'),
  ];
  const estimate = resaleEstimate(gone, null, now);
  assert.equal(estimate.counts.inferred_disappearance, 1);
  assert.equal(estimate.counts.active_ask, 2);
});
