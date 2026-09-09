'use server';

import { revalidatePath } from 'next/cache';
import { pool, query, one } from '@/lib/db';
import { itemsForBrands } from '@/lib/queries';
import { toBase } from '@/lib/fx';
import { resolveBrand } from '@/lib/resolve.mjs';
import { prefillFromUrl } from '@/lib/urlPrefill.mjs';
import { parseBulk } from '@/lib/bulkPaste.mjs';
import type { PastedLink } from '@/lib/bulkPaste.mjs';
import { runMatching as matchUnmatched } from '@/lib/matchRunner.mjs';
import { suggestMatches, safeToApply, clusterListings, admissibleLinks } from '@/lib/matchmaker.mjs';
import { describeGarment, garmentKey, garmentName } from '@/lib/garment.mjs';
import { requireUnlocked } from '@/lib/session';

export type SaveInput = {
  title: string;
  brandRaw?: string;
  sourceId: string;
  sourceItemId?: string;
  sizeRaw?: string;
  sizeRegion?: string;
  conditionRaw?: string;
  conditionTier?: string;
  price: string | number;
  currency: string;
  url?: string;
  imageUrl?: string;
  notes?: string;
  sublineId?: string;
  adYear?: string | number;
  /**
   * This is a piece that SOLD at this price, not one being asked for.
   *
   * The one thing a person can state that no adapter can infer, and the reason
   * it is here rather than only behind an API: Grailed, Vestiaire and The
   * RealReal all show their sold listings with the price they went for, and
   * copying that page is the same act as copying a page of live ones — the
   * mechanism the whole manual tier already rests on. It needs no credentials,
   * no approval and no exception to anybody's terms, and it reaches every venue
   * rather than the one that happens to publish a sales API.
   *
   * `soldAt` dates the sale. Absent, it is today — which is right for a page
   * you are looking at now and wrong for a sale you are entering from memory,
   * so the form asks.
   */
  sold?: boolean;
  soldAt?: string;
};

const SIZE_REGIONS = new Set(['EU', 'US', 'UK', 'JP', 'IT', 'FR', 'ALPHA', 'UNKNOWN']);
const TIERS = new Set(['damaged', 'fair', 'good', 'excellent', 'new', 'new_with_tags']);

/**
 * Save one hand-entered listing.
 *
 * Creates (or reuses) the canonical item only when the sub-line is resolved
 * unambiguously. An ambiguous or unrecognised sub-line leaves item_id null, so
 * the listing shows up in the "needs resolution" filter rather than being
 * quietly attached to the wrong comp pool.
 */
