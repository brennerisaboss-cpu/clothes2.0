import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatch, suggestMatches, safeToApply, meaningfulTokens } from '../src/lib/matchmaker.mjs';

// Two sites describing one coat differently is the normal case, not the edge
// one. The exact matcher cannot join them — a Vestiaire seller types "Comme des
// Garçons — Wool jacket" and never the sub-line or the year — so those listings
// pool with nothing and can never be scored. This proposes the join and says
// what it had to assume to propose it.

const ITEM = {
  identity_key: 'cdg-homme-plus|ad2002|jacket|wool|?',
  canonical_name: 'Comme des Garçons Homme Plus AD2002 wool jacket',
  brand_id: 'cdg',
  subline_id: 'cdg-homme-plus',
  ad_year: 2002,
};

test('a vague listing is matched to the item it probably is', () => {
  const m = scoreMatch({ title_raw: 'Comme des Garçons wool jacket' }, ITEM);
  assert.notEqual(m.tier, 'no');
  assert.ok(m.agreements.some((a) => /garment jacket/.test(a)));
  assert.ok(m.agreements.some((a) => /material wool/.test(a)));
});

test('what it had to assume is stated, every time', () => {
  // The assumption that matters: the listing never said which CDG line this
  // is, and a sub-line decides which comp pool the piece joins.
  const m = scoreMatch({ title_raw: 'Comme des Garçons wool jacket' }, ITEM);
  assert.ok(m.assumptions.some((a) => /cdg-homme-plus/.test(a)));
  assert.equal(safeToApply(m), false, 'an assumption is never applied without asking');
});

test('a full description matches strongly and assumes nothing', () => {
  const m = scoreMatch(
    { title_raw: 'Comme des Garcons Homme Plus AD2002 wool tailored jacket' },
    ITEM,
  );
  assert.equal(m.tier, 'strong');
  assert.deepEqual(m.assumptions, []);
  assert.equal(safeToApply(m), true);
});

test('a different house is refused, not scored low', () => {
  const m = scoreMatch({ title_raw: 'Yohji Yamamoto wool jacket' }, ITEM);
  assert.equal(m.tier, 'no');
  assert.match(m.conflict, /different house/);
});

test('a stated year that disagrees is a refusal', () => {
  // In archive clothing the year is most of what a piece is worth. AD1998 and
  // AD2002 are different objects at different prices.
  const m = scoreMatch({ title_raw: 'Comme des Garcons Homme Plus AD1998 wool jacket' }, ITEM);
  assert.equal(m.tier, 'no');
  assert.match(m.conflict, /different year/);
});

test('a stated material or garment that disagrees is a refusal', () => {
  assert.match(
    scoreMatch({ title_raw: 'Comme des Garçons leather jacket' }, ITEM).conflict,
    /different material/,
  );
  assert.match(
    scoreMatch({ title_raw: 'Comme des Garçons wool trousers' }, ITEM).conflict,
    /different garment/,
  );
});

test('a different sub-line is refused even when everything else agrees', () => {
  const m = scoreMatch(
    { title_raw: 'Comme des Garcons Shirt AD2002 wool jacket', subline_id: 'cdg-shirt' },
    ITEM,
  );
  assert.equal(m.tier, 'no');
  assert.match(m.conflict, /different sub-line/);
});

test('a stated model that disagrees is a refusal', () => {
  const bag = {
    identity_key: 'ma-plus|ad?|bag|leather|b7',
    canonical_name: 'M.A+ leather B7 bag',
    brand_id: 'maplus',
    subline_id: 'ma-plus',
    ad_year: null,
  };
  const m = scoreMatch({ title_raw: 'M.A+ leather P3 bag' }, bag);
  // Either the model conflicts or the house does not resolve in this fixture;
  // both are refusals, and neither may produce a match.
  assert.equal(m.tier, 'no');
});

test('suggestions are ranked, and weak ones are not offered at all', () => {
  const items = [
    ITEM,
    {
      identity_key: 'cdg-homme-plus|ad2011|coat|wool|?',
      canonical_name: 'Comme des Garçons Homme Plus AD2011 wool coat',
      brand_id: 'cdg', subline_id: 'cdg-homme-plus', ad_year: 2011,
    },
    {
      identity_key: 'cdg-play|ad?|tshirt|cotton|?',
      canonical_name: 'Comme des Garçons Play cotton t-shirt',
      brand_id: 'cdg', subline_id: 'cdg-play', ad_year: null,
    },
  ];
  const matches = suggestMatches({ title_raw: 'Comme des Garçons wool jacket' }, items);
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].item.identity_key, ITEM.identity_key);
  // The coat and the t-shirt state a garment that disagrees, so neither is
  // offered — a wrong suggestion costs more than no suggestion, because
  // accepting one is a click and unpicking it is not.
  assert.ok(!matches.some((m) => /coat|tshirt/.test(m.item.identity_key)));
});

