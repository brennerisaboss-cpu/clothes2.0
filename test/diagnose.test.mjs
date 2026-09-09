import { test } from 'node:test';
import assert from 'node:assert/strict';

import { firstBlocker, showAsks } from '../src/lib/diagnose.mjs';

// A census in which everything is fine, so each test can break exactly one
// thing and assert that the one thing is what gets reported.
const healthy = {
  listings: 40,
  matched: 40,
  acquisitionActive: 12,
  exitObservations: 28,
  routes: 4,
  scored: 5,
  salesBacked: 5,
  asksOnly: 0,
  profitable: 5,
  routesConfirmed: 4,
  unconvertible: 0,
};

test('a working pipeline is not diagnosed at all', () => {
  assert.equal(firstBlocker(healthy), null);
});

test('the blockers are reported in pipeline order, not in severity order', () => {
  // Everything is broken at once. Only the earliest may be named: telling
  // someone to link more comps while nothing is matched is advice that cannot
  // be acted on.
  const broken = {
    listings: 0, matched: 0, acquisitionActive: 0, exitObservations: 0,
    routes: 0, scored: 0, salesBacked: 0, asksOnly: 0, profitable: 0, routesConfirmed: 0,
    unconvertible: 0,
  };
  assert.equal(firstBlocker(broken).kind, 'no_listings');
  assert.equal(firstBlocker({ ...broken, listings: 40 }).kind, 'nothing_matched');
  assert.equal(firstBlocker({ ...broken, listings: 40, matched: 40 }).kind, 'no_buy_side');
});

// The one this module exists for.
//
// Paste a hundred Grailed pages and the screen looks exactly as it does with
// no data at all, because Grailed is an exit venue: every row is a comp and
// none is a candidate. Nothing in the app said so.
test('an exit-only collection is named as such, not reported as empty', () => {
  const exitOnly = {
    ...healthy, matched: 40, acquisitionActive: 0, exitObservations: 40,
    scored: 0, salesBacked: 0, asksOnly: 0, profitable: 0,
  };
  const blocker = firstBlocker(exitOnly);
  assert.equal(blocker.kind, 'no_buy_side');
  assert.match(blocker.what, /SELL through/);
  // And it must not be mistaken for the thin-comps case, which would send the
  // user to collect more of exactly what they already have too much of.
  assert.notEqual(blocker.kind, 'comps_too_thin');
});

test('comps on the wrong side of the trade are not comps', () => {
  const noComps = { ...healthy, exitObservations: 0, scored: 0, salesBacked: 0, asksOnly: 0, profitable: 0 };
  assert.equal(firstBlocker(noComps).kind, 'no_comps');
});

test('both sides present but nothing scored means the tiers do not meet', () => {
  const thin = { ...healthy, scored: 0, salesBacked: 0, asksOnly: 0, profitable: 0 };
  const blocker = firstBlocker(thin);
  assert.equal(blocker.kind, 'comps_too_thin');
  assert.match(blocker.what, /3 exit comps/);
});

test('a route is required before anything can be scored', () => {
  const noRoutes = { ...healthy, routes: 0, scored: 0, salesBacked: 0, asksOnly: 0, profitable: 0 };
  assert.equal(firstBlocker(noRoutes).kind, 'no_routes');
});

// Scored rows that are being withheld are the failure mode that looks most
// like a bug, because the work all succeeded and the screen is still blank.
test('rows withheld for want of evidence say so, and offer the click', () => {
  const withheld = { ...healthy, scored: 6, salesBacked: 0, asksOnly: 6, profitable: 6 };
  const blocker = firstBlocker(withheld);
  assert.equal(blocker.kind, 'asks_only');
  assert.match(blocker.what, /6 scored/);
  assert.equal(blocker.href, '/opportunities?asks=1');
});

test('one sales-backed row is enough for the page to have something to show', () => {
  assert.equal(firstBlocker({ ...healthy, scored: 6, salesBacked: 1, asksOnly: 5, profitable: 6 }), null);
});