export async function saveListing(input: SaveInput) {
  await requireUnlocked();
  const title = input.title?.trim();
  if (!title) return { ok: false as const, error: 'Title is required.' };

  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false as const, error: 'Price must be a non-negative number.' };
  }
  const currency = (input.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false as const, error: 'Currency must be a 3-letter code, e.g. JPY.' };
  }

  const sizeRegion = SIZE_REGIONS.has(input.sizeRegion ?? '') ? input.sizeRegion! : 'UNKNOWN';
  const conditionTier = TIERS.has(input.conditionTier ?? '') ? input.conditionTier! : null;

  const resolved = resolveBrand(`${input.brandRaw ?? ''} ${title}`);
  // An explicit choice in the form always beats the automatic resolution.
  const sublineId = input.sublineId?.trim() || (resolved.confident ? resolved.sublineId : null);

  const adYearInput = input.adYear != null && input.adYear !== '' ? Number(input.adYear) : null;
  let adYear: number | null = null;
  let adYearStatus = 'unknown';
  if (adYearInput != null && Number.isFinite(adYearInput)) {
    if (adYearInput >= 1988) {
      adYear = adYearInput;
      adYearStatus = 'known';
    } else {
      adYearStatus = 'pre_ad_era';
    }
  } else if (resolved.adYearStatus === 'known' && resolved.adYear) {
    adYear = resolved.adYear;
    adYearStatus = 'known';
  } else if (resolved.adYearStatus === 'pre_ad_era') {
    adYearStatus = 'pre_ad_era';
  }

  const fx = await toBase(price, currency);

  const client = await pool.connect();
  try {
    await client.query('begin');

    let itemId: string | null = null;
    if (sublineId) {
      // AD year participates in item identity: the same model from two AD years
      // is two items with two different values, so they must not share comps.
      // The brand comes from the sub-line rather than being assumed, now that
      // the roster runs to dozens of houses.
      const brandId = resolved.brandId ?? (await brandForSubline(client, sublineId));
      if (brandId) {
        itemId = await findOrCreateItem(client, {
          brandId, sublineId, adYear, adYearStatus,
          canonicalName: title,
          // The add form reads the year out of the title the same way a poll
          // does, so it carries the same basis — unless the operator typed one
          // into the AD-year field, in which case it is theirs.
          adYearBasis: input.adYear ? 'manual' : (resolved.adYearBasis ?? 'ad_tag'),
          identityKey: identityForResolved({ sublineId, adYear, titleRaw: title, canonicalName: title }),
        });
      }
    }

    const inserted = await client.query<{ id: string }>(
      `insert into listings (
         item_id, source_id, source_item_id, brand_raw, title_raw,
         size_raw, size_region, condition_raw, condition_tier,
         price, currency, price_base, fx_rate_at_snapshot,
         url, image_url, notes,
         status, evidence, entered_manually, last_verified_at, date_seen, first_seen_at
       ) values (
         $1,$2,$3,$4,$5,
         $6,$7::size_region,$8,$9::condition_tier,
         $10,$11,$12,$13,
         $14,$15,$16,
         -- A sale is the one status that means somebody paid, tied to its
         -- evidence class by a database constraint. Reachable from here because
         -- a person looking at a sold listing is reading an outcome rather than
         -- inferring one — which is the same reason a poll may never do it.
         case when $17::boolean then 'sold_confirmed' else 'active' end::listing_status,
         case when $17::boolean then 'confirmed_sale' else 'active_ask' end::evidence_class,
         true, now(),
         -- Dated when it sold, not when it was typed. A sale six months old
         -- stamped with today's date would carry full recency weight, which is
         -- exactly what the weighting exists to prevent.
         coalesce($18::timestamptz, now()),
         -- A sold row has no first sighting: it says what a piece fetched and
         -- never says when it was listed. Inventing one gives it a span running
         -- from today back to the sale, and the venue reads as one where
         -- everything sells the instant it appears.
         case when $17::boolean then null else now() end
       ) returning id`,
      [
        itemId,
        input.sourceId,
        input.sourceItemId?.trim() || null,
        input.brandRaw?.trim() || null,
        title,
        input.sizeRaw?.trim() || null,
        sizeRegion,
        input.conditionRaw?.trim() || null,
        conditionTier,
        price,
        currency,
        fx.priceBase,
        fx.rate,
        input.url?.trim() || null,
        input.imageUrl?.trim() || null,
        input.notes?.trim() || null,
        Boolean(input.sold),
        input.sold && input.soldAt ? input.soldAt : null,
      ],
    );

    await client.query('commit');
    revalidatePath('/');
    revalidatePath('/verify');
    return {
      ok: true as const,
      id: inserted.rows[0].id,
      resolvedSubline: sublineId,
      needsResolution: !sublineId,
      fxMissing: fx.rate == null,
    };
  } catch (err) {
    await client.query('rollback');
    return { ok: false as const, error: err instanceof Error ? err.message : 'Save failed.' };
  } finally {
    client.release();
  }
}

