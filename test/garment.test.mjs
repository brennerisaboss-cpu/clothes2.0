import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeGarment, garmentKey, garmentName, modelCode } from '../src/lib/garment.mjs';
import { planMatch } from '../src/lib/matching.mjs';

test('the same garment worded three ways yields one identity', () => {
  // This is the whole point of the module. Three sellers, two languages, one
  // jacket. Before this existed each produced its own item with a comp set of
  // one, and nothing in the platform could be valued against anything.
  const keys = [
    'Comme des Garcons Homme Plus AD2002 wool tailored jacket',
    'comme des garcons homme plus ad2002 wool jacket',
    'CDG HOMME PLUS AD2002 ウール テーラード ジャケット',
  ].map((t) => planMatch({ title_raw: t }).key);

  assert.equal(new Set(keys).size, 1, `expected one identity, got ${JSON.stringify(keys)}`);
  assert.equal(keys[0], 'cdg-homme-plus|ad2002|jacket|wool|?');
});

test('AD year separates two otherwise identical pieces', () => {
  const a = planMatch({ title_raw: 'Comme des Garcons Homme Plus AD1995 wool jacket' }).key;
  const b = planMatch({ title_raw: 'Comme des Garcons Homme Plus AD2002 wool jacket' }).key;
  assert.notEqual(a, b);
});

test('a t-shirt is never pooled with a shirt', () => {
  // The compact form drops spaces, so "tshirt" contains "shirt". The tee family
  // has to be tested first, and this holds that ordering in place.
  assert.equal(describeGarment('Rick Owens cotton t-shirt').type, 'tee');
  assert.equal(describeGarment('CDG tshirt').type, 'tee');
  assert.equal(describeGarment('CDG cotton shirt').type, 'shirt');
});

test('Japanese shorts are never pooled with trousers', () => {
  // ショートパンツ contains パンツ, the trousers term.
  assert.equal(describeGarment('Yohji ショートパンツ').type, 'shorts');
  assert.equal(describeGarment('Yohji ウールパンツ').type, 'trousers');
});

test('an unreadable garment type is refused, never pooled on the remainder', () => {
  // Without a type, sub-line and year alone would pool a coat with trousers.
  const plan = planMatch({ title_raw: 'Comme des Garcons Homme Plus AD2002 archive piece' });
  assert.equal(plan.matchable, false);
  assert.match(plan.reason, /garment type/);
  assert.equal(plan.key, undefined);
});

test('an unstated material is its own bucket, not a wildcard', () => {
  const stated = garmentKey({ sublineId: 'x', adYear: 2002, type: 'coat', material: 'wool' });
  const unstated = garmentKey({ sublineId: 'x', adYear: 2002, type: 'coat', material: null });
  assert.notEqual(stated, unstated);
  assert.match(unstated, /\|\?$/);
});

test('a vendor that repeats the title does not invent a sub-line', () => {
  // A Shopify feed gives vendor and title separately and the title usually
  // repeats the vendor. Joining them blindly produced "Comme des Garcons Comme
  // des Garcons", which is a real sub-line, so every CDG piece from every
  // Shopify shop resolved to the wrong line and went to /unresolved.
  const plan = planMatch({
    brand_raw: 'COMME des GARCONS',
    title_raw: 'COMME des GARCONS HOMME PLUS AD2002 tailored jacket',
  });
  assert.equal(plan.matchable, true);
  assert.equal(plan.sublineId, 'cdg-homme-plus');
});

test('a vendor absent from the title is still used', () => {
  const plan = planMatch({ brand_raw: 'Yohji Yamamoto', title_raw: 'Pour Homme wool gabardine long coat' });
  assert.equal(plan.matchable, true);
  assert.equal(plan.key, 'yy-pour-homme|ad?|coat|wool|?');
});

test('the genuine CDG-CDG line is still recognised as ambiguous', () => {
  // The fix above must not have been achieved by deleting that line's aliases.
  const plan = planMatch({ title_raw: 'Comme des Garcons Comme des Garcons wool skirt' });
  assert.equal(plan.matchable, false);
  assert.match(plan.reason, /ambiguous/);
});

test('an item is named from its identity, not from a seller title', () => {
  assert.equal(
    garmentName({ sublineName: 'Comme des Garçons Homme Plus', adYear: 2002, type: 'jacket', material: 'wool' }),
    'Comme des Garçons Homme Plus AD2002 wool jacket',
  );
  // Nothing known about the year: the name simply omits it rather than guessing.
  assert.equal(
    garmentName({ sublineName: 'Guidi', adYear: null, adYearStatus: 'unknown', type: 'footwear', material: 'leather' }),
    'Guidi leather footwear',
  );
});

// --- model codes ------------------------------------------------------------
//
// The complaint that produced these: an M.A+ accordion bag was priced against
// every other bag the house makes, which is not a comparison.

test('two models of the same kind of piece are not one item', () => {
  const accordion = planMatch({ title_raw: 'M.A+ accordion bag black horse leather' }).key;
  const shoulder = planMatch({ title_raw: 'M.A+ small shoulder bag black leather' }).key;
  const tote = planMatch({ title_raw: 'MA+ tote bag leather' }).key;
  assert.equal(new Set([accordion, shoulder, tote]).size, 3);
});

test('a derby and a boot from one house are not comps for each other', () => {
  const derby = planMatch({ title_raw: 'Guidi 788Z horse leather derby' }).key;
  const boot = planMatch({ title_raw: 'Guidi PL1 horse leather boot' }).key;
  assert.notEqual(derby, boot);
  assert.match(derby, /788Z$/);
  assert.match(boot, /PL1$/);
});

test('the same model listed twice still pools', () => {
  // Splitting finer must not split pieces that genuinely are the same thing.
  const a = planMatch({ title_raw: 'Guidi 788Z horse leather derby black' }).key;
  const b = planMatch({ title_raw: 'GUIDI 788z leather derby' }).key;
  assert.equal(a, b);
});

test('a size is never mistaken for a model', () => {
  // "M1" and "S2" are sizes; "B7" and "P3" are M.A+ model codes. Excluding
  // every letter-plus-digit token threw the models away with the sizes.
  assert.equal(modelCode('Yohji wool coat size M1'), null);
  assert.equal(modelCode('CDG S2 cotton shirt'), null);
  assert.equal(modelCode('MA+ B7 leather bag'), 'B7');
  assert.equal(modelCode('MA+ P3 pouch'), 'P3');
});

test('an AD year is not a model, having its own place in identity', () => {
  assert.equal(modelCode('Comme des Garcons Homme Plus AD2002 wool jacket'), null);
  assert.equal(modelCode('Yohji Yamamoto 1998 wool coat'), null);
});

test('a measurement is not a model', () => {
  assert.equal(modelCode('Rick Owens DRKSHDW coat 40cm shoulder'), null);
});

test('an unstated model sits behind the stated ones, so it can pool coarser', () => {
  // Identity runs most-certain to least, and the borrowing in queries.ts pools
  // on everything before the first unknown segment. Model must therefore be
  // last, or an unknown model would strand the item instead of widening it.
  const key = planMatch({ title_raw: 'M.A+ accordion bag leather' }).key;
  assert.match(key, /\|\?$/);
});
