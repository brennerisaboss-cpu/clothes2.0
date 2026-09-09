// Reading a size, and what it is worth as a comp.
//
// Size is not identity, and the temptation to make it identity is the reason
// this file explains itself at length.
//
// Putting size in the identity key would be easy and wrong. It would fragment
// every comp pool by size, and since MIN_COMPS is three, most items would drop
// below it and stop being valued at all — the same failure the garment
// vocabulary is deliberately coarse to avoid. One garment is one item however
// many sizes it was cut in.
//
// But size is not nothing either. On these venues a Yohji 3 and a Yohji 1 are
// the same coat and not the same money: the buyer pool for a mid size is
// several times larger, and the gap runs to tens of percent on the same piece.
// A median drawn across every size answers "what does this coat fetch" when the
// question asked was "what does THIS ONE fetch".
//
// So size is EVIDENCE QUALITY, which is where the rest of this platform already
// puts facts of that shape. A confirmed sale outweighs an ask; a fresh
// observation outweighs a stale one; and a comp in the size you are holding
// outweighs one three sizes away. It multiplies the observation's weight and
// changes nothing about which pool the piece belongs to.
//
// TWO REFUSALS, both of them the same rule this codebase applies everywhere.
//
//   A size that cannot be read confidently is UNKNOWN, and an unknown size
//   never discounts anything. Silence is compatible with any size; only a
//   stated size that demonstrably differs is evidence of a difference. So this
//   can demote a comp it can prove is the wrong size and can never promote one
//   on an assumption.
//
//   Sizes are compared only WITHIN a sizing system. A Yohji 3, a CDG M and an
//   IT 50 are roughly one another, and "roughly" is a conversion table somebody
//   would then be trusting to the nearest step. Across systems this returns
//   neutral rather than a guess.

/** Never zero: a comp in the wrong size still says the piece exists at a price. */
export const FLOOR_WEIGHT = 0.2;

// Alpha sizing, and the katakana forms Japanese shops write it in.
const ALPHA = new Map([
  ['xxs', 0], ['xs', 1], ['s', 2], ['m', 3], ['l', 4], ['xl', 5], ['xxl', 6], ['xxxl', 7],
  ['2xl', 6], ['3xl', 7],
  ['エクストラスモール', 1], ['スモール', 2], ['ミディアム', 3], ['ラージ', 4],
]);

const REGION_PREFIX = /^(eu|uk|us|it|fr|jp|de)\s*[-.]?\s*(\d{1,3})$/i;

/**
 * The sizing system a number belongs to, from its magnitude.
 *
 * Only the two ranges that are unambiguous in this roster:
 *
 *   1–7    Japanese designer sizing. CDG, Yohji and Issey all cut to it, and it
 *          is what a Japanese feed prints. A bare "3" is not a chest
 *          measurement in any system.
 *   42–60  European garment sizing, even steps.
 *
 * Everything between is refused rather than assigned. A bare "32" is a US waist
 * on trousers and a bust on a dress, and a bare "44" is an EU jacket or a US
 * waist depending on what the piece is — deciding would be inventing the one
 * fact that makes the comparison mean anything.
 */
function numericSystem(n) {
  if (Number.isInteger(n) && n >= 1 && n <= 7) return { region: 'JP', ordinal: n - 1 };
  if (Number.isInteger(n) && n >= 42 && n <= 60) return { region: 'EU', ordinal: (n - 42) / 2 };
  return null;
}

/**
 * Read a size.
 *
 * @param {string|null|undefined} raw  the seller's own size string
 * @returns {{ region: string, ordinal: number|null, label: string|null }}
 *
 * `region` is 'UNKNOWN' whenever the size could not be read, which is the
 * common case and not a failure: most feeds state no size at all.
 */
export function parseSize(raw) {
  const none = { region: 'UNKNOWN', ordinal: null, label: null };
  const text = String(raw ?? '').trim();
  if (!text) return none;

  // Strip the words sellers wrap a size in, and normalise the separators.
  const cleaned = text
    .toLowerCase()
    .replace(/\b(size|sz|talla|taille|サイズ)\b/g, ' ')
    .replace(/[（(].*?[）)]/g, ' ')
    .trim();

  // A size quoted with the system it belongs to says both things outright, so
  // it is read first and never has to be inferred.
  const prefixed = REGION_PREFIX.exec(cleaned.replace(/\s+/g, ' '));
  if (prefixed) {
    const region = prefixed[1].toUpperCase();
    const n = Number(prefixed[2]);
    // The stated system wins, but the ordinal still has to come from a scale
    // this understands. An IT 50 is an EU 50 by another name.
    if ((region === 'EU' || region === 'IT' || region === 'FR' || region === 'DE') &&
        n >= 42 && n <= 60) {
      return { region: 'EU', ordinal: (n - 42) / 2, label: text };
    }
    if (region === 'JP' && n >= 1 && n <= 7) return { region: 'JP', ordinal: n - 1, label: text };
    // A stated system this has no scale for is still a real fact about the
    // listing; it simply cannot be placed on an axis, so it compares with
    // nothing rather than with the wrong thing.
    return { region: 'UNKNOWN', ordinal: null, label: text };
  }

  const token = cleaned.replace(/[\s.\-/]/g, '');
  if (ALPHA.has(token)) return { region: 'ALPHA', ordinal: ALPHA.get(token), label: text };

  if (/^\d{1,2}$/.test(token)) {
    const system = numericSystem(Number(token));
    if (system) return { ...system, label: text };
  }

  return { ...none, label: text || null };
}

/**
 * How much a comp of one size is worth when valuing a piece of another.
 *
 * Neutral — full weight — whenever either side is unknown or the two are sized
 * in different systems. That asymmetry is the point: this discounts a comp it
 * can prove is the wrong size, and never promotes one it merely hopes is the
 * right one.
 *
 * The steps are deliberately gentle. One size out is still a good comp for the
 * same garment; three sizes out is a comp for a piece with a materially
 * different buyer pool, and is still evidence that the garment trades at
 * roughly this level. Nothing here is precise enough to justify a curve.
 */
export function sizeWeight(target, comp) {
  if (!target || !comp) return 1;
  if (target.ordinal == null || comp.ordinal == null) return 1;
  if (target.region === 'UNKNOWN' || comp.region === 'UNKNOWN') return 1;
  if (target.region !== comp.region) return 1;

  const steps = Math.abs(target.ordinal - comp.ordinal);
  if (steps === 0) return 1;
  if (steps === 1) return 0.7;
  if (steps === 2) return 0.4;
  return FLOOR_WEIGHT;
}

/**
 * Annotate observations with what each is worth against one target size.
 *
 * Returns the observations unchanged when the target size cannot be read, so
 * the whole mechanism is inert rather than approximately active — which is the
 * state most listings are in, most feeds stating no size at all.
 */
export function weighBySize(observations, targetRaw) {
  const target = parseSize(targetRaw);
  if (target.ordinal == null) return { observations, target, comparable: 0, offSize: 0 };

  let comparable = 0;
  let offSize = 0;
  const weighed = observations.map((o) => {
    const comp = parseSize(o.size_raw);
    const weight = sizeWeight(target, comp);
    if (comp.ordinal != null && comp.region === target.region) {
      comparable++;
      if (comp.ordinal !== target.ordinal) offSize++;
    }
    return weight === 1 ? o : { ...o, sizeWeight: weight };
  });

  return { observations: weighed, target, comparable, offSize };
}