/** Re-confirm a manual entry's price without creating a phantom price change. */
export async function verifyListing(id: string, stillListed: boolean, newPrice?: string) {
  await requireUnlocked();
  if (!stillListed) {
    // Positive evidence from a human who looked: this is a real delisting, not
    // an inference from a missing search result — and it has to be RECORDED as
    // evidence, not merely described as such in a comment. Writing the status
    // alone left the row claiming active_ask, so the strongest disappearance
    // this system can obtain counted for nothing downstream.
    //
    // Still `inferred_disappearance` rather than a sale: a person can confirm a
    // piece is gone, not that it was bought. What separates this from the
    // automated case is last_verified_at, which the freshness weighting reads.
    await query(
      `update listings
          set status = 'delisted', evidence = 'inferred_disappearance',
              last_verified_at = now()
        where id = $1`,
      [id],
    );
    revalidatePath('/verify');
    revalidatePath('/');
    return { ok: true as const, action: 'delisted' as const };
  }

  const parsed = newPrice != null && newPrice !== '' ? Number(newPrice) : null;
  if (parsed != null && Number.isFinite(parsed) && parsed >= 0) {
    const current = await query<{ currency: string; price: number }>(
      `select currency, price from listings where id = $1`,
      [id],
    );
    const currency = current[0]?.currency ?? 'EUR';
    if (parsed !== current[0]?.price) {
      const fx = await toBase(parsed, currency);
      // A price change is a NEW observation, so it becomes a new snapshot row.
      // The table is the price history; rows are not overwritten in place.
      await query(
        `insert into listings (
           item_id, source_id, source_item_id, brand_raw, title_raw, size_raw, size_region,
           condition_raw, condition_tier, price, currency, price_base, fx_rate_at_snapshot,
           url, image_url, notes, status, evidence, entered_manually, last_verified_at, supersedes_id,
           first_seen_at
         )
         select item_id, source_id, source_item_id, brand_raw, title_raw, size_raw, size_region,
                condition_raw, condition_tier, $2, currency, $3, $4,
                url, image_url, notes, 'active', 'active_ask', true, now(), id,
                -- This snapshot's own first sighting: the piece reached the
                -- market at THIS price now. The chain back to the original is
                -- supersedes_id, which the price history follows.
                now()
           from listings where id = $1`,
        [id, parsed, fx.priceBase, fx.rate],
      );
      await query(`update listings set status = 'relisted', last_verified_at = now() where id = $1`, [id]);
      revalidatePath('/verify');
      revalidatePath('/');
      return { ok: true as const, action: 'repriced' as const };
    }
  }

  await query(`update listings set last_verified_at = now() where id = $1`, [id]);
  revalidatePath('/verify');
  revalidatePath('/');
  return { ok: true as const, action: 'confirmed' as const };
}

export async function recordReview(listingId: string, action: string, note?: string) {
  await requireUnlocked();
  if (!['reviewed', 'dismissed', 'bought', 'flagged'].includes(action)) {
    return { ok: false as const, error: 'Unknown action.' };
  }
  await query(`insert into review_actions (listing_id, action, note) values ($1,$2,$3)`, [
    listingId,
    action,
    note ?? null,
  ]);
  revalidatePath('/');
  return { ok: true as const };
}

export async function prefill(url: string) {
  await requireUnlocked();
  const result = prefillFromUrl(url, await knownSources());
  const title = result.fields?.titleRaw ?? '';
  return { ...result, resolved: title ? resolveBrand(title) : null };
}

export async function parsePaste(text: string, links: PastedLink[] = []) {
  await requireUnlocked();
  return parseBulk(text, links, await knownSources());
}

/**
 * Commit a whole pasted page as completed sales.
 *
 * Separate from `saveDrafts` rather than a flag on it, and the separation is
 * the point: this writes the strongest evidence class the platform has, so it
 * is not something a capture token can reach. `saveDrafts` is the one action
 * that token may call — the bookmarklet, the phone shortcut and the mailbox
 * poller all end there — and a leaked one must be able to add a listing and
 * not to assert that pieces sold at prices.
 */
export async function saveSoldDrafts(drafts: SaveInput[], soldAt?: string) {
  await requireUnlocked();
  const results = [];
  for (const draft of drafts) {
    results.push(await saveListing({ ...draft, sold: true, soldAt }));
  }
  revalidatePath('/opportunities');
  return {
    saved: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).map((r) => (r as { error: string }).error),
  };
}

/**
 * The venues you have configured, by the host they live on.
 *
 * Read per parse rather than baked into a list in the code: a pasted row's
 * source is what decides whether it is something you might buy or evidence of
 * what things sell for, and a shop added five minutes ago should be recognised
 * now rather than at the next release.
 */
async function knownSources() {
  try {
    return await query<{ id: string; base_url: string | null }>(
      `select id, base_url from sources where base_url is not null`,
    );
  } catch {
    // Prefill is an assist. If the lookup fails the row still parses and still
    // saves — it just lands on the catch-all venue, which is visible on screen
    // and one dropdown away.
    return [];
  }
}

