// Text normalisation for alias lookup.
//
// Latin and Japanese need genuinely different treatment and must not share one
// code path. Stripping combining marks is right for Latin ("Garçons" ->
// "garcons") and destructive for Japanese: NFKD decomposes dakuten, so
// "ジュンヤ" would fold to "シュンヤ" and stop matching. So: detect script
// first, then normalise per script.

const JA_RANGE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

/** @returns {'ja'|'latin'} */
export function detectScript(input) {
  return JA_RANGE.test(input) ? 'ja' : 'latin';
}

/**
 * Two forms come back, because they answer different questions.
 *
 *  - `spaced`  keeps word gaps, so short risky aliases ("HP", "CDG") can be
 *              matched on a word boundary instead of as a substring of some
 *              longer word.
 *  - `compact` drops them, so run-together forms in real listing titles
 *              ("CDGHP", "コム・デ・ギャルソン") still match.
 *
 * @returns {{ spaced: string, compact: string, script: 'ja'|'latin' }}
 */
export function normalizeAlias(input) {
  const script = detectScript(input);
  if (script === 'ja') {
    // NFKC folds halfwidth katakana to fullwidth and leaves dakuten intact.
    // Japanese has no word gaps, so spaced and compact coincide; interpuncts
    // and spacing are cosmetic ("コム・デ・ギャルソン" === "コムデギャルソン").
    const compact = input
      .normalize('NFKC')
      .replace(/[・･\s　]+/g, '')
      .toLowerCase();
    return { spaced: compact, compact, script };
  }

  const spaced = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining marks: ç -> c, é -> e
    .toLowerCase()
    // Keep '+' so "homme+" stays distinguishable from "homme".
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  return { spaced, compact: spaced.replace(/ /g, ''), script };
}

/**
 * The season a listing names, as a production year.
 *
 * The AD tag is a Comme des Garçons fact and nothing else in the roster has
 * one, so `parseAdYear` returns `unknown` for every Yohji, Rick Owens or
 * Undercover piece ever listed. The era segment of the identity key was
 * therefore `ad?` for all of them — which means a Yohji SS1998 coat and a Yohji
 * AW2019 coat were ONE item, sharing a comp set across twenty-one years of
 * production. That is a wrong merge of exactly the kind the identity key exists
 * to prevent, and it was silent, because a wrong pool produces plausible
 * numbers rather than an error.
 *
 * Meanwhile the sellers who do state the era mostly state it as a season:
 * "02AW", "AW03", "SS19", "FW2018". That is the same fact the AD tag carries,
 * written the way the market writes it.
 *
 * The two-digit century is resolved forward where it can be and backward
 * otherwise: "02" is 2002 rather than 1902, and "95" is 1995 rather than a year
 * that has not happened. A season that lands outside the storable range is
 * reported as no season rather than clamped into one, because a year invented
 * to satisfy a constraint is worse than an absent one.
 *
 * @returns {{ year: number|null, half: 'ss'|'aw'|null, code: string|null }}
 */
const SEASON_PATTERN =
  /\b(?:(ss|aw|fw|pf|pre|cr)[-\s.]?((?:19|20)?\d{2})|((?:19|20)?\d{2})[-\s.]?(ss|aw|fw))\b/i;

// The same floor the `items` table enforces on ad_year. A season code below it
// is far more often a model number or a measurement than a 1970s collection.
const EARLIEST_SEASON = 1988;

export function parseSeason(title) {
  const none = { year: null, half: null, code: null };
  const text = String(title ?? '');
  const match = text.match(SEASON_PATTERN);
  if (!match) return none;

  const [, leadHalf, leadYear, trailYear, trailHalf] = match;
  const rawHalf = (leadHalf ?? trailHalf ?? '').toLowerCase();
  const rawYear = leadYear ?? trailYear;
  if (!rawYear) return none;

  let year = Number(rawYear);
  if (!Number.isFinite(year)) return none;
  if (rawYear.length <= 2) {
    // Two digits name a year in living memory, on whichever side of 2000 has
    // already happened.
    year = year + 2000 <= new Date().getFullYear() + 1 ? year + 2000 : year + 1900;
  }
  if (year < EARLIEST_SEASON || year > new Date().getFullYear() + 1) return none;

  // fw and aw are the same half of the year under two names.
  const half = rawHalf === 'ss' ? 'ss' : rawHalf === 'aw' || rawHalf === 'fw' ? 'aw' : null;
  return { year, half, code: match[0].toUpperCase().replace(/[-\s.]/g, '') };
}

// AD tagging began around 1988. A title claiming an earlier AD year is either a
// misreading or a fake, so the range is bounded rather than trusted.
const AD_PATTERN = /\bA\.?D\.?\s*[-:]?\s*((?:19|20)\d{2})\b/i;

/**
 * Pull a Comme des Garçons AD year out of a listing title.
 *
 * Returns a status alongside the year because "no year" is ambiguous on its
 * own: a piece can predate AD tagging, or the seller simply did not mention
 * it. Those are different facts and the caller must be able to tell them apart.
 *
 * @returns {{ adYear: number|null, status: 'known'|'pre_ad_era'|'unknown' }}
 */
export function parseAdYear(title) {
  if (!title) return { adYear: null, status: 'unknown' };
  const match = title.match(AD_PATTERN);
  if (!match) return { adYear: null, status: 'unknown' };

  const year = Number(match[1]);
  // Parsed cleanly but outside the AD era: record the fact, not the number.
  if (year < 1988) return { adYear: null, status: 'pre_ad_era' };
  if (year > new Date().getFullYear() + 1) return { adYear: null, status: 'unknown' };
  return { adYear: year, status: 'known' };
}

/**
 * The production era a title states, however it states it.
 *
 * One function so that every reader of a year — the identity key, the
 * matchmaker's refusals, the item name — agrees about what a title said. They
 * had drifted: matching read only the AD tag while the matchmaker re-parsed the
 * title with its own regex, so a listing could be refused for disagreeing about
 * a year that neither of them had actually read the same way.
 *
 * `basis` says which fact it came from, and it is not decoration. An AD year is
 * printed on the garment's own tag; a season is what the seller wrote about
 * when the piece was made. Both identify the same production year and are
 * pooled together on purpose — AD2002 already spans SS02 and AW02, so folding
 * "02AW" into it changes nothing about how coarse the bucket is — but which one
 * a figure rests on is something a person should be able to see.
 *
 * @returns {{ year: number|null, status: 'known'|'pre_ad_era'|'unknown',
 *             basis: 'ad_tag'|'season'|null, seasonCode: string|null }}
 */
export function parseEraYear(title) {
  const ad = parseAdYear(title);
  if (ad.status === 'known') {
    return { year: ad.adYear, status: 'known', basis: 'ad_tag', seasonCode: null };
  }

  const season = parseSeason(title);
  if (season.year != null) {
    return { year: season.year, status: 'known', basis: 'season', seasonCode: season.code };
  }

  // A piece that predates AD tagging is a different fact from one whose seller
  // simply did not say, and parseAdYear already tells them apart. Carried
  // through rather than flattened.
  return { year: null, status: ad.status, basis: null, seasonCode: null };
}
