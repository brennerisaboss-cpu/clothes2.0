// Runs one adapter against one source and applies the result to the database.
//
// Separated from scripts/poll.mjs so it is testable against a fixture server
// and a real database, which is the only way to be confident the "never infer a
// delisting from a failed poll" rule actually holds in the code that runs.

import { ingestVeto, statusChangeVeto, detectRelists, planAbsences, RELIST_WINDOW_DAYS } from './ingest.mjs';
import { planMatch } from './matching.mjs';
import { assessCatalogue } from './plausibility.mjs';
import { sublineById } from './brands/index.mjs';
import { normalizeAlias } from './normalize.mjs';
import { parseSize } from './size.mjs';

class HostLimiter {
  constructor(minIntervalMs = 500) {
    this.last = 0;
    this.delayMs = minIntervalMs;
  }
  setCrawlDelay(seconds) {
    if (Number.isFinite(seconds) && seconds > 0) {
      this.delayMs = Math.max(this.delayMs, seconds * 1000);
    }
  }
  /** An adapter that knows its own documented rate limit says so here. */
  setMinInterval(ms) {
    if (Number.isFinite(ms) && ms > 0) this.delayMs = Math.max(this.delayMs, ms);
  }
  async wait() {
    const since = Date.now() - this.last;
    if (since < this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs - since));
    this.last = Date.now();
  }
}

/** Parse a source timestamp, returning null rather than an Invalid Date. */
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * The item a polled listing belongs to, created if this is the first sighting.
 *
 * A poll that leaves item_id null produces listings that can never be scored:
 * resale value is the median of an ITEM's exit comps, so a listing attached to
 * no item is invisible to every comparison in the platform, and a shop polled
 * twice a day quietly fills the unresolved queue forever. That was the state
 * before this function existed.
 *
 * It links only what planMatch will vouch for — sub-line unambiguous, garment
 * type recognised. Anything else stays null and appears in /unresolved, which
 * is the intended destination for a title the vocabularies cannot read, not a
 * failure. Never merge on a guess.
 */