/**
 * Commit confirmed drafts from the bulk-paste screen.
 *
 * The one action a capture credential may reach, and the only one: the mailbox
 * poller, the bookmarklet and the phone shortcut all end here. Every other
 * action in this file takes the default capability and refuses that token, so
 * a leaked CAPTURE_TOKEN can add listings and cannot verify one, dismiss one,
 * re-resolve an item or start a match run.
 */
export async function saveDrafts(drafts: SaveInput[]) {
  await requireUnlocked('capture');
  const results = [];
  for (const draft of drafts) {
    results.push(await saveListing(draft));
  }
  return {
    saved: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).map((r) => (r as { error: string }).error),
  };
}


// ---------------------------------------------------------------------------
// Item matching (phase 2)
// ---------------------------------------------------------------------------

// pg's connect() is overloaded, so ReturnType picks the callback form. Take
// the client type from the driver instead.
type PoolClient = import('pg').PoolClient;

/**
 * Find or create the canonical item for a (sub-line, AD year, name) triple.
 *
 * AD year participates in identity, so `is not distinct from` is used rather
 * than `=`: an unknown AD year matches only other unknowns, never every year.
 */
async function findOrCreateItem(
  client: PoolClient,
  opts: {
    brandId: string;
    sublineId: string;
    adYear: number | null;
    adYearStatus: string;
    canonicalName: string;
    identityKey: string;
    /**
     * Where the year came from. Defaults to 'manual' because every caller here
     * is a person: the add form and the two resolve screens. The automatic
     * paths pass their own basis — an AD tag read off the garment, or a season
     * code the seller wrote — and those are different kinds of claim from a
     * year somebody typed after looking at the piece.
     */
    adYearBasis?: 'ad_tag' | 'season' | 'manual';
  },
) {
  // Insert-or-return in one statement, keyed on identity.
  //
  // Doing this as a select-then-insert would leave a window in which a poll and
  // a hand-entry both find nothing and both insert, giving one garment two
  // items and splitting its comps in half — with no error raised, since both
  // inserts succeed. The unique index on identity_key closes that window, and
  // ON CONFLICT turns the loser into a read rather than a crash.
  const upserted = await client.query<{ id: string }>(
    `insert into items (brand_id, subline_id, canonical_name, ad_year, ad_year_status,
                        ad_year_basis, identity_key)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (identity_key) do update set identity_key = excluded.identity_key
     returning id`,
    [
      opts.brandId, opts.sublineId, opts.canonicalName, opts.adYear, opts.adYearStatus,
      // Null when there is no year, which the schema requires: a basis with no
      // year describes nothing.
      opts.adYear == null ? null : (opts.adYearBasis ?? 'manual'),
      opts.identityKey,
    ],
  );
  return upserted.rows[0].id;
}

/**
 * The identity key for a listing whose sub-line a human has chosen.
 *
 * The automatic path (planMatch) refuses to key anything whose garment type it
 * cannot read. Here a person has already looked at the piece, so the fallback
 * is their own canonical name rather than a refusal — two listings a human
 * names identically are the same piece, which is precisely the brief's
 * "alias table plus your own eyes". The `named:` prefix keeps a hand-made key
 * from ever colliding with a computed one.
 */
function identityForResolved(opts: {
  sublineId: string;
  adYear: number | null;
  titleRaw: string;
  canonicalName: string;
}) {
  const garment = describeGarment(opts.titleRaw);
  if (garment.identified) {
    return garmentKey({
      sublineId: opts.sublineId,
      adYear: opts.adYear,
      type: garment.type,
      material: garment.material,
    });
  }
  return `named:${opts.sublineId}|${opts.adYear ?? 'ad?'}|${opts.canonicalName.trim().toLowerCase()}`;
}

/** The brand a sub-line belongs to, read from the registry. */
async function brandForSubline(client: PoolClient, sublineId: string) {
  const row = await client.query<{ brand_id: string }>(
    'select brand_id from sublines where id = $1',
    [sublineId],
  );
  return row.rows[0]?.brand_id ?? null;
}

