import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessCatalogue, isPlausiblePrice } from '../src/lib/plausibility.mjs';

// The bug this exists for: a shop pricing in EUR read as JPY. Every €500 piece
// becomes about €3 and tops the opportunities table wearing a 99% margin.
const EUR_PRICES = [480, 545, 890, 1150, 620, 1490];
const JPY_RATE = 0.0058;

test('a euro catalogue misread as yen is caught', () => {
  const asIfYen = EUR_PRICES.map((p) => p * JPY_RATE);
  const r = assessCatalogue(asIfYen, { currency: 'JPY' });
  assert.equal(r.verdict, 'implausible');
  assert.match(r.reason, /may not really be in JPY/);
});

test('the same catalogue read correctly passes', () => {
  assert.equal(assessCatalogue(EUR_PRICES, { currency: 'EUR' }).verdict, 'ok');
});

test('a yen catalogue misread as euro is caught too', () => {
  // The mistake in the other direction buries real pieces instead of promoting
  // junk, which is quieter but just as wrong.
  const yen = [46000, 52000, 128000, 61000, 89000];
  const r = assessCatalogue(yen, { currency: 'EUR' });
  assert.equal(r.verdict, 'implausible');
  assert.match(r.reason, /weaker currency read as a stronger/);
});

test('a genuine yen catalogue, converted, passes', () => {
  const converted = [46000, 52000, 128000, 61000, 89000].map((p) => p * JPY_RATE);
  assert.equal(assessCatalogue(converted, { currency: 'JPY' }).verdict, 'ok');
});

test('one odd price does not condemn a good catalogue', () => {
  // A shop may legitimately sell one cheap accessory. The median is what says
  // whether the whole feed was read in the wrong currency.
  const r = assessCatalogue([3, 480, 545, 890, 1150, 620], { currency: 'EUR' });
  assert.equal(r.verdict, 'ok');
});

test('one huge price does not rescue a broken one', () => {
  const r = assessCatalogue([2, 3, 2.8, 3.4, 40000], { currency: 'JPY' });
  assert.equal(r.verdict, 'implausible');
});

test('too small a sample reports that it cannot tell, rather than guessing', () => {
  const r = assessCatalogue([2, 3], { currency: 'JPY' });
  assert.equal(r.verdict, 'unknown');
  assert.match(r.reason, /too few/);
});

test('the band is wide enough not to reject real pieces', () => {
  // It must catch errors two or three orders out, never a few per cent, or it
  // would start rejecting genuine bargains and genuine grails.
  assert.equal(isPlausiblePrice(20).plausible, true, 'a cheap real piece');
  assert.equal(isPlausiblePrice(18_000).plausible, true, 'an expensive real piece');
  assert.equal(isPlausiblePrice(3).plausible, false);
  assert.equal(isPlausiblePrice(128_000).plausible, false);
});
