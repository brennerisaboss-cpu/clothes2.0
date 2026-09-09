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

// ---------------------------------------------------------------------------
// Season codes: the era, never the model
// ---------------------------------------------------------------------------

test('a season code is not a model', () => {
  // "02AW" and "AW03" mix letters and digits exactly as a model code does, so
  // they were read as one — and model is the finest segment of the identity
  // key, so every listing that named its season pooled with nothing at all.
  assert.equal(modelCode('Undercover AW03 Scab wool knit sweater'), null);
  assert.equal(modelCode('CDG HOMME PLUS 02AW wool jacket'), null);
  assert.equal(modelCode('Yohji Yamamoto SS19 wool coat'), null);
  assert.equal(modelCode('Rick Owens FW18 leather jacket'), null);
  assert.equal(modelCode('Rick Owens FW2018 leather jacket'), null);
});

test('a size quoted with its sizing system is not a model', () => {
  // "EU48" is the same size as "48". Reading the prefixed form as a model split
  // one garment into one item per country its sellers happened to size it in.
  assert.equal(modelCode('Yohji Yamamoto wool jacket EU48'), null);
  assert.equal(modelCode('CDG wool jacket IT50'), null);
  assert.equal(modelCode('Rick Owens leather jacket US32'), null);
});

test('a real model code survives every exclusion', () => {
  assert.equal(modelCode('Guidi 788Z horse leather derby'), '788Z');
  assert.equal(modelCode('Guidi PL1 front zip boot'), 'PL1');
  assert.equal(modelCode('M.A+ B7 leather accordion bag'), 'B7');
});

test("the README's three wordings of one jacket are one item", () => {
  // The worked example the whole platform is explained by. The Japanese one
  // states its era as a season rather than an AD tag, and used to key as model
  // "02AW" with an unknown year — a second item, with a comp set of one.
  const keys = [
    'Comme des Garcons Homme Plus AD2002 wool tailored jacket',
    'CDG HOMME PLUS 02AW ウール テーラード ジャケット',
    'comme des garcons homme plus ad2002 wool jacket',
  ].map((t) => planMatch({ title_raw: t }).key);

  assert.equal(new Set(keys).size, 1, `expected one identity, got ${JSON.stringify(keys)}`);
  assert.equal(keys[0], 'cdg-homme-plus|ad2002|jacket|wool|?');
});

test('a season separates two pieces the AD tag never could', () => {
  // Nothing outside Comme des Garçons carries an AD tag, so every Yohji piece
  // keyed as year-unknown and twenty-one years of production shared one comp
  // set. The season code is the era, written the way this market writes it.
  const ss19 = planMatch({ title_raw: 'Yohji Yamamoto Pour Homme SS19 wool coat' }).key;
  const aw03 = planMatch({ title_raw: 'Yohji Yamamoto Pour Homme AW03 wool coat' }).key;
  const silent = planMatch({ title_raw: 'Yohji Yamamoto Pour Homme wool coat' }).key;

  assert.notEqual(ss19, aw03);
  // A listing that never states an era keeps its own bucket rather than being
  // assigned to either — and pools one level coarser through comps.mjs.
  assert.match(silent, /\|ad\?\|/);
});

test('the two halves of one year are one era, as the AD tag already was', () => {
  // AD2002 spans SS02 and AW02, so folding a season into it changes nothing
  // about how coarse the bucket is.
  const ss = planMatch({ title_raw: 'Undercover SS03 wool knit' }).key;
  const aw = planMatch({ title_raw: 'Undercover AW03 wool knit' }).key;
  assert.equal(ss, aw);
});

// ---------------------------------------------------------------------------
// Garment vocabulary
// ---------------------------------------------------------------------------

test('パーカー is a hoodie, not a coat', () => {
  // The Japanese word for a hoodie, which the coat family used to claim by way
  // of the English "parka" — pooling every Japanese hoodie in every feed with
  // overcoats, and letting a €90 piece vote on a €900 median.
  assert.equal(describeGarment('COMME des GARCONS HOMME PLUS パーカー ブラック').type, 'hoodie');
  assert.equal(describeGarment('Yohji フーディ コットン').type, 'hoodie');
  // The English parka genuinely is a coat, and stays one.
  assert.equal(describeGarment('Undercover hooded parka nylon').type, 'coat');
});