/**
 * Re-run deterministic matching over every unmatched listing.
 *
 * Only matches what the alias table can prove. Anything ambiguous stays
 * unmatched and visible in /unresolved rather than being merged on a guess.
 *
 * The loop itself lives in `matchRunner.mjs` so `npm run match` runs the same
 * code rather than a second implementation of it — matching is a pipeline stage
 * and a pipeline stage that only exists behind a button cannot be scheduled.
 */
export async function runMatching() {
  await requireUnlocked();

  const client = await pool.connect();
  try {
    const summary = await matchUnmatched({ client });
    revalidatePath('/');
    revalidatePath('/unresolved');
    return summary;
  } finally {
    client.release();
  }
}

/**
 * Settle a listing by hand: either attach it to an item you picked, or create
 * one from a sub-line and AD year you chose. This is the layer the brief
 * expects to carry most of the matching load — you can identify a piece from a
 * photo faster than a matcher can.
 */
export async function resolveListing(
  listingId: string,
  input: { itemId?: string; sublineId?: string; adYear?: string | number; canonicalName?: string },
) {
  await requireUnlocked();
  if (input.itemId) {
    await query('update listings set item_id = $1 where id = $2', [input.itemId, listingId]);
    revalidatePath('/unresolved');
    revalidatePath('/');
    return { ok: true as const, itemId: input.itemId, created: false };
  }

  if (!input.sublineId) {
    return { ok: false as const, error: 'Pick a sub-line, or an existing item to link to.' };
  }

  const listing = await one<{ title_raw: string }>(
    'select title_raw from listings where id = $1',
    [listingId],
  );
  if (!listing) return { ok: false as const, error: 'Listing not found.' };

  const yearNum = input.adYear != null && input.adYear !== '' ? Number(input.adYear) : null;
  let adYear: number | null = null;
  let adYearStatus = 'unknown';
  if (yearNum != null && Number.isFinite(yearNum)) {
    if (yearNum >= 1988) {
      adYear = yearNum;
      adYearStatus = 'known';
    } else {
      adYearStatus = 'pre_ad_era';
    }
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const brandId = await brandForSubline(client, input.sublineId);
    if (!brandId) throw new Error(`no brand for sub-line ${input.sublineId}`);
    const itemId = await findOrCreateItem(client, {
      brandId,
      sublineId: input.sublineId,
      adYear,
      adYearStatus,
      canonicalName: (input.canonicalName || listing.title_raw).trim(),
      identityKey: identityForResolved({
        sublineId: input.sublineId,
        adYear,
        titleRaw: listing.title_raw,
        canonicalName: (input.canonicalName || listing.title_raw).trim(),
      }),
    });
    await client.query('update listings set item_id = $1 where id = $2', [itemId, listingId]);
    await client.query('commit');
    revalidatePath('/unresolved');
    revalidatePath('/');
    return { ok: true as const, itemId, created: true };
  } catch (err) {
    await client.query('rollback');
    return { ok: false as const, error: err instanceof Error ? err.message : 'Resolve failed.' };
  } finally {
    client.release();
  }
}

/**
 * What each unresolved listing probably is.
 *
 * The exact matcher gets a listing to an item or leaves it nowhere, and most
 * of what these venues publish does not state enough to be keyed: a Vestiaire
 * seller types the house and the garment and nothing else. Those listings pool
 * with nothing and can never be scored, which is most of why the opportunities
 * screen stays empty however much is collected.
 *
 * So every unresolved listing is scored against the items already held for its
 * house, and what comes back is a proposal with its reasons and its
 * assumptions attached. Nothing is linked here.
 */
export async function suggestionsFor(
  listings: { id: string; title_raw: string; brand_id?: string | null; subline_id?: string | null }[],
) {
  await requireUnlocked();
  if (!listings.length) return {};

  const brands = [...new Set(listings.map((l) => l.brand_id ?? resolveBrand(l.title_raw).brandId)
    .filter((b): b is string => Boolean(b)))];
  const items = await itemsForBrands(brands);

  const out: Record<string, unknown[]> = {};
  for (const listing of listings) {
    const matches = suggestMatches(listing, items).map((m) => ({
      itemId: m.item.id ?? '',
      name: m.item.canonical_name,
      sublineId: m.item.subline_id,
      listings: m.item.listings ?? 0,
      tier: m.tier,
      agreements: m.agreements,
      assumptions: m.assumptions,
      safe: safeToApply(m),
    }));
    if (matches.length) out[listing.id] = matches;
  }
  return out;
}

