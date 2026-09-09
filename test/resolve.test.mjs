import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrand } from '../src/lib/resolve.mjs';
import { parseAdYear, normalizeAlias } from '../src/lib/normalize.mjs';

test('resolves the most specific sub-line, not the shortest alias', () => {
  const r = resolveBrand('Comme des Garcons Homme Plus wool jacket');
  assert.equal(r.sublineId, 'cdg-homme-plus');
  assert.equal(r.confident, true);
});

test('cedilla and no-cedilla spellings both resolve', () => {
  assert.equal(resolveBrand('Comme des Garçons Shirt').sublineId, 'cdg-shirt');
  assert.equal(resolveBrand('Comme des Garcons Shirt').sublineId, 'cdg-shirt');
});

test('bare CDG is ambiguous and never auto-matched', () => {
  const r = resolveBrand('CDG cargo trousers size M');
  assert.equal(r.brandId, 'cdg');
  assert.equal(r.sublineId, null);
  assert.equal(r.ambiguous, true);
  assert.equal(r.confident, false);
});

test('Japanese house alias resolves the brand', () => {
  const r = resolveBrand('コムデギャルソン ジャケット');
  assert.equal(r.brandId, 'cdg');
  assert.equal(r.ambiguous, true, 'house-only alias must stay ambiguous');
});

test('colloquial Japanese short form is recognised', () => {
  assert.equal(resolveBrand('ギャルソン パンツ').brandId, 'cdg');
});

test('Japanese sub-line alias survives NFKC without losing dakuten', () => {
  const r = resolveBrand('ジュンヤワタナベマン デニム');
  assert.equal(r.sublineId, 'junya-watanabe-man');
  assert.equal(r.confident, true);
});

test('halfwidth katakana folds to the same alias', () => {
  assert.equal(resolveBrand('ｺﾑﾃﾞｷﾞｬﾙｿﾝ').brandId, 'cdg');
});

test('interpunct spelling matches the compact alias', () => {
  assert.equal(resolveBrand('コム・デ・ギャルソン').brandId, 'cdg');
});

test('mixed-script titles resolve the sub-line from either script', () => {
  const r = resolveBrand('コムデギャルソン Homme Plus AD2002 coat');
  assert.equal(r.sublineId, 'cdg-homme-plus');
  assert.equal(r.adYear, 2002);
});

test('Homme+ is distinguished from Homme', () => {
  assert.equal(resolveBrand('CDG Homme+ jacket').sublineId, 'cdg-homme-plus');
  assert.equal(resolveBrand('CDG Homme jacket').sublineId, 'cdg-homme');
});

test('short alias HP only matches on a word boundary', () => {
  assert.equal(resolveBrand('CDG HP blazer').sublineId, 'cdg-homme-plus');
  // "shprs" must not trip the "hp" alias.
  const r = resolveBrand('Comme des Garcons shprs thing');
  assert.notEqual(r.sublineId, 'cdg-homme-plus');
});

test('BLACK CDG and CDG Noir are not the same line', () => {
  assert.equal(resolveBrand('Black Comme des Garcons coat').sublineId, 'cdg-black');
  assert.equal(resolveBrand('Comme des Garcons Noir coat').sublineId, 'cdg-noir');
});

test('Play resolves but is marked unmonitored', () => {
  const r = resolveBrand('Comme des Garcons Play heart tee');
  assert.equal(r.sublineId, 'cdg-play');
  assert.equal(r.monitored, false);
});

test('Comme Comme is flagged ambiguous rather than folded into mainline', () => {
  const r = resolveBrand('Comme des Garcons Comme des Garcons skirt');
  assert.equal(r.sublineId, 'cdg-comme-comme');
  assert.equal(r.ambiguous, true);
  assert.equal(r.confident, false);
});

test('unrelated brands do not resolve', () => {
  // Yohji is on the roster now, so an off-roster label is needed here.
  const r = resolveBrand('Stone Island Shadow Project jacket');
  assert.equal(r.brandId, null);
  assert.equal(r.reason, 'no alias matched');
});

test('a second house resolves to its own brand, not the first', () => {
  const r = resolveBrand('Yohji Yamamoto Pour Homme wool coat');
  assert.equal(r.brandId, 'yohji');
  assert.equal(r.sublineId, 'yy-pour-homme');
  assert.equal(r.confident, true);
});

test('empty input is handled', () => {
  assert.equal(resolveBrand('').brandId, null);
  assert.equal(resolveBrand(null).brandId, null);
});

test('AD year parses in its common written forms', () => {
  assert.equal(parseAdYear('CDG AD2002 jacket').adYear, 2002);
  assert.equal(parseAdYear('CDG AD 1995 jacket').adYear, 1995);
  assert.equal(parseAdYear('ad1998 shirt').adYear, 1998);
});

test('pre-1988 AD claims are recorded as pre-AD-era, not as a year', () => {
  const r = parseAdYear('Comme des Garcons AD1984 coat');
  assert.equal(r.adYear, null);
  assert.equal(r.status, 'pre_ad_era');
});

test('a missing AD year is unknown, not zero', () => {
  const r = parseAdYear('Comme des Garcons wool coat');
  assert.equal(r.adYear, null);
  assert.equal(r.status, 'unknown');
});

test('normalisation keeps dakuten on Japanese input', () => {
  assert.equal(normalizeAlias('ジュンヤ').compact, 'ジュンヤ');
});