test('a sweatshirt is never pooled with a shirt', () => {
  // The compact form drops spaces, so "sweatshirt" contains "shirt" — the same
  // hazard that put tees among button-ups.
  assert.equal(describeGarment('Rick Owens DRKSHDW cotton sweatshirt').type, 'sweatshirt');
  assert.equal(describeGarment('CDG crewneck sweatshirt').type, 'sweatshirt');
  assert.equal(describeGarment('CDG cotton shirt').type, 'shirt');
  // And a hooded sweatshirt is a hoodie, which is a different market again.
  assert.equal(describeGarment('11 by BBS hooded sweatshirt').type, 'hoodie');
});

test('an accessory never claims the garment it is attached to', () => {
  // "belted coat" compacts to "beltedcoat", which contains "belt". Accessories
  // sit last so every family that could own the piece has already had its turn.
  assert.equal(describeGarment('Yohji Yamamoto belted wool coat').type, 'coat');
  assert.equal(describeGarment('Guidi leather belt').type, 'belt');
});

test('a kimono sleeve is a sleeve, not a kimono', () => {
  assert.equal(describeGarment('Yohji kimono sleeve wool jacket').type, 'jacket');
  assert.equal(describeGarment('Kapital haori indigo').type, 'kimono');
});

test('a biker is a jacket and a turtleneck is a knit', () => {
  assert.equal(describeGarment('Rick Owens cropped leather biker').type, 'jacket');
  assert.equal(describeGarment('Yohji ライダース レザー').type, 'jacket');
  assert.equal(describeGarment('ISSEY MIYAKE MEN wool turtleneck').type, 'knit');
  assert.equal(describeGarment('Yohji wool pullover').type, 'knit');
});

test('the fibre that carries the price wins over the one beside it', () => {
  // A title naming mohair is naming the fibre the resale value rests on, and it
  // is routinely written next to the word "wool".
  assert.equal(describeGarment('CDG mohair wool cardigan').material, 'mohair');
  assert.equal(describeGarment('Yohji shearling leather coat').material, 'shearling');
  assert.equal(describeGarment('Kapital corduroy trousers').material, 'corduroy');
  assert.equal(describeGarment('Rick Owens gore-tex parka').material, 'goretex');
  // And a plain one still resolves plainly.
  assert.equal(describeGarment('Yohji wool gabardine coat').material, 'wool');
});

test('a vendor name never decides what the garment is', () => {
  // "Comme des Garçons SHIRT" is a real sub-line whose NAME contains a garment
  // word, and a feed puts it in the vendor field. Reading the vendor and the
  // title together made every piece from that vendor a shirt — a knit and a
  // cardigan both keyed as `shirt`, pooled into one item, and priced against
  // each other. Nothing about that surfaces as an error, because a wrong pool
  // produces a plausible number.
  const knit = planMatch({ brand_raw: 'Comme des Garcons SHIRT', title_raw: 'wool knit' });
  const cardigan = planMatch({ brand_raw: 'Comme des Garcons SHIRT', title_raw: 'wool cardigan' });
  assert.equal(knit.type, 'knit');
  assert.equal(cardigan.type, 'knit');

  // The vendor is still consulted for a title that says nothing at all: reading
  // a line called SHIRT as making shirts is an inference from what it makes,
  // and a defensible one where the piece itself did not say otherwise.
  const silent = planMatch({ brand_raw: 'Comme des Garcons SHIRT', title_raw: 'cotton striped' });
  assert.equal(silent.type, 'shirt');
});

test('the vendor is still read where the title omits the house', () => {
  // The other half of the same rule: a feed states the house separately, and a
  // title of "wool gabardine coat" resolves to nothing without it.
  const p = planMatch({ brand_raw: 'Yohji Yamamoto Pour Homme', title_raw: 'wool gabardine coat' });
  assert.equal(p.matchable, true);
  assert.equal(p.key, 'yy-pour-homme|ad?|coat|wool|?');
});
