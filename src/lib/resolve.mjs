// Deterministic sub-line resolution.
//
// Layer 1 of the two-layer matching plan. This resolves a listing title to a
// brand and, where it can, a sub-line. It deliberately refuses rather than
// guesses: an unresolved sub-line is a visible flag in the UI, not a silent
// assignment to mainline. Pooling a Homme Plus piece into mainline comps is
// exactly the failure mode the brief calls out.

import { normalizeAlias, parseEraYear } from './normalize.mjs';
import { ALIASES, sublineById } from './brands/index.mjs';

// Aliases at or below this length are too collision-prone to match as a bare
// substring ("hp" inside "shprs"). They must land on a word boundary.
const SHORT_ALIAS_MAX = 3;

const INDEX = ALIASES.map((entry) => {
  const { spaced, compact, script } = normalizeAlias(entry.alias);
  const subline = entry.sub ? sublineById(entry.sub) : null;
  return {
    ...entry,
    spaced,
    compact,
    script,
    // Specificity beats length, and the two disagree often.
    //
    // "Rick Owens" is longer than "DRKSHDW" but names the house; "Carol
    // Christian Poell" is longer than "Scarstitch" but says nothing about which
    // piece. So aliases are ranked in tiers — a named line or model first, then
    // a house's default line, then the house itself — and length only breaks
    // ties inside a tier, where it still does the right thing ("homme plus"
    // over "homme").
    tier: !entry.sub ? 2 : subline?.mainline ? 1 : 0,
    weight: compact.length,
    short: compact.length <= SHORT_ALIAS_MAX,
  };
}).sort((a, b) => (a.tier - b.tier) || (b.weight - a.weight));

function occurs(entry, haystack) {
  if (entry.script === 'ja') {
    // No word boundaries exist in Japanese; substring matching is correct here.
    return haystack.compact.includes(entry.compact);
  }
  if (entry.short) {
    // Word-boundary only. Escape '+' since it is regex-significant and we
    // deliberately keep it in the normalised form.
    const safe = entry.spaced.replace(/[+]/g, '\\+');
    return new RegExp(`(?:^| )${safe}(?: |$)`).test(haystack.spaced);
  }

  // Two boundary rules, both of them about a match that stops in the middle of
  // something longer.
  //
  // '+' is a meaningful character in these names, not punctuation: "Homme Plus"
  // is written "Homme+" as often as not. So a match must not stop short of one
  // and quietly downgrade Homme Plus to Homme.
  //
  // A DIGIT at either end is the same problem and it is everywhere in this
  // roster — Guidi names boots "996" and derbies "6006", Issey has "132 5",
  // Julius "Julius_7", Margiela numbers its lines. Matched as bare substrings
  // those run into any longer number a title happens to carry: "Maison Martin
  // Margiela 1998" resolved to Line 1, because "margiela1" is a prefix of
  // "margiela1998". A wrong sub-line is the worst resolution failure there is —
  // it does not fail, it pools a garment into another line's comp set and
  // prices it there.
  //
  // So a numeric edge has to land on a numeric boundary, the same way a short
  // alias has to land on a word boundary.
  const endsWithPlus = entry.compact.endsWith('+');
  const endsWithDigit = /\d$/.test(entry.compact);
  const startsWithDigit = /^\d/.test(entry.compact);
  const digit = (ch) => ch != null && ch >= '0' && ch <= '9';

  let from = 0;
  for (;;) {
    const at = haystack.compact.indexOf(entry.compact, from);
    if (at === -1) return false;
    const next = haystack.compact[at + entry.compact.length];
    const before = at > 0 ? haystack.compact[at - 1] : null;

    const cutsAPlus = !endsWithPlus && next === '+';
    const cutsANumber =
      (endsWithDigit && digit(next)) || (startsWithDigit && digit(before));

    if (!cutsAPlus && !cutsANumber) return true;
    from = at + 1;
  }
}

/**
 * Resolve brand and sub-line from free text (a listing title, or whatever the
 * source calls the brand).
 *
 * @returns {{
 *   brandId: string|null,
 *   sublineId: string|null,
 *   confident: boolean,
 *   ambiguous: boolean,
 *   monitored: boolean,
 *   reason: string,
 *   matchedAlias: string|null,
 *   adYear: number|null,
 *   adYearStatus: string,
 *   adYearBasis: 'ad_tag'|'season'|null,
 *   seasonCode: string|null,
 * }}
 */
export function resolveBrand(text) {
  // The era, from whichever of the two ways a title states it. An AD tag is
  // read off the garment; a season code is what the rest of the roster's
  // sellers write instead, and without it every Yohji, Rick Owens and
  // Undercover piece keyed as the same unknown year and pooled across decades.
  const { year: adYear, status: adYearStatus, basis: adYearBasis, seasonCode } =
    parseEraYear(text ?? '');
  const base = {
    brandId: null,
    sublineId: null,
    confident: false,
    ambiguous: false,
    monitored: true,
    matchedAlias: null,
    adYear,
    adYearStatus,
    // Which fact the year came from, so a figure resting on a season code can
    // be told apart from one resting on the tag itself.
    adYearBasis,
    seasonCode,
  };

  if (!text || !text.trim()) {
    return { ...base, reason: 'empty input' };
  }

  // Match Latin and Japanese aliases against the input independently, since a
  // title can mix scripts ("コムデギャルソン Homme Plus AD2002").
  const haystackLatin = normalizeAlias(text.replace(/[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/g, ' '));
  const haystackJa = normalizeAlias(text);

  let houseHit = null;
  let sublineHit = null;

  for (const entry of INDEX) {
    const haystack = entry.script === 'ja' ? haystackJa : haystackLatin;
    if (!occurs(entry, haystack)) continue;

    if (entry.sub) {
      // INDEX is sorted by tier then length, so the first sub-line hit is
      // already the most specific one.
      if (!sublineHit) sublineHit = entry;
    } else if (!houseHit) {
      houseHit = entry;
    }
  }

  if (!sublineHit && !houseHit) {
    return { ...base, reason: 'no alias matched' };
  }

  if (!sublineHit) {
    // The house is identified but the line is not. This is the "CDG" case, and
    // the same holds for Yohji and Issey: genuinely ambiguous, so it is flagged
    // for manual resolution rather than assigned to a mainline it may not be.
    return {
      ...base,
      brandId: houseHit.brand ?? null,
      ambiguous: true,
      matchedAlias: houseHit.alias,
      reason: `matched house alias "${houseHit.alias}" but no sub-line — resolve by hand`,
    };
  }

  const subline = sublineById(sublineHit.sub);
  const ambiguous = Boolean(subline?.ambiguous);

  return {
    ...base,
    brandId: sublineHit.brand ?? subline?.brand_id ?? null,
    sublineId: sublineHit.sub,
    // The house's own name for the line, so a generated item name reads the way
    // the house writes it rather than as an internal id.
    sublineName: subline?.display_name ?? null,
    confident: !ambiguous,
    ambiguous,
    monitored: subline?.monitored !== false,
    matchedAlias: sublineHit.alias,
    reason: ambiguous
      ? `"${sublineHit.alias}" is ambiguous by name — resolve by hand`
      : `matched sub-line alias "${sublineHit.alias}"`,
  };
}