async function findOrCreateItem(client, plan) {
  const sublineId = plan.sublineId;
  const brandId =
    plan.resolved?.brandId ??
    sublineById(sublineId)?.brand_id ??
    (await client.query('select brand_id from sublines where id = $1', [sublineId])).rows[0]?.brand_id;
  if (!brandId) return null;

  // One statement, so two concurrent polls cannot both insert and split an
  // item's comps in half without either of them erroring.
  const { rows } = await client.query(
    `insert into items (brand_id, subline_id, canonical_name, ad_year, ad_year_status,
                        ad_year_basis, identity_key)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (identity_key) do update set identity_key = excluded.identity_key
     returning id`,
    [
      brandId,
      sublineId,
      plan.canonicalName,
      plan.adYear ?? null,
      plan.adYearStatus ?? 'unknown',
      plan.adYear == null ? null : (plan.adYearBasis ?? 'ad_tag'),
      plan.key,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * What this source's condition words mean, as tiers.
 *
 * `condition_mappings` has existed since the first migration, is seeded with
 * the grading vocabularies of the three venues that publish feeds, and the
 * merchant-feed adapter pulls `g:condition` out of every record it reads. The
 * poll runner then inserted `null, null` into condition_raw and condition_tier
 * unconditionally, so all of it was thrown away at the last step.
 *
 * The cost is not a missing column. `resaleEstimate` values a listing whose
 * condition nobody stated against the CHEAPEST tier available and halves its
 * confidence, both deliberately — so every listing the automated half of the
 * platform produced was permanently in the weakest branch of the valuation,
 * including the ones whose seller had stated the condition plainly in the feed.
 *
 * Normalised the same way aliases are, so "Very Good" and "very good" are one
 * label. A word with no mapping keeps its raw text and gets no tier: the
 * unstated-condition rule then applies exactly as before, and the label shows
 * up in the run summary as something to map rather than disappearing.
 */
async function conditionTiers(client, sourceId) {
  const { rows } = await client.query(
    `select raw_label_norm, tier::text as tier from condition_mappings where source_id = $1`,
    [sourceId],
  );
  return new Map(rows.map((r) => [r.raw_label_norm, r.tier]));
}

async function rateToBase(client, from, baseCurrency) {
  if (from === baseCurrency) return 1;
  const r = await client.query(
    `select rate from fx_rates where base_currency = $1 and quote_currency = $2
      order by as_of desc limit 1`,
    [from, baseCurrency],
  );
  return r.rows[0] ? Number(r.rows[0].rate) : null;
}

/**
 * @param {object} opts { client, source, adapter, baseCurrency, userAgent, fetchImpl, now }
 */
export async function runPoll({
  client,
  source,
  adapter,
  baseCurrency = 'EUR',
  userAgent = 'resale-tracker/0.1',
  fetchImpl,
  now = new Date(),
}) {
  const started = await client.query(
    `insert into poll_runs (source_id, previous_count) values ($1, $2) returning id`,
    [source.id, source.last_good_count ?? null],
  );
  const runId = started.rows[0].id;

  const finish = async (patch) => {
    await client.query(
      `update poll_runs set finished_at = now(), ok = $2, results_count = $3,
              error = $4, suspect_shrink = $5
         where id = $1`,
      [runId, patch.ok, patch.count ?? null, patch.error ?? null, patch.suspectShrink ?? false],
    );
    return { runId, ...patch };
  };

  // Honour a decline permanently, and never poll a source that is not cleared.
  if (source.permission_status === 'declined') {
    return finish({ ok: false, error: 'permission declined by the shop — not polled', skipped: true });
  }
  if (!source.automation_allowed) {
    return finish({
      ok: false,
      error: `automation not permitted for this source: ${source.automation_block_reason ?? 'no reason recorded'}`,
      skipped: true,
    });
  }

  const config = { ...(source.config ?? {}), userAgent };
  const limiter = new HostLimiter();
  const result = await adapter.fetchListings(config, { fetchImpl, limiter });

  const previousCount = source.last_good_count ?? 0;

  // Two questions, and they had been one.
  //
  //   veto        may this poll conclude that something is GONE?
  //   cannotWrite may this poll record anything at all?
  //
  // Treating the first answer as the second meant a source that cannot
  // enumerate its catalogue could never record a price — even though every
  // price it reported had actually been seen. Some sources genuinely cannot
  // enumerate: a search rather than a catalogue, a results page with no way to
  // know how many follow. Their observations are good; only their silences are
  // worthless, and it is the silences the veto exists to distrust.
  const veto = statusChangeVeto(result, previousCount);
  const cannotWrite = ingestVeto(result, previousCount);

  // ---- The guard. -----------------------------------------------------------
  // A failed fetch records the failure and CHANGES NOTHING. No status is
  // touched, no snapshot is written, and last_good_count is left alone so the
  // next run still compares against a real baseline.
  if (cannotWrite) {
    await client.query(
      `update listings set last_poll_ok = false
        where source_id = $1 and status = 'active'`,
      [source.id],
    );
    return finish({
      ok: false,
      error: cannotWrite,
      count: result.listings?.length ?? 0,
      // A shrink is only suspicious where the poll claimed to have seen
      // everything. On a source that never claims that, a smaller number is
      // what a smaller page looks like.
      suspectShrink: result.ok && result.complete,
      vetoed: true,
    });
  }

  // A poll that may write but may not conclude an absence starts by marking
  // every active listing unverified. The ingest loop below sets that back to
  // true on each one it actually saw, so what is left false is precisely what
  // this poll could not vouch for — which is the honest record of a partial
  // read, and is not the same thing as gone.
  if (veto) {
    await client.query(
      `update listings set last_poll_ok = false
        where source_id = $1 and status = 'active'`,
      [source.id],
    );
  }

  // ---- Only past here may anything change. ----------------------------------
  // Prefer the currency the adapter reported over the configured one: Yahoo
  // states JPY per item, Shopify states nothing and relies on config. Where
  // both exist and disagree, the adapter's own report wins because it came
  // from the source.
  const currency = result.listings.find((l) => l.currency)?.currency ?? config.currency;
  const fx = await rateToBase(client, currency, baseCurrency);

  // Does this catalogue look like clothing once converted?
  //
  // A currency mistake does not surface as an error. A €500 jacket read as ¥500
  // converts to about €3 and goes to the top of the opportunities table wearing
  // a 99% margin, and every number after that is arithmetically correct. Shops
  // state their currency in places that disagree — /products.json is in the
  // shop's base currency while its storefront renders the visitor's — so this
  // does not depend on having detected it correctly.
  //
  // A veto, like every other veto here: nothing is written. Ingesting the
  // listings and flagging them afterwards would leave prices that are wrong by
  // two orders of magnitude sitting in the table that drives every decision.
  if (fx != null && result.listings.length) {
    const check = assessCatalogue(
      result.listings.map((l) => Number(l.price) * fx),
      { currency },
    );
    if (check.verdict === 'implausible') {
      return finish({
        ok: false,
        error:
          `prices implausible for ${currency} — ${check.reason}. ` +
          `Fix with: npm run fix-currency -- --source ${source.id} --currency XXX`,
        count: result.listings.length,
      });
    }
  }

  // Read once per run rather than per listing: a handful of rows, and every
  // listing needs them.
  const tiers = await conditionTiers(client, source.id);
  const unmappedConditions = new Map();

  // Keep only listings that resolve to a monitored brand. A shop sells many
  // labels; a narrow feed is what makes the matching tractable.
  const relevant = [];
  for (const raw of result.listings) {
    const plan = planMatch({ brand_raw: raw.brandRaw, title_raw: raw.title });
    if (!plan.resolved?.brandId) continue;
    // Resolve the item now, so the listing is comparable the moment it lands.
    // Unmatchable ones still ingest — with a null item_id, into /unresolved —
    // because the price observation is worth keeping either way.
    const itemId = plan.matchable && plan.key ? await findOrCreateItem(client, plan) : null;
    relevant.push({ raw, plan, itemId });
  }

  const priorActive = (
    await client.query(
      `select id, source_item_id, title_raw, brand_raw, price, currency
         from listings
        where source_id = $1 and status = 'active'
          and not exists (select 1 from listings sup where sup.supersedes_id = listings.id)`,
      [source.id],
    )
  ).rows;

  const recentlyGone = (
    await client.query(
      `select id, source_item_id, title_raw, brand_raw as seller_id, date_seen
         from listings
        where source_id = $1 and status in ('delisted', 'unknown')
          and date_seen > now() - ($2 || ' days')::interval`,
      [source.id, String(RELIST_WINDOW_DAYS)],
    )
  ).rows;

  const relinked = detectRelists(
    relevant.map(({ raw }) => ({ ...raw, sellerId: raw.sellerId ?? raw.brandRaw })),
    recentlyGone,
    now,
  );

  const priorById = new Map(priorActive.map((l) => [l.source_item_id, l]));
  let inserted = 0;
  let unchanged = 0;
  let sales = 0;
  let undatedSales = 0;

  for (const { raw, plan, itemId } of relevant) {
    const conditionRaw = raw.conditionRaw ? String(raw.conditionRaw).trim() : null;
    const sizeRegion = parseSize(raw.sizeRaw).region;
    const conditionTier = conditionRaw
      ? (tiers.get(normalizeAlias(conditionRaw).compact) ?? null)
      : null;
    if (conditionRaw && !conditionTier) {
      unmappedConditions.set(conditionRaw, (unmappedConditions.get(conditionRaw) ?? 0) + 1);
    }

    // A completed sale, where the source states one.
    //
    // The pipeline's standing rule is that an adapter reports observations and
    // never decides that something sold — because for every other source, "it
    // stopped appearing" is the only thing an adapter could possibly mean by
    // it, and that is an inference, not a sale. `sold_confirmed` exists for the
    // one case that is not an inference: the source saying outright that the
    // item sold, on a date, at a price. Any adapter that can report that may
    // set it; today only eBay's Marketplace Insights can.
    //
    // Dated to the sale rather than to the poll. A sale is a fact with a
    // timestamp, and stamping it with today's would let a three-month-old
    // result count as evidence gathered this morning — invisibly, since a
    // wrongly-dated comp produces a number rather than a complaint.
    const claimsSale = raw.evidence === 'confirmed_sale';
    const soldAt = claimsSale ? parseDate(raw.soldAt) : null;
    const isSale = claimsSale && soldAt != null;

    // A sale with no date is dropped, not downgraded.
    //
    // Falling through would write it as an ordinary observation, which says the
    // piece is on the market at this price — the opposite of what the source
    // reported. And an undated comp cannot be weighted for recency, so it would
    // count as fresh for ever. Refusing is the same choice made everywhere else
    // here: an observation that cannot be recorded truthfully is not recorded.
    if (claimsSale && !isSale) {
      undatedSales++;
      continue;
    }

    const prior = priorById.get(raw.sourceItemId);
    // A sale is never a re-price of anything. It is a distinct, immutable
    // event, and the same event arriving on the next poll must not become a
    // second comp — the unique index on (source, item, date_seen) is what
    // stops that, since a sale is dated by when it happened rather than by
    // when it was read.
    const priceChanged = isSale || !prior || Number(prior.price) !== Number(raw.price);

    if (!priceChanged) {
      // Same price: refresh the sighting rather than writing a duplicate row.
      //
      // date_seen moves and first_seen_at must not. That is the whole
      // distinction between them: this statement is what makes date_seen mean
      // "last confirmed" for an automated row, and anything measuring a
      // duration has to start from the column this does not touch.
      await client.query(
        `update listings set date_seen = now(), last_poll_ok = true, status = 'active'
          where id = $1`,
        [prior.id],
      );
      unchanged++;
      continue;
    }

    // A new price is a new observation, so it becomes a new snapshot row rather
    // than overwriting. The table IS the price history.
    const supersedesId = isSale ? null : (prior?.id ?? relinked.get(raw.sourceItemId) ?? null);

    const written = await client.query(
      `insert into listings (
         item_id,
         source_id, source_item_id, brand_raw, title_raw, size_raw, size_region,
         condition_raw, condition_tier, price, currency, price_base,
         fx_rate_at_snapshot, url, image_url, status, evidence,
         entered_manually, last_poll_ok, supersedes_id, proxy_purchasable,
         source_published_at, first_seen_at, date_seen
       ) values (
         $16,
         $1,$2,$3,$4,$5,$19::size_region,
         -- The condition the source stated, and the tier it maps to on THIS
         -- source. A label with no mapping keeps its text and gets no tier:
         -- the unstated-condition rule then values it against the cheapest
         -- tier, which is where it already was, rather than guessing at what
         -- an unrecognised word means.
         $17,$18::condition_tier,$6,$7,$8,
         $9,$10,$11,$12,$20::evidence_class,
         false,true,$13,$14,$15,
         -- First sighting, set once and never updated. A re-price inserts a
         -- new row, and that row's first sighting is its own: the piece
         -- reached the market at this price now. The chain back to the
         -- original is supersedes_id, which the price history follows.
         --
         -- NULL for a sale. A completed-sale record says what a piece fetched
         -- and never says when it was listed, and inventing a first sighting of
         -- now() would give it a span running from today back to the sale date
         -- — a negative duration, floored to zero, so every sale would enter
         -- the survival curve as a piece that sold the instant it appeared and
         -- the venue would read as one where everything moves immediately.
         -- survival.mjs already refuses a row without one, so a null is the
         -- honest answer and the existing refusal handles it.
         case when $21::timestamptz is null then now() end,
         coalesce($21::timestamptz, now())
       )
       -- The same sale seen again on the next poll is the same event, not a
       -- second one. It is dated by when it happened, so the unique index on
       -- (source, item, date seen) makes re-reading a ninety-day window
       -- idempotent rather than a way to triple-count every sale in it.
       -- The index is partial, so the inference clause has to be too, or
       -- Postgres cannot tell which constraint is meant.
       on conflict (source_id, source_item_id, date_seen)
         where source_item_id is not null
         do nothing
       returning id`,
      [
        source.id,
        raw.sourceItemId,
        raw.brandRaw ?? null,
        raw.title,
        raw.sizeRaw ?? null,
        raw.price,
        currency,
        fx == null ? null : Number((raw.price * fx).toFixed(2)),
        fx,
        raw.url ?? null,
        raw.imageUrl ?? null,
        // `available: false` on Shopify is ambiguous — sold, withdrawn or out of
        // stock are indistinguishable — so it is "unknown", never "sold". Only
        // a source that states the sale outright reaches sold_confirmed, and
        // the schema ties that status to the evidence class by constraint.
        isSale ? 'sold_confirmed' : raw.available === false ? 'unknown' : 'active',
        supersedesId,
        // Three-state on purpose: a source that did not say is not a yes.
        raw.extra?.proxyPurchasable ?? null,
        // The source's own clock, where it gives one. This is what makes
        // end-to-end latency honest rather than measured from when we
        // happened to notice.
        parseDate(raw.extra?.publishedAt),
        // The item this listing is a sighting of. Null when the title could not
        // be read confidently — that listing lands in /unresolved rather than
        // being pooled with something it may not be.
        itemId,
        conditionRaw,
        conditionTier,
        // The sizing system the seller's own size string belongs to, where it
        // can be read. Hardcoded 'UNKNOWN' before, which meant the column
        // existed and said nothing on every automated row — and comps could
        // never be told apart by size, since a size is only comparable within
        // its own system.
        sizeRegion,
        isSale ? 'confirmed_sale' : 'active_ask',
        soldAt,
      ],
    );

    // Nothing written means this exact sale was already on file.
    if (!written.rowCount) {
      unchanged++;
      continue;
    }

    if (supersedesId) {
      await client.query(`update listings set status = 'relisted' where id = $1`, [supersedesId]);
    }
    if (isSale) sales++;
    inserted++;
  }

  // Absences, from a poll we have established is good and complete.
  //
  // This is the half the veto guards. A partial poll saw some of the catalogue;
  // what it did not see is not evidence of anything, and inferring a
  // disappearance from it would manufacture the strongest evidence tier this
  // platform has out of the weakest possible observation.
  const absences = veto
    ? []
    : planAbsences(priorActive, relevant.map(({ raw }) => raw.sourceItemId), relinked);
  for (const absence of absences) {
    // The evidence class travels with the status, and must.
    //
    // planAbsences returns both, and this wrote only the status — so a piece
    // that left the market kept the evidence it was first seen with,
    // `active_ask`, for ever. Everything downstream that asks "did anything
    // actually move at this price?" saw nothing but asks, which made the whole
    // disappearance tier inert against real polls while looking correct in
    // any test that wrote its own rows.
    await client.query(
      `update listings
          set status = $2, evidence = $3, last_poll_ok = true
        where id = $1`,
      [absence.id, absence.status, absence.evidence],
    );
  }

  // The shrink baseline may only be moved by a poll that saw the whole thing.
  // A partial count written here would become the number the NEXT poll's shrink
  // test compares against, and the guard would then be measuring one partial
  // read against another.
  if (!veto) {
    await client.query(
      `update sources set last_good_count = $2, last_good_poll_at = now() where id = $1`,
      [source.id, result.listings.length],
    );
  }

  return finish({
    ok: true,
    count: result.listings.length,
    kept: relevant.length,
    inserted,
    unchanged,
    // Completed sales recorded. Worth its own number: it is the only evidence
    // tier the automated path can produce that somebody actually paid a price,
    // and until a source supplies one every margin on the screen rests on asks.
    sales,
    // Sales the source reported without a date, and which were therefore
    // dropped. Reported rather than silent: a source that states a sale and
    // omits its date is an adapter or an API that has changed, and the symptom
    // otherwise is simply fewer comps than expected.
    undatedSales: undatedSales || undefined,
    delisted: absences.length,
    relisted: relinked.size,
    // Recorded on the run so a partial read is legible afterwards rather than
    // looking like a poll that simply found nothing missing. Not ok:false: it
    // applied, and reporting it as a failure would mark a source that works
    // exactly as designed as FAILING on every screen, for ever.
    suspectShrink: Boolean(veto) && result.complete,
    partial: veto ?? undefined,
    // Condition words this source used that nothing maps to a tier. Named
    // rather than counted, because the fix is one row in condition_mappings and
    // the only thing standing between the operator and it is knowing the word.
    unmappedConditions: unmappedConditions.size
      ? Object.fromEntries([...unmappedConditions].sort((a, b) => b[1] - a[1]).slice(0, 10))
      : undefined,
  });
}
