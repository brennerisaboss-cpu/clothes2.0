// Proposing that two descriptions are the same garment.
//
// The existing matcher is exact: a title resolves to a sub-line, a year, a
// type and a material, those five parts are the identity, and anything that
// does not resolve completely becomes an unresolved listing that pools with
// nothing and can never be scored. That is right as far as it goes, and it
// leaves most of the real world outside.
//
// The real world is that two sites describe one piece differently. Grailed
// says "Comme des Garcons Homme Plus AD2002 wool tailored jacket". Vestiaire
// says "Comme des Garçons — Wool jacket" and nothing else; its seller never
// typed the sub-line or the year. Those are the same coat and the exact
// matcher will never say so, because one of them does not state enough to be
// keyed at all.
//
// So this scores a listing against the items you already have, states what it
// agreed on and what it had to assume, and proposes. It never links anything
// by itself and never invents a sub-line: what it produces is a suggestion
// with its reasons attached, for you to accept or ignore.
//
// The rules it will not break, because they are the ones that make a comp mean
// something:
//
//   A different house is never the same garment. Not a score, a refusal.
//   A stated year that disagrees is a refusal. In archive clothing the year is
//     most of what a piece is worth.
//   A stated type or material that disagrees is a refusal. A wool coat is not
//     a leather jacket, however similar the words around them.
//   A stated model that disagrees is a refusal.
//
// Everything else is evidence, and evidence is weighed rather than obeyed.

import { describeGarment } from './garment.mjs';
import { resolveBrand } from './resolve.mjs';

/** Words that carry no identity and would otherwise inflate every overlap. */
const NOISE = new Set([
  'the', 'a', 'an', 'and', 'or', 'with', 'in', 'of', 'for', 'by', 'size', 'sz',
  'mens', 'men', 'womens', 'women', 'unisex', 'vintage', 'rare', 'archive',
  'authentic', 'genuine', 'new', 'nwt', 'nwot', 'used', 'worn', 'preowned',
  'condition', 'excellent', 'good', 'fair', 'mint', 'pristine',
  'ss', 'aw', 'fw', 'spring', 'summer', 'autumn', 'fall', 'winter',
  'free', 'shipping', 'sale', 'price', 'drop', 'reduced', 'off',
]);

/**
 * The words in a title that might identify a garment.
 *
 * `exclude` takes the alias the brand resolver matched. The house's own name
 * has to come out, and leaving it in is not a small error: every listing from
 * one house shares those words, so "Comme des Garçons piece" and "Comme des
 * Garçons something" overlapped 80% on the brand alone and read as the same
 * garment. The house is already required to match; it cannot also be evidence.
 *
 * Accents are folded rather than decomposed. NFKD alone splits "garçons" into
 * "garc" and a stray combining mark, and the mark is then stripped as
 * punctuation — leaving two tokens that match nothing and inflate every
 * comparison against another mangled copy of themselves.
 */
export function meaningfulTokens(title, exclude = null) {
  const excluded = exclude ? meaningfulTokens(exclude) : null;
  return new Set(
    String(title ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 2 &&
          !NOISE.has(w) &&
          !/^\d{1,2}$/.test(w) &&
          !(excluded && excluded.has(w)),
      ),
  );
}

/**
 * Tokens for a name that is asked for repeatedly.
 *
 * One listing is compared against every item held for its house, so the same
 * item name is tokenised once per listing — four hundred thousand times over a
 * paste of two hundred rows against two thousand items, which was four seconds
 * of a page load. The set for a given name and alias never changes, so it is
 * computed once.
 *
 * Bounded, because it is keyed by name and a long-running server would
 * otherwise hold one entry per item it has ever seen.
 */
const TOKEN_CACHE = new Map();