test('describing words help, but cannot carry a match on their own', () => {
  const m = scoreMatch(
    { title_raw: 'Comme des Garçons Homme Plus tailored piece, wool, archive' },
    ITEM,
  );
  // No garment word, so nothing structural agrees beyond the house.
  assert.ok(['no', 'possible'].includes(m.tier), m.tier);
  assert.equal(safeToApply(m), false);
});

test('noise words are not evidence', () => {
  const tokens = meaningfulTokens('Vintage authentic RARE mens wool jacket size M NWT');
  assert.ok(tokens.has('wool'));
  assert.ok(tokens.has('jacket'));
  for (const noise of ['vintage', 'authentic', 'rare', 'mens', 'size', 'nwt']) {
    assert.ok(!tokens.has(noise), noise);
  }
});

// --- grouping the unresolved pile against itself ----------------------------
//
// The suggestion engine can only propose items that already exist. Two
// Vestiaire rows of one unnamed coat, with nothing else in the data, have
// nothing to be proposed against — so they sit unresolved forever, pooling with
// nothing, which is the state most of a fresh paste lands in.

import { clusterListings, compareListings } from '../src/lib/matchmaker.mjs';

const row = (id, title) => ({ id, title_raw: title });

test('two vague listings of the same thing become one group', () => {
  const [group, ...rest] = clusterListings([
    row('1', 'Comme des Garçons Wool jacket'),
    row('2', 'Comme des Garçons wool jacket, black'),
  ]);
  assert.equal(rest.length, 0);
  assert.deepEqual(group.members.map((m) => m.id), ['1', '2']);
  assert.ok(group.agreements.includes('garment jacket'));
  assert.ok(group.agreements.includes('material wool'));
});

test('a group says a sub-line still has to be chosen', () => {
  // Which is the whole reason these are unresolved. The group makes it one
  // decision instead of four, and does not make it for you.
  const [group] = clusterListings([
    row('1', 'Comme des Garçons Wool jacket'),
    row('2', 'Comme des Garçons wool jacket, black'),
  ]);
  assert.ok(group.assumptions.some((a) => /names a sub-line/.test(a)));
  assert.equal(group.shared.sublineId, null);
});

test('different houses never group, however alike the words', () => {
  const groups = clusterListings([
    row('1', 'Comme des Garçons wool jacket'),
    row('2', 'Yohji Yamamoto wool jacket'),
  ]);
  assert.equal(groups.length, 0);
});

test('a stated fact that disagrees splits a group', () => {
  const groups = clusterListings([
    row('1', 'Comme des Garçons wool jacket'),
    row('2', 'Comme des Garçons leather jacket'),
  ]);
  assert.equal(groups.length, 0, 'wool and leather are not one garment');

  const years = clusterListings([
    row('1', 'Comme des Garcons Homme Plus AD2002 wool jacket'),
    row('2', 'Comme des Garcons Homme Plus AD1998 wool jacket'),
  ]);
  assert.equal(years.length, 0, 'the year is most of what an archive piece is worth');
});

test('a group does not chain through a member that contradicts the ends', () => {
  // Single linkage would put all three together: the unlabelled jacket is
  // compatible with both the wool one and the leather one, and those two
  // contradict each other. Complete linkage is what stops that.
  const groups = clusterListings([
    row('1', 'Comme des Garçons wool jacket'),
    row('2', 'Comme des Garçons jacket'),
    row('3', 'Comme des Garçons leather jacket'),
  ]);
  for (const g of groups) {
    const ids = g.members.map((m) => m.id);
    assert.ok(!(ids.includes('1') && ids.includes('3')), 'wool and leather in one group');
  }
});

test('two silences are not a match', () => {
  // Nothing stated in common is not agreement, it is two listings that said
  // nothing. Grouping them would invent an item out of no information.
  const { compatible, conflict } = compareListings(
    row('1', 'Comme des Garçons piece'),
    row('2', 'Comme des Garçons something'),
  );
  assert.equal(compatible, false);
  assert.match(conflict, /nothing stated in common/);
});