/**
 * Make one item out of a group of listings that look like each other.
 *
 * The suggestion engine can only propose items that already exist, and a fresh
 * paste usually has none: two Vestiaire rows of one unnamed coat have nothing
 * to be proposed against, so they sit unresolved forever. Grouping them turns
 * four decisions into one — but not into zero. The sub-line still has to be
 * chosen, because none of them names one, and it decides which comp pool the
 * piece joins.
 *
 * The first listing creates the item; the rest are linked to it, so the whole
 * group ends up as one item rather than as several that agree.
 */
export async function resolveCluster(
  listingIds: string[],
  input: { sublineId: string; adYear?: string | number; canonicalName?: string },
) {
  await requireUnlocked();
  if (!listingIds.length) return { ok: false as const, error: 'no listings given' };
  if (!input.sublineId) return { ok: false as const, error: 'a sub-line has to be chosen' };

  const [first, ...rest] = listingIds;

  // Name the item from what the group agreed on, not from whichever listing
  // happened to be first. A raw title carries one seller's wording — "Wool
  // jacket, tailored" — and that name is then what every future comparison
  // reads, so an arbitrary one makes the item harder to match against later.
  let canonicalName = input.canonicalName;
  if (!canonicalName) {
    const [row, subline] = await Promise.all([
      one<{ title_raw: string }>(`select title_raw from listings where id = $1`, [first]),
      one<{ display_name: string }>(
        `select display_name from sublines where id = $1`, [input.sublineId],
      ),
    ]);
    const garment = describeGarment(row?.title_raw ?? '');
    const year = input.adYear ? Number(input.adYear) : null;
    canonicalName = garmentName({
      sublineName: subline?.display_name ?? input.sublineId,
      adYear: Number.isFinite(year) ? year : null,
      adYearStatus: Number.isFinite(year) ? 'known' : 'unknown',
      type: garment.type,
      material: garment.material,
    });
  }

  const created = await resolveListing(first, {
    sublineId: input.sublineId,
    adYear: input.adYear,
    canonicalName,
  });
  if (!created.ok || !created.itemId) {
    return { ok: false as const, error: created.error ?? 'could not create the item' };
  }

  let linked = 1;
  const failed: string[] = [];
  for (const id of rest) {
    const res = await resolveListing(id, { itemId: created.itemId });
    if (res.ok) linked++;
    else failed.push(res.error ?? id);
  }

  revalidatePath('/unresolved');
  revalidatePath('/opportunities');
  return { ok: true as const, itemId: created.itemId, linked, failed };
}

/**
 * Groups of unresolved listings that look like each other.
 *
 * Scored between listings rather than against items, because in this case
 * there is no item on either side yet.
 */
export async function clustersFor(
  listings: { id: string; title_raw: string; brand_id?: string | null; subline_id?: string | null }[],
) {
  await requireUnlocked();
  return clusterListings(listings);
}

/**
 * Accept several proposals at once.
 *
 * A paste is a hundred rows, so a suggestion you have to click one at a time is
 * a suggestion you will not use. This takes the pairs the screen showed you —
 * each with its agreements and its assumptions already on screen — and links
 * them, reporting what it did rather than assuming it worked.
 *
 * Still your decision, in bulk: nothing here runs on its own.
 */
