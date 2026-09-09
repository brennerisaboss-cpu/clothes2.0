// Helper for houses with no diffusion lines.
//
// Most of the artisanal roster is one designer, one line, and a handful of
// spellings. Writing each as its own file would be thirty near-identical
// blocks; the interesting cases (CDG, Yohji, BBS, Rick, Issey) keep their own
// files precisely because they are not simple.
//
// Every brand still gets a mainline sub-line, so a resolved listing always
// lands somewhere specific rather than in a null bucket.

/**
 * @param {Array<{
 *   id: string, name: string, aliases?: string[], ja?: string[],
 *   ambiguous?: boolean, monitored?: boolean, note?: string,
 *   extraSublines?: Array<{ id: string, name: string, aliases?: string[], ja?: string[], monitored?: boolean, note?: string }>,
 * }>} specs
 */
export function expand(specs) {
  const brands = [];
  const sublines = [];
  const aliases = [];

  for (const spec of specs) {
    brands.push({ id: spec.id, display_name: spec.name });

    const mainId = `${spec.id}-mainline`;
    sublines.push({
      id: mainId,
      brand_id: spec.id,
      display_name: spec.name,
      mainline: true,
      monitored: spec.monitored !== false,
      // A house whose name is also a common English word cannot be trusted to
      // resolve from a title alone.
      ambiguous: Boolean(spec.ambiguous),
      note: spec.note,
    });

    for (const alias of [spec.name, ...(spec.aliases ?? []), ...(spec.ja ?? [])]) {
      aliases.push({ alias, sub: mainId, brand: spec.id });
    }

    for (const extra of spec.extraSublines ?? []) {
      sublines.push({
        id: extra.id,
        brand_id: spec.id,
        display_name: extra.name,
        monitored: extra.monitored !== false,
        note: extra.note,
      });
      for (const alias of [extra.name, ...(extra.aliases ?? []), ...(extra.ja ?? [])]) {
        aliases.push({ alias, sub: extra.id, brand: spec.id });
      }
    }
  }

  return { brands, sublines, aliases };
}