test('what only some of them state is named as an assumption', () => {
  const [group] = clusterListings([
    row('1', 'Comme des Garcons Homme Plus AD2002 wool jacket'),
    row('2', 'Comme des Garcons Homme Plus wool jacket'),
  ]);
  assert.equal(group.shared.adYear, '2002');
  assert.ok(
    group.assumptions.some((a) => /never state a year/.test(a)),
    `expected a stated assumption, got ${JSON.stringify(group.assumptions)}`,
  );
});

test('a lone listing is not a group', () => {
  assert.deepEqual(clusterListings([row('1', 'Comme des Garçons wool jacket')]), []);
});

// --- what a bulk-accept is allowed to write ---------------------------------
//
// The button sends {listingId, itemId} pairs and the action wrote them. The
// safety property — "bulk-accept only ever links strong, unassumptive matches"
// — lived entirely in which pairs the PAGE chose to render, and a server action
// is an independently callable POST. So it was no enforcement at all: anything
// able to call it could link any listing to any item, and a wrong link pools a
// garment into another garment's comp set, which is what every valuation is
// computed from.

const HP_ITEM = {
  id: 'item-hp-2002',
  brand_id: 'cdg',
  subline_id: 'cdg-homme-plus',
  canonical_name: 'Comme des Garcons Homme Plus AD2002 wool tailored jacket',
  identity_key: 'cdg-homme-plus|ad2002|jacket|wool|?',
  ad_year: 2002,
};

const GUIDI_ITEM = {
  id: 'item-guidi-992',
  brand_id: 'guidi',
  subline_id: 'guidi',
  canonical_name: 'Guidi 992 horse leather derby',
  identity_key: 'guidi|ad?|shoe|leather|992',
  ad_year: null,
};

const ITEMS = [HP_ITEM, GUIDI_ITEM];

const listingRow = (over = {}) => ({
  id: 'listing-1',
  title_raw: 'Comme des Garcons Homme Plus AD2002 wool tailored jacket',
  brand_id: 'cdg',
  subline_id: 'cdg-homme-plus',
  item_id: null,
  ...over,
});

const rows = (...list) => new Map(list.map((l) => [l.id, l]));

test('a pair the data supports is allowed', async () => {
  const { admissibleLinks } = await import('../src/lib/matchmaker.mjs');
  const listing = listingRow();
  const { allowed, refused } = admissibleLinks(
    [{ listingId: listing.id, itemId: HP_ITEM.id }], rows(listing), ITEMS,
  );
  assert.deepEqual(allowed, [{ listingId: 'listing-1', itemId: 'item-hp-2002' }]);
  assert.deepEqual(refused, []);
});

test('a forged pair is refused however it is asked for', async () => {
  const { admissibleLinks } = await import('../src/lib/matchmaker.mjs');
  const listing = listingRow();

  // The whole attack: name any item you like. A jacket is not a shoe and the
  // houses differ, and neither fact came from the caller.
  const { allowed, refused } = admissibleLinks(
    [{ listingId: listing.id, itemId: GUIDI_ITEM.id }], rows(listing), ITEMS,
  );
  assert.deepEqual(allowed, []);
  assert.match(refused[0], /not a match/);
});

test('an item that does not exist is refused, not created', async () => {
  const { admissibleLinks } = await import('../src/lib/matchmaker.mjs');
  const listing = listingRow();
  const { allowed, refused } = admissibleLinks(
    [{ listingId: listing.id, itemId: 'item-invented' }], rows(listing), ITEMS,
  );
  assert.deepEqual(allowed, []);
  assert.match(refused[0], /not a match/);
});

test('a listing that does not exist is refused', async () => {
  const { admissibleLinks } = await import('../src/lib/matchmaker.mjs');
  const { allowed, refused } = admissibleLinks(
    [{ listingId: 'listing-nope', itemId: HP_ITEM.id }], rows(), ITEMS,
  );
  assert.deepEqual(allowed, []);
  assert.match(refused[0], /no such listing/);
});

