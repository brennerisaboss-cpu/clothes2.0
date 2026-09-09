// The brand registry.
//
// A curated list, deliberately — the brief's point that narrow scope is what
// makes matching tractable and the feed signal-dense holds however many brands
// are on it. This is a hand-built roster of houses whose naming quirks are
// known, not a general brand system.
//
// Each module exports the same three things:
//   brand    { id, display_name, monitored? }
//   sublines [{ id, display_name, monitored?, ambiguous?, note? }]
//   aliases  [{ alias, sub }]   sub: null means the alias names the house but
//                               not the line, so it cannot resolve on its own.
//
// Every brand has a mainline sub-line even where the house has no diffusion
// lines, so a resolved listing always lands somewhere specific rather than in a
// null bucket.

import * as cdg from './cdg.mjs';
import * as yohji from './yohji.mjs';
import * as ann from './ann.mjs';
import * as ccp from './ccp.mjs';
import * as guidi from './guidi.mjs';
import * as bbs from './bbs.mjs';
import * as rickOwens from './rickOwens.mjs';
import * as issey from './issey.mjs';
import * as margiela from './margiela.mjs';
import * as artisanal from './artisanal.mjs';
import * as japanese from './japanese.mjs';

const MODULES = [cdg, yohji, ann, ccp, guidi, bbs, rickOwens, issey, margiela];

// Two modules hold several small houses each: brands with no diffusion lines
// and few naming quirks do not each need a file, and keeping them together
// makes the roster easier to read as a whole.
const GROUPS = [artisanal, japanese];

export const BRANDS = [
  ...MODULES.map((m) => m.brand),
  ...GROUPS.flatMap((g) => g.brands),
];

export const SUBLINES = [
  ...MODULES.flatMap((m) => m.sublines.map((s) => ({ ...s, brand_id: m.brand.id }))),
  ...GROUPS.flatMap((g) => g.sublines),
];

export const ALIASES = [
  ...MODULES.flatMap((m) => m.aliases.map((a) => ({ ...a, brand: m.brand.id }))),
  ...GROUPS.flatMap((g) => g.aliases),
];

const SUBLINE_BY_ID = new Map(SUBLINES.map((s) => [s.id, s]));
const BRAND_BY_ID = new Map(BRANDS.map((b) => [b.id, b]));

export function sublineById(id) {
  return SUBLINE_BY_ID.get(id) ?? null;
}
export function brandById(id) {
  return BRAND_BY_ID.get(id) ?? null;
}

/** Sanity check run by the tests: ids must be unique and references must resolve. */
export function registryProblems() {
  const problems = [];
  const seenBrands = new Set();
  for (const b of BRANDS) {
    if (seenBrands.has(b.id)) problems.push(`duplicate brand id: ${b.id}`);
    seenBrands.add(b.id);
  }
  const seenSublines = new Set();
  for (const s of SUBLINES) {
    if (seenSublines.has(s.id)) problems.push(`duplicate subline id: ${s.id}`);
    seenSublines.add(s.id);
    if (!BRAND_BY_ID.has(s.brand_id)) problems.push(`subline ${s.id} references unknown brand ${s.brand_id}`);
  }
  for (const a of ALIASES) {
    if (!a.alias || !a.alias.trim()) problems.push('alias with empty text');
    if (a.sub && !SUBLINE_BY_ID.has(a.sub)) problems.push(`alias "${a.alias}" references unknown subline ${a.sub}`);
    if (a.brand && !BRAND_BY_ID.has(a.brand)) problems.push(`alias "${a.alias}" references unknown brand ${a.brand}`);
  }
  return problems;
}