function tokensFor(name, alias) {
  const key = `${alias ?? ''}\u0000${name ?? ''}`;
  const hit = TOKEN_CACHE.get(key);
  if (hit) return hit;
  const tokens = meaningfulTokens(name, alias);
  if (TOKEN_CACHE.size > 20000) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

/** Shared words as a fraction of the smaller vocabulary. */
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * How well one listing matches one item, and why.
 *
 * @param {{title_raw: string, brand_id?: string|null, subline_id?: string|null}} listing
 * @param {{identity_key: string, canonical_name: string, brand_id: string,
 *          subline_id: string|null, ad_year: number|null}} item
 * @returns {{score: number, tier: string, agreements: string[], assumptions: string[],
 *            conflict: string|null}}
 */
export function scoreMatch(listing, item) {
  const refuse = (conflict) => ({ score: 0, tier: 'no', agreements: [], assumptions: [], conflict });

  // Derived once and carried, because the caller compares one listing against
  // every item held for its house: re-reading the same title two thousand
  // times to learn the same four facts is most of what a page load would cost.
  const resolved = listing.resolved ?? resolveBrand(listing.title_raw ?? '');
  const brandId = listing.brand_id ?? resolved.brandId;
  if (!brandId || !item.brand_id) return refuse('the house is not identified on both sides');
  if (brandId !== item.brand_id) return refuse('a different house');

  const listingSubline = listing.subline_id ?? resolved.sublineId ?? null;
  if (listingSubline && item.subline_id && listingSubline !== item.subline_id) {
    return refuse('a different sub-line');
  }

  // The item's own identity, read back out of its key rather than re-derived
  // from its name: the key is what the rest of the system pools on.
  const [, keyYear, keyType, keyMaterial, keyModel] = String(item.identity_key ?? '').split('|');
  const itemFacts = {
    adYear: /^ad(\d{4})$/.exec(keyYear ?? '')?.[1] ?? null,
    type: keyType && keyType !== '?' ? keyType : null,
    material: keyMaterial && keyMaterial !== '?' ? keyMaterial : null,
    model: keyModel && keyModel !== '?' ? keyModel : null,
  };

  const garment = listing.garment ?? describeGarment(listing.title_raw ?? '');
  // The era as the brand resolver read it, rather than a second AD-only regex
  // living here. Two readers of the same title disagreeing about the year is a
  // refusal produced by this file rather than by the listing: a piece stating
  // "AW03" had no year here and 2003 there, so it was proposed against items it
  // demonstrably contradicts and refused against the one it belongs to.
  const listingYear =
    listing.listingYear ?? (resolved.adYear != null ? String(resolved.adYear) : null);

  const agreements = [];
  const assumptions = [];
  let score = 0;

  // Each of these is a refusal when both sides state something and disagree,
  // evidence when they agree, and silence when one side never said.
  const compare = (mine, theirs, weight, name) => {
    if (mine && theirs) {
      if (mine !== theirs) return `a different ${name}`;
      agreements.push(`${name} ${mine}`);
      score += weight;
      return null;
    }
    if (!mine && theirs) assumptions.push(`the listing never states a ${name}`);
    return null;
  };

  for (const [mine, theirs, weight, name] of [
    [listingYear, itemFacts.adYear, 3, 'year'],
    [garment.type, itemFacts.type, 3, 'garment'],
    [garment.material, itemFacts.material, 2, 'material'],
    [garment.model, itemFacts.model, 4, 'model'],
  ]) {
    const conflict = compare(mine, theirs, weight, name);
    if (conflict) return refuse(conflict);
  }

  // The sub-line the item has and the listing does not. This is the assumption
  // that matters, and it is never made quietly: a sub-line decides which comp
  // pool a piece joins, and joining the wrong one corrupts both.
  if (!listingSubline && item.subline_id) {
    assumptions.push(`it would be filed as ${item.subline_id}, which the listing does not say`);
  }

  const words = overlap(
    listing.tokens ?? tokensFor(listing.title_raw, resolved.matchedAlias),
    tokensFor(item.canonical_name, resolved.matchedAlias),
  );
  score += Math.round(words * 3);
  if (words >= 0.5) agreements.push(`${Math.round(words * 100)}% of the describing words`);

  // Structural agreement is worth more than wording, so the tier is set by how
  // much of the identity actually lined up rather than by the total.
  const structural = agreements.filter((a) => !a.includes('%')).length;
  const tier =
    score >= 8 && structural >= 3 ? 'strong'
    : score >= 5 && structural >= 2 ? 'likely'
    : score >= 3 ? 'possible'
    : 'no';

  return { score, tier, agreements, assumptions, conflict: null };
}

/**
 * The items worth proposing for one listing, best first.
 *
 * Returns nothing rather than something weak: a wrong suggestion offered
 * confidently costs more than no suggestion, because accepting one is a click
 * and unpicking it is not.
 */
export function suggestMatches(listing, items, { limit = 3 } = {}) {
  const resolved = resolveBrand(listing.title_raw ?? '');
  const prepared = {
    ...listing,
    resolved,
    garment: describeGarment(listing.title_raw ?? ''),
    listingYear: resolved.adYear != null ? String(resolved.adYear) : null,
    tokens: meaningfulTokens(listing.title_raw, resolved.matchedAlias),
  };
  return (items ?? [])
    .map((item) => ({ item, ...scoreMatch(prepared, item) }))
    .filter((m) => m.tier !== 'no')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * May this suggestion be applied without asking?
 *
 * Only when nothing was assumed. In practice that means the listing already
 * states its sub-line and agrees with the item on everything else it says —
 * the case where the exact matcher would have got there too if the item had
 * existed when the listing arrived. Anything resting on an assumption stays a
 * suggestion however high it scores.
 */
export function safeToApply(match) {
  return match.tier === 'strong' && match.assumptions.length === 0 && !match.conflict;
}


/**
 * The facts a listing states about itself.
 *
 * "States" is the operative word: a null here means the seller never said,
 * which is compatible with anything. A wrong non-null is what has to be caught.
 */
export function factsOf(listing) {
  const resolved = resolveBrand(listing.title_raw ?? '');
  const garment = describeGarment(listing.title_raw ?? '');
  return {
    brandId: listing.brand_id ?? resolved.brandId ?? null,
    sublineId: listing.subline_id ?? resolved.sublineId ?? null,
    adYear: resolved.adYear != null ? String(resolved.adYear) : null,
    type: garment.type,
    material: garment.material,
    model: garment.model,
    // Without the house's own name in them: see meaningfulTokens.
    tokens: meaningfulTokens(listing.title_raw, resolved.matchedAlias),
  };
}

/**
 * Could these two listings be the same garment?
 *
 * The same four refusals as scoreMatch, applied between two listings rather
 * than between a listing and an item — because the case this exists for has no
 * item on either side. Two Vestiaire rows of one unnamed coat, and nothing
 * else in the data: the matchmaker has nothing to propose them against, and
 * they sit unresolved forever, pooling with nothing.
 */
export function compareListings(a, b) {
  const x = a.facts ?? factsOf(a);
  const y = b.facts ?? factsOf(b);

  if (!x.brandId || !y.brandId) return { compatible: false, conflict: 'the house is not identified' };
  if (x.brandId !== y.brandId) return { compatible: false, conflict: 'a different house' };
  if (x.sublineId && y.sublineId && x.sublineId !== y.sublineId) {
    return { compatible: false, conflict: 'a different sub-line' };
  }

  const agreements = [];
  for (const [name, mine, theirs] of [
    ['year', x.adYear, y.adYear],
    ['garment', x.type, y.type],
    ['material', x.material, y.material],
    ['model', x.model, y.model],
  ]) {
    if (mine && theirs) {
      if (mine !== theirs) return { compatible: false, conflict: `a different ${name}` };
      agreements.push(`${name} ${mine}`);
    }
  }

  // Two listings that agree only because neither says anything are not a
  // match, they are two silences. Something has to have been stated.
  const words = overlap(x.tokens, y.tokens);
  if (!agreements.length && words < 0.6) {
    return { compatible: false, conflict: 'nothing stated in common' };
  }

  return { compatible: true, conflict: null, agreements, words };
}

/**
 * Group unresolved listings by what they appear to be.
 *
 * Complete linkage: a listing joins a group only if it is compatible with
 * EVERY member, never merely with one of them. Single linkage would chain — a
 * wool jacket and an unlabelled jacket and a leather jacket would become one
 * group through the middle member, and the two ends contradict each other.
 *
 * Nothing here creates or links anything. It produces groups to be shown, with
 * the facts they share and the ones only some of them state.
 */
export function clusterListings(listings, { minSize = 2 } = {}) {
  const prepared = (listings ?? []).map((l) => ({ ...l, facts: factsOf(l) }));
  const groups = [];

  for (const listing of prepared) {
    const home = groups.find((group) =>
      group.members.every((member) => compareListings(member, listing).compatible),
    );
    if (home) home.members.push(listing);
    else groups.push({ members: [listing] });
  }

  return groups
    .filter((g) => g.members.length >= minSize)
    .map((g) => {
      const stated = (key) => [...new Set(g.members.map((m) => m.facts[key]).filter(Boolean))];
      const shared = {
        brandId: g.members[0].facts.brandId,
        sublineId: stated('sublineId')[0] ?? null,
        adYear: stated('adYear')[0] ?? null,
        type: stated('type')[0] ?? null,
        material: stated('material')[0] ?? null,
        model: stated('model')[0] ?? null,
      };

      // What only some of them said. Applying it to the whole group is an
      // inference about the ones that stayed silent, so it is named.
      const assumptions = [];
      for (const [name, key] of [
        ['sub-line', 'sublineId'], ['year', 'adYear'],
        ['garment', 'type'], ['material', 'material'], ['model', 'model'],
      ]) {
        const said = g.members.filter((m) => m.facts[key]).length;
        if (shared[key] && said < g.members.length) {
          assumptions.push(`${g.members.length - said} of ${g.members.length} never state a ${name}`);
        }
      }
      if (!shared.sublineId) {
        assumptions.push('none of them names a sub-line, so one has to be chosen');
      }

      return {
        members: g.members.map(({ facts, ...rest }) => rest),
        shared,
        assumptions,
        agreements: Object.entries(shared)
          .filter(([key, value]) => value && key !== 'brandId' && key !== 'sublineId')
          .map(([key, value]) => `${key === 'type' ? 'garment' : key} ${value}`),
      };
    })
    .sort((a, b) => b.members.length - a.members.length);
}

/**
 * Which of these caller-supplied pairs may actually be linked, and why not.
 *
 * The bulk-accept button sends {listingId, itemId} pairs, and the safety
 * property — "bulk-accept only ever links strong, unassumptive matches" — used
 * to live entirely in which pairs the page chose to render. A server action is
 * an independently callable POST, so that was no enforcement at all: anything
 * able to call it could link any listing to any item, and a wrong link pools a
 * garment into another garment's comp set, which is what every valuation is
 * computed from.
 *
 * So the decision is re-derived here, from the listing and item rows as they
 * are now, and the caller's opinion is used for nothing but naming the pair.
 * Kept out of the action so it can be tested without a database or a request.
 *
 * @param {{listingId: string, itemId: string}[]} pairs
 * @param {Map<string, object>} listingsById
 * @param {object[]} items  candidates, as itemsForBrands returns them
 * @returns {{allowed: {listingId: string, itemId: string}[], refused: string[]}}
 */
export function admissibleLinks(pairs, listingsById, items) {
  const allowed = [];
  const refused = [];

  for (const { listingId, itemId } of pairs ?? []) {
    const listing = listingsById.get(listingId);
    if (!listing) {
      refused.push(`${listingId}: no such listing`);
      continue;
    }
    const name = String(listing.title_raw ?? listingId).slice(0, 40);

    // Already linked. Re-pointing an existing link is a correction, and a
    // correction is a deliberate single act — never something a bulk button
    // does to a row the operator has already decided about.
    if (listing.item_id) {
      refused.push(`${name}: already linked`);
      continue;
    }

    const match = suggestMatches(listing, items, { limit: 50 })
      .find((m) => m.item.id === itemId);

    if (!match) {
      refused.push(`${name}: is not a match for that item`);
      continue;
    }
    // safeToApply, not tier === 'strong'. A strong tier can still rest on an
    // assumption, and those are exactly the ones worth a person's eye — the
    // page had been filtering on the weaker of the two.
    if (!safeToApply(match)) {
      refused.push(`${name}: rests on an assumption — resolve it individually`);
      continue;
    }
    allowed.push({ listingId, itemId });
  }

  return { allowed, refused };
}
