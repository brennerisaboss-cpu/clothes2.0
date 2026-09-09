// Bulk paste parsing.
//
// The realistic inputs are saved-search alert emails and your own notes, which
// are messy. So this parses into DRAFTS for confirmation, never straight into
// the database, and it is deliberately willing to return a row with nulls plus
// a warning rather than a confident wrong guess.

import { prefillFromUrl } from './urlPrefill.mjs';
import { resolveBrand } from './resolve.mjs';
// parseMoney lives in pastedPage.mjs — the lower-level module — and is
// re-exported here because every caller of this file already imports it from
// here. One reading of a price, shared: the page parser has to compare two
// prices on a reduced listing, and a second implementation would eventually
// disagree with this one on "1.240,00".
import {
  parsePastedPage, looksLikePastedPage, linesWithLinks, parseMoney,
} from './pastedPage.mjs';
export { parseMoney };
import { blocksFromEmail } from './alertEmail.mjs';

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/i;

/** Split a paste into candidate records: blank-line blocks, else single lines. */
function splitRecords(text) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  // If blank-line blocks each contain at most one URL, they are real records
  // (the alert-email shape). Otherwise fall back to line-per-record.
  const looksLikeBlocks =
    blocks.length > 1 &&
    blocks.every((b) => (b.match(new RegExp(URL_PATTERN, 'gi')) ?? []).length <= 1);

  if (looksLikeBlocks) return blocks;
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function parseDelimited(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : null;
  if (!delimiter) return null;

  const header = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());
  const known = ['brand', 'title', 'size', 'condition', 'price', 'currency', 'url', 'image_url', 'notes'];
  if (!header.some((h) => known.includes(h))) return null;

  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    const row = {};
    header.forEach((h, i) => {
      if (known.includes(h)) row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

function draftFrom({ titleText, url, moneyText, explicit = {}, sources = [] }) {
  const warnings = [];
  const money = parseMoney(moneyText ?? '');
  const prefill = url ? prefillFromUrl(url, sources) : null;

  const title = explicit.title || titleText || prefill?.fields.titleRaw || '';
  const resolved = resolveBrand(title);

  if (money.ambiguous) {
    warnings.push('price format was ambiguous — confirm the amount');
  }
  if (money.amount != null && !money.currency && !explicit.currency) {
    warnings.push('no currency found — set it before saving');
  }
  if (!resolved.brandId) {
    warnings.push('brand not recognised — this may not be a monitored brand');
  } else if (resolved.ambiguous) {
    warnings.push(resolved.reason);
  }
  if (resolved.brandId && !resolved.monitored) {
    warnings.push('sub-line is excluded from monitoring');
  }

  return {
    titleRaw: title,
    brandRaw: explicit.brand || prefill?.fields.brandRaw || null,
    sourceId: prefill?.sourceId ?? 'manual_other',
    sourceItemId: prefill?.fields.sourceItemId ?? null,
    url: prefill?.url ?? url ?? null,
    price: explicit.price != null && explicit.price !== '' ? Number(explicit.price) : money.amount,
    currency: (explicit.currency || money.currency || null)?.toUpperCase() ?? null,
    sizeRaw: explicit.size || null,
    conditionRaw: explicit.condition || null,
    imageUrl: explicit.image_url || null,
    notes: explicit.notes || null,
    brandId: resolved.brandId,
    sublineId: resolved.sublineId,
    adYear: resolved.adYear,
    adYearStatus: resolved.adYearStatus,
    needsManualResolution: resolved.ambiguous || !resolved.brandId,
    monitored: resolved.monitored,
    warnings,
  };
}

/**
 * Parse a pasted block into draft entries awaiting confirmation.
 * @returns {{ drafts: object[], note: string }}
 */
export function parseBulk(text, links = [], sources = []) {
  const input = (text ?? '').trim();
  if (!input) return { drafts: [], note: 'nothing pasted' };

  // A page copied off the screen: the route into venues that publish no feed
  // and permit no crawler. Recognised before the other shapes because it has
  // none of their markers — no links, no delimiters — and would otherwise fall
  // through to line-per-record and produce one garbage draft per line.
  if (looksLikePastedPage(input, links)) {
    // The links, where the paste carried them. Indexed against the untrimmed
    // text, since that is what the paste handler walked.
    const { blocks, note } = parsePastedPage(
      links?.length ? linesWithLinks(text, links) : input,
    );
    if (blocks.length) {
      return {
        drafts: blocks.map((b) =>
          draftFrom({
            titleText: b.title,
            // Without this a pasted row is a dead end: to see the piece again
            // you had to find it by name on the site it came from, which at a
            // hundred rows an evening is no better than not having it.
            url: b.url ?? null,
            moneyText: b.price,
            sources,
            explicit: {
              image_url: b.image ?? null,
              size: b.size ?? null,
              // Condition decides which comps a piece may be valued against,
              // so it is carried through as a field rather than lost in prose.
              condition: b.condition ?? null,
              // Kept as notes rather than fields: neither is what the piece
              // costs, and a second price on the row invites being read as one.
              notes: [b.wasPrice ? `was ${b.wasPrice}` : null, b.discount]
                .filter(Boolean).join(' · ') || null,
            },
          }),
        ),
        note,
      };
    }
  }

  const delimited = parseDelimited(input);
  if (delimited) {
    return {
      drafts: delimited.map((row) =>
        draftFrom({
          titleText: row.title,
          url: row.url,
          moneyText: [row.price, row.currency].filter(Boolean).join(' '),
          sources,
          explicit: row,
        }),
      ),
      note: `parsed ${delimited.length} delimited row(s)`,
    };
  }

  const records = splitRecords(input);
  const drafts = records.map((record) => {
    const urlMatch = record.match(URL_PATTERN);
    const url = urlMatch ? urlMatch[0] : null;

    // Strip the URL out before looking for a price, so a listing id in the
    // path is not mistaken for an amount.
    const withoutUrl = url ? record.replace(url, ' ') : record;
    const moneyLine =
      withoutUrl
        .split(/\n|\s{2,}|\s\|\s/)
        .find((part) => /[¥￥€£$]|\b(JPY|EUR|GBP|USD)\b/i.test(part)) ?? '';

    const titleText = withoutUrl
      .replace(moneyLine, ' ')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)[0] ?? '';

    return draftFrom({ titleText, url, moneyText: moneyLine, sources });
  });

  return { drafts, note: `parsed ${drafts.length} record(s)` };
}

/**
 * Drafts from one saved-search alert email.
 *
 * A separate entry point from parseBulk on purpose. A PASTED email keeps going
 * through the record parser, which is what it has always done and what its
 * visible URLs suit; this reads the message's HTML, where the anchors are, and
 * is for mail arriving over IMAP where there is no clipboard at all.
 *
 * @param {string} html the message's text/html part
 * @param {object[]} sources the venues you have configured
 */
export function parseAlertEmail(html, sources = []) {
  const { blocks, note } = blocksFromEmail(html);
  return {
    drafts: blocks.map((b) =>
      draftFrom({
        titleText: b.title,
        url: b.url ?? null,
        moneyText: b.price,
        sources,
        explicit: {
          image_url: b.image ?? null,
          size: b.size ?? null,
          condition: b.condition ?? null,
          notes: [b.wasPrice ? `was ${b.wasPrice}` : null, b.discount]
            .filter(Boolean).join(' · ') || null,
        },
      }),
    ),
    note,
  };
}