test('a listing already linked is left alone', async () => {
  const { admissibleLinks } = await import('../src/lib/matchmaker.mjs');
  // Re-pointing an existing link is a correction, and a correction is a
  // deliberate single act — never something a bulk button does to a row the
  // operator has already decided about.
  const listing = listingRow({ item_id: 'item-something-else' });
  const { allowed, refused } = admissibleLinks(
    [{ listingId: listing.id, itemId: HP_ITEM.id }], rows(listing), ITEMS,
  );
  assert.deepEqual(allowed, []);
  assert.match(refused[0], /already linked/);
});

test('a match that rests on an assumption is refused in bulk, not merely a strong one', async () => {
  const { admissibleLinks, suggestMatches, safeToApply } = await import('../src/lib/matchmaker.mjs');
  // A listing that never states its year against an item that has one: the
  // matcher can rate this highly and it is still an assumption, which is
  // exactly the case worth a person's eye. The page had been filtering on
  // tier === 'strong', which lets these through.
  const listing = listingRow({
    id: 'listing-vague',
    title_raw: 'Comme des Garcons Homme Plus wool tailored jacket',
  });
  const [best] = suggestMatches(listing, [HP_ITEM]);
  assert.ok(best, 'the matcher does propose it');
  assert.ok(best.assumptions.length > 0, 'and it rests on an assumption');
  assert.equal(safeToApply(best), false);

  const { allowed, refused } = admissibleLinks(
    [{ listingId: listing.id, itemId: HP_ITEM.id }], rows(listing), [HP_ITEM],
  );
  assert.deepEqual(allowed, []);
  assert.match(refused[0], /assumption/);
});

test('one bad pair in a batch does not carry the good ones with it, or vice versa', async () => {
  const { admissibleLinks } = await import('../src/lib/matchmaker.mjs');
  const good = listingRow({ id: 'good' });
  const bad = listingRow({ id: 'bad' });
  const { allowed, refused } = admissibleLinks(
    [
      { listingId: 'good', itemId: HP_ITEM.id },
      { listingId: 'bad', itemId: GUIDI_ITEM.id },
    ],
    rows(good, bad),
    ITEMS,
  );
  assert.deepEqual(allowed.map((a) => a.listingId), ['good']);
  assert.equal(refused.length, 1);
});

// --- the vendor field counts -------------------------------------------------
//
// A feed states the house SEPARATELY from the title — Shopify's vendor, a
// merchant feed's brand column — so "Comme des Garçons" / "wool tailored
// jacket" is the ordinary shape of a row, not an odd one. Resolving from the
// title alone found no house in it at all, and the first refusal in scoreMatch
// is that the house is not identified on both sides.
//
// The consequence was precise and invisible: the single most common reason a
// listing is unresolved — the house is stated, the LINE is not — produced zero
// proposals and zero clusters. /unresolved offered nothing on exactly the rows
// it exists to rescue, and looked merely cautious doing it.

const CDG_ITEM = {
  id: 'i1',
  identity_key: 'cdg-homme-plus|ad2002|jacket|wool|?',
  canonical_name: 'Comme des Garçons Homme Plus AD2002 wool jacket',
  brand_id: 'cdg',
  subline_id: 'cdg-homme-plus',
  ad_year: 2002,
};

test('a listing whose house is in the vendor field is still proposed against', () => {
  const listing = { id: 'a', brand_raw: 'Comme des Garcons', title_raw: 'wool tailored jacket' };
  const matches = suggestMatches(listing, [CDG_ITEM]);

  assert.equal(matches.length, 1);
  assert.ok(matches[0].agreements.some((a) => a.includes('jacket')));
  // And the sub-line it would be filed under is still named as an assumption,
  // because the listing does not state one.
  assert.ok(matches[0].assumptions.some((a) => a.includes('cdg-homme-plus')));
});

test('two feed rows of one unnamed piece still group', () => {
  const groups = clusterListings([
    { id: 'a', brand_raw: 'Comme des Garcons', title_raw: 'wool tailored jacket' },
    { id: 'b', brand_raw: 'Comme des Garcons', title_raw: 'wool jacket' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 2);
});

test('the vendor still cannot make two houses one', () => {
  // Reading the vendor must not have loosened the refusal it exists to serve.
  const groups = clusterListings([
    { id: 'a', brand_raw: 'Comme des Garcons', title_raw: 'wool jacket' },
    { id: 'b', brand_raw: 'Yohji Yamamoto', title_raw: 'wool jacket' },
  ]);
  assert.equal(groups.length, 0, 'a different house is a refusal, not a low score');
});
