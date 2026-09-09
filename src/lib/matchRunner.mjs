// Re-run deterministic matching over every unmatched listing.
//
// This existed only as a server action behind a button on /unresolved, which
// meant the matching stage of the pipeline could not run without a browser.
// Everything that does NOT arrive through a poll — a pasted page, the capture
// endpoint, an alert email read from a mailbox — lands with `item_id` null and
// stayed that way until somebody opened the app and clicked. A listing with no
// item is invisible to every comparison the platform makes: it pools with
// nothing, has no comps, and can never be scored. So a scheduled install
// collected diligently and produced nothing, and the reason was a click.
//
// Framework-free, like pollRunner and alertRunner, so `npm run match` and the
// server action are the same code rather than two implementations that agree
// until they do not.

import { planMatch } from './matching.mjs';
import { suggestMatches, safeToApply } from './matchmaker.mjs';

/**
 * The item a plan names, created if this is its first sighting.
 *
 * Insert-or-return in one statement. A select-then-insert leaves a window in
 * which a poll and a hand-entry both find nothing and both insert, giving one
 * garment two items and splitting its comps in half — with no error raised,
 * since both inserts succeed. The unique index on identity_key closes it, and
 * ON CONFLICT turns the loser into a read rather than a crash.
 */
async function findOrCreateItem(client, plan, brandId) {
  const { rows } = await client.query(
    `insert into items (brand_id, subline_id, canonical_name, ad_year, ad_year_status,
                        ad_year_basis, identity_key)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (identity_key) do update set identity_key = excluded.identity_key
     returning id`,
    [
      brandId,
      plan.sublineId,
      plan.canonicalName,
      plan.adYear ?? null,
      plan.adYearStatus ?? 'unknown',
      plan.adYear == null ? null : (plan.adYearBasis ?? 'ad_tag'),
      plan.key,
    ],
  );
  return rows[0]?.id ?? null;
}

async function brandForSubline(client, sublineId) {
  const { rows } = await client.query('select brand_id from sublines where id = $1', [sublineId]);
  return rows[0]?.brand_id ?? null;
}

/**
 * Items of the same houses as the listings still unmatched, for the second pass.
 *
 * Narrowed by house, which is the one thing the matchmaker will never cross and
 * the cheapest filter there is.
 */
async function itemsForBrands(client, brandIds) {
  if (!brandIds.length) return [];
  const { rows } = await client.query(
    `select i.id, i.identity_key, i.canonical_name, i.brand_id, i.subline_id, i.ad_year
       from items i
      where i.brand_id = any($1::text[])
      order by i.canonical_name
      limit 2000`,
    [brandIds],
  );
  return rows;
}

/**
 * @param {object} opts
 * @param {import('pg').PoolClient} opts.client
 *   A client of its own. This issues `begin`/`commit` per listing so one
 *   failure cannot take the batch with it, which means handing it a client that
 *   is already inside a transaction commits that transaction as a side effect.
 *   Every caller connects one for the purpose; a future one should too.
 * @param {boolean} [opts.acceptSafeSuggestions]
 *   Also link listings the exact matcher cannot key, but which the matchmaker
 *   scores as strong against an existing item WITH NOTHING ASSUMED — the same
 *   test `admissibleLinks` applies to the bulk-accept button, which is to say
 *   the case where the listing states its own sub-line and agrees with the item
 *   on every fact either of them states. It is off by default and has to be
 *   asked for, because "nothing is ever linked without you" is a rule this
 *   codebase keeps and a scheduled job is not a person. Asking for it moves the
 *   line from "no link without a person" to "no link without a person, or an
 *   agreement with nothing assumed", which is a decision to make deliberately.
 */
export async function runMatching({ client, acceptSafeSuggestions = false } = {}) {
  const { rows: unmatched } = await client.query(
    `select id, brand_raw, title_raw from listings where item_id is null`,
  );

  let matched = 0;
  let suggested = 0;
  const skipped = [];

  const stillUnmatched = [];

  for (const row of unmatched) {
    const plan = planMatch(row);
    if (!plan.matchable || !plan.sublineId) {
      stillUnmatched.push({ row, plan });
      continue;
    }

    await client.query('begin');
    try {
      const brandId = plan.resolved?.brandId ?? (await brandForSubline(client, plan.sublineId));
      if (!brandId) throw new Error(`no brand for sub-line ${plan.sublineId}`);
      const itemId = await findOrCreateItem(client, plan, brandId);
      await client.query('update listings set item_id = $1 where id = $2', [itemId, row.id]);
      await client.query('commit');
      matched++;
    } catch (err) {
      await client.query('rollback');
      skipped.push({
        title: row.title_raw,
        reason: err instanceof Error ? err.message : 'match failed',
      });
    }
  }

  if (!acceptSafeSuggestions) {
    for (const { row, plan } of stillUnmatched) {
      skipped.push({ title: row.title_raw, reason: plan.reason });
    }
    return { considered: unmatched.length, matched, suggested, skipped };
  }

  // Second pass. The exact matcher refuses anything it cannot key completely,
  // and most of what these venues publish cannot be keyed completely — a
  // Vestiaire seller who typed "Comme des Garçons — Wool jacket" and nothing
  // else has stated no sub-line and no era. The matchmaker scores those against
  // the items already held for the house and says what it agreed on and what it
  // had to assume; only the ones assuming NOTHING are linked here.
  const brands = [
    ...new Set(stillUnmatched.map(({ plan }) => plan.resolved?.brandId).filter(Boolean)),
  ];
  const items = await itemsForBrands(client, brands);

  for (const { row, plan } of stillUnmatched) {
    const best = suggestMatches(row, items, { limit: 1 })[0];
    if (!best || !safeToApply(best)) {
      skipped.push({ title: row.title_raw, reason: plan.reason });
      continue;
    }
    await client.query('update listings set item_id = $1 where id = $2', [best.item.id, row.id]);
    suggested++;
  }

  return { considered: unmatched.length, matched, suggested, skipped };
}