export async function applySuggestions(pairs: { listingId: string; itemId: string }[]) {
  await requireUnlocked();

  // Re-derive every pair here, from the database, before writing any of it.
  //
  // The safety property — "bulk-accept only ever links strong, unassumptive
  // matches" — lived entirely in which pairs /unresolved chose to render. This
  // action took whatever {listingId, itemId} it was handed and wrote it, and a
  // server action is an independently callable POST: the page is a convenience
  // for producing the list, never the thing that enforces it. Anyone able to
  // call this could have linked any listing to any item, and a wrong link is
  // not a cosmetic error — it pools a garment into another garment's comp set,
  // which is what every valuation is computed from, and unpicking it is not a
  // click.
  //
  // The client's own bar was lower than the documented one besides: it filtered
  // on tier === 'strong' and never consulted safeToApply, so an assumption-
  // bearing match could be bulk-accepted even through the intended path.
  //
  // Same shape as the Host-header, X-Forwarded-For and capture-token fixes: a
  // mutating action must verify its own precondition rather than trust the
  // caller who states it.
  const wanted = pairs ?? [];
  if (!wanted.length) return { linked: 0, failed: [] as string[] };

  const listings = await query<{
    id: string; title_raw: string; brand_id: string | null; subline_id: string | null; item_id: string | null;
  }>(
    `select l.id, l.title_raw, l.brand_id, l.subline_id, l.item_id
       from listings l where l.id = any($1::uuid[])`,
    [wanted.map((p) => p.listingId)],
  );
  const byId = new Map(listings.map((l) => [l.id, l]));

  const brands = [...new Set(
    listings.map((l) => l.brand_id ?? resolveBrand(l.title_raw).brandId).filter((b): b is string => Boolean(b)),
  )];
  const items = await itemsForBrands(brands);

  const { allowed, refused } = admissibleLinks(wanted, byId, items);

  let linked = 0;
  const failed: string[] = [];
  for (const { listingId, itemId } of allowed) {
    const res = await resolveListing(listingId, { itemId });
    if (res.ok) linked++;
    else failed.push(res.error ?? listingId);
  }

  revalidatePath('/unresolved');
  revalidatePath('/opportunities');
  return { linked, failed: [...failed, ...refused] };
}

/** Existing items you could link a listing to, narrowed by sub-line. */
export async function candidateItems(sublineId?: string) {
  await requireUnlocked();
  if (!sublineId) return [];
  return query<{ id: string; canonical_name: string; ad_year: number | null; listings: number }>(
    `select i.id, i.canonical_name, i.ad_year,
            (select count(*) from listings l where l.item_id = i.id)::int as listings
       from items i
      where i.subline_id = $1
      order by i.canonical_name
      limit 100`,
    [sublineId],
  );
}

// ---------------------------------------------------------------------------
// Heat subjects (phase 7)
// ---------------------------------------------------------------------------

/**
 * Start or stop watching one item's heat.
 *
 * Item-level is where the signal is most useful and most fragile: a single
 * garment has far fewer observations than a sub-line, so most items will read
 * "insufficient data" for a long time. That is the model working, not failing —
 * it refuses rather than drawing a trend through two points.
 */
export async function watchItemHeat(itemId: string, wikipediaTitle?: string) {
  await requireUnlocked();
  const item = await one<{ canonical_name: string; ad_year: number | null; subline_name: string | null }>(
    `select i.canonical_name, i.ad_year, sub.display_name as subline_name
       from items i left join sublines sub on sub.id = i.subline_id
      where i.id = $1`,
    [itemId],
  );
  if (!item) return { ok: false as const, error: 'Item not found.' };

  const label = [item.subline_name, item.canonical_name, item.ad_year ? `AD${item.ad_year}` : null]
    .filter(Boolean)
    .join(' · ');

  await query(
    `insert into heat_subjects (subject_type, item_id, label, wikipedia_title)
     values ('item', $1, $2, $3)
     on conflict (subject_type, brand_id, subline_id, item_id)
     do update set enabled = true, label = excluded.label,
                   wikipedia_title = coalesce(excluded.wikipedia_title, heat_subjects.wikipedia_title)`,
    [itemId, label, wikipediaTitle?.trim() || null],
  );
  revalidatePath('/heat');
  revalidatePath(`/item/${itemId}`);
  return { ok: true as const };
}

export async function unwatchItemHeat(itemId: string) {
  await requireUnlocked();
  await query(`update heat_subjects set enabled = false where subject_type = 'item' and item_id = $1`, [itemId]);
  revalidatePath('/heat');
  revalidatePath(`/item/${itemId}`);
  return { ok: true as const };
}

export async function isWatchedForHeat(itemId: string) {
  await requireUnlocked();
  const row = await one<{ enabled: boolean }>(
    `select enabled from heat_subjects where subject_type = 'item' and item_id = $1`,
    [itemId],
  );
  return Boolean(row?.enabled);
}
