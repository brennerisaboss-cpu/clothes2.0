// Layer 1 of item matching: the deterministic alias table.
//
// The brief's plan is alias table + your own eyes (via reverse image search),
// with an embedding/LLM fallback only if that proves insufficient in practice.
// So this resolves what it can prove and leaves the rest visibly unmatched.
// It never merges on a guess.

import { resolveBrand } from './resolve.mjs';
import { describeGarment, garmentKey, garmentName } from './garment.mjs';
import { normalizeAlias } from './normalize.mjs';

/**
 * The identity key for a canonical item.
 *
 * AD year is part of identity, not metadata: the same model in AD1995 and
 * AD2002 are different pieces with different values and must not share comps.
 * An unknown AD year is its own bucket rather than being treated as matching
 * every year.
 */
export function itemKey({ sublineId, adYear, type, material, model }) {
  return garmentKey({ sublineId, adYear, type, material, model });
}

/**
 * Decide what, if anything, a listing can be matched to automatically.
 *
 * Returns `matchable: false` whenever the sub-line is unresolved or ambiguous.
 * That listing then shows up in /unresolved for you to settle by hand — which
 * is the intended behaviour, not a failure.
 */
/**
 * The text to resolve a brand from.
 *
 * Not simply the two fields joined. A Shopify feed gives vendor and title
 * separately and the title almost always repeats the vendor, so joining them
 * yields "COMME des GARCONS COMME des GARCONS HOMME PLUS ..." — and "Comme des
 * Garçons Comme des Garçons" is itself a real sub-line. Every CDG piece from
 * every Shopify shop resolved to that line and went to /unresolved, which is
 * the sort of failure that looks like the matcher merely being cautious.
 *
 * So the vendor is added only when it is not already in the title.
 */
function haystackFor(brand_raw, title_raw) {
  const title = String(title_raw ?? '');
  const brand = String(brand_raw ?? '').trim();
  if (!brand) return title;
  const inTitle = normalizeAlias(title).compact.includes(normalizeAlias(brand).compact);
  return inTitle ? title : `${brand} ${title}`;
}

export function planMatch({ brand_raw, title_raw }) {
  const resolved = resolveBrand(haystackFor(brand_raw, title_raw));

  if (!resolved.brandId) {
    return { matchable: false, reason: 'brand not recognised', resolved };
  }
  if (!resolved.sublineId) {
    return { matchable: false, reason: resolved.reason, resolved };
  }
  if (resolved.ambiguous) {
    return { matchable: false, reason: resolved.reason, resolved };
  }
  if (!resolved.monitored) {
    // Resolvable, but excluded from monitoring on purpose. Recognising it is
    // what keeps it out of the monitored comps.
    return { matchable: false, reason: 'sub-line is excluded from monitoring', resolved };
  }

  // Sub-line and year are not enough to identify a garment. Without the type,
  // every piece a house made in one year would pool into a single item — a
  // coat valued against trousers. So the type must be recognised too, and a
  // title this vocabulary cannot read goes to /unresolved rather than into a
  // pool it may not belong in.
  const garment = describeGarment(haystackFor(brand_raw, title_raw));
  if (!garment.identified) {
    return {
      matchable: false,
      reason: 'garment type not recognised in the title — identify it by hand',
      resolved,
    };
  }

  const adYear = resolved.adYearStatus === 'known' ? resolved.adYear : null;

  return {
    matchable: true,
    reason: resolved.reason,
    resolved,
    sublineId: resolved.sublineId,
    adYear,
    adYearStatus: resolved.adYearStatus,
    type: garment.type,
    material: garment.material,
    model: garment.model,
    // The identity two listings must share to be the same piece. Everything
    // downstream — comps, resale value, spread — pools on exactly this.
    key: garmentKey({
      sublineId: resolved.sublineId, adYear,
      type: garment.type, material: garment.material, model: garment.model,
    }),
    // A name derived from that identity, so an item is never named after
    // whichever seller's title happened to arrive first.
    canonicalName: garmentName({
      sublineName: resolved.sublineName ?? resolved.sublineId,
      adYear,
      adYearStatus: resolved.adYearStatus,
      type: garment.type,
      material: garment.material,
      model: garment.model,
    }),
  };
}