// --- sales and asks are not two modes ---------------------------------------
//
// The screen used to hide every ask-based row the moment one sales-backed row
// existed, which partitions the list by a label rather than ranking by what the
// label means. The comp pool behind each figure already MIXES sales and asks,
// weighted — a confirmed sale counts for 1, an ask for 0.45 — so "basis" names
// the strongest evidence present rather than switching between two ways of
// working. A piece with no sold comp is one whose evidence is thinner, which
// the confidence figure already says.

test('ask-based rows show unless they are deliberately filtered out', () => {
  // No opinion on the wire is the common case, and it shows them. Collapsing it
  // to a boolean is how an absent parameter came to mean an explicit no.
  assert.equal(showAsks({ requested: undefined }), true);
  assert.equal(showAsks({}), true);

  // Asking for them explicitly is the same answer.
  assert.equal(showAsks({ requested: true }), true);

  // Narrowing to sales-backed rows is a deliberate act, and the only thing that
  // hides them.
  assert.equal(showAsks({ requested: false }), false);
});

// --- a loss is not an opportunity -------------------------------------------
//
// Every scored row used to be listed, losses included, with red text as the
// only distinction — on the screen whose entire job is "what is worth buying".

test('a screen with nothing but losses says so, and does not blame the evidence', () => {
  const allLosses = { ...healthy, scored: 7, profitable: 0, salesBacked: 0, asksOnly: 7 };
  const blocker = firstBlocker(allLosses);
  assert.equal(blocker.kind, 'all_losses');
  assert.match(blocker.what, /7 scored/);
  // Never the asks_only answer here: telling someone their margins rest on
  // asking prices, when every margin is negative anyway, sends them to fix
  // something that would not change a single row.
  assert.notEqual(blocker.kind, 'asks_only');
});

test('unconfirmed route costs are named where every margin is negative', () => {
  // The deductions are seeded guesses until somebody checks them, and on a
  // small margin the guessed duty rate is larger than the margin. That makes
  // "everything loses" as likely to be the seed as the market.
  const seeded = { ...healthy, scored: 7, profitable: 0, routesConfirmed: 0 };
  assert.match(firstBlocker(seeded).what, /seeded guesses/);
  assert.equal(firstBlocker(seeded).fix, 'npm run route-costs');

  // Once they are real numbers, the losses are real losses and the only thing
  // left to offer is a look at them.
  const checked = { ...healthy, scored: 7, profitable: 0, routesConfirmed: 4 };
  assert.doesNotMatch(firstBlocker(checked).what, /seeded guesses/);
  assert.equal(firstBlocker(checked).href, '/opportunities?losses=1');
});

test('one profitable row means the screen has something to show', () => {
  assert.equal(firstBlocker({ ...healthy, scored: 7, profitable: 1 }), null);
});

// --- a price nothing can compare --------------------------------------------
//
// price_base is what every comparison reads and it is stamped once at insert,
// so a listing recorded while its currency had no rate keeps the null for ever.
// Scoring refuses those outright, so they are ABSENT from the screen rather
// than ranked low — an empty page was the only symptom, and it looked
// identical to having no data.

test('listings with no base price are named, not reported as missing comps', () => {
  const stuck = { ...healthy, acquisitionActive: 6, unconvertible: 6, scored: 0, salesBacked: 0, asksOnly: 0, profitable: 0 };
  const blocker = firstBlocker(stuck);
  assert.equal(blocker.kind, 'unconvertible');
  assert.match(blocker.what, /6 listings/);
  assert.match(blocker.fix, /npm run fx/);
  // Never the thin-comps answer, which would send someone to collect more of
  // something that would be equally uncomparable when it arrived.
  assert.notEqual(blocker.kind, 'comps_too_thin');
});

test('a few unconvertible rows among many good ones are not the headline', () => {
  // The blocker is for the case where this is why the screen is empty. One
  // stray row among six that score fine is a nuisance, not the diagnosis.
  const mostlyFine = { ...healthy, acquisitionActive: 6, unconvertible: 1 };
  assert.equal(firstBlocker(mostlyFine), null);
});
