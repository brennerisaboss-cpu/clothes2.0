// Live verification: make every real call, once, and report what came back.
//
//   npm run verify:live
//
// Why this exists as a script rather than something already run: the
// environment this was written in has outbound HTTPS blocked by an
// organisation egress policy — the gateway answers 403 to CONNECT for every
// host. So every adapter is proven against fixtures shaped like the documented
// APIs, and this is the one command that proves them against the APIs
// themselves.
//
// It writes docs/live-verification.md. Commit that and the real payload shapes
// become reviewable — if an adapter mis-parses a real response, the report will
// show it.
//
// Secrets are never echoed. Keys, tokens and webhook URLs are redacted in both
// the console output and the report.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yahoo from '../src/lib/adapters/yahooShopping.mjs';
import { fetchRates, ageInDays } from '../src/lib/adapters/fx.mjs';
import * as rakuten from '../src/lib/adapters/rakuten.mjs';
import * as ebay from '../src/lib/adapters/ebay.mjs';
import { fetchPageviews } from '../src/lib/adapters/wikipediaPageviews.mjs';
import { send as sendDiscord } from '../src/lib/notifiers/discord.mjs';
import { resolveBrand } from '../src/lib/resolve.mjs';

// Raw-shape capture.
//
// The adapters were written against documented response shapes, not observed
// ones. If a real payload names a field differently, the parsed output goes
// null and the cause is invisible. So each live call also records the KEYS of
// one raw record — never the values, which could carry anything — so a
// mismatch is diagnosable from the report alone rather than needing a second
// round trip.
const rawShapes = {};

function captureShape(name, sampleObject, depth = 2) {
  const walk = (obj, d) => {
    if (obj == null || typeof obj !== 'object' || d < 0) return typeof obj;
    if (Array.isArray(obj)) return obj.length ? [walk(obj[0], d - 1)] : [];
    return Object.fromEntries(
      Object.entries(obj).slice(0, 40).map(([k, v]) => [k, walk(v, d - 1)]),
    );
  };
  rawShapes[name] = walk(sampleObject, depth);
}

/** Fetch that tees the first raw record into the shape capture. */
function shapeSpy(name, pick) {
  return async (url, init) => {
    const res = await fetch(url, init);
    if (!res.ok) return res;
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      const record = pick(parsed);
      if (record) captureShape(name, record);
    } catch {
      /* not JSON — the adapter will report it */
    }
    // Hand the adapter an unread copy.
    return new Response(body, { status: res.status, headers: res.headers });
  };
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTACT = process.env.PROBE_CONTACT;
const BASE = (process.env.BASE_CURRENCY ?? 'EUR').toUpperCase();
const UA = `resale-tracker/0.1 (personal price tracker; ${CONTACT ?? 'contact not set'})`;
const results = [];

const redact = (s) =>
  String(s ?? '')
    .replace(/([?&](?:appid|applicationId|appId)=)[^&\s]+/gi, '$1REDACTED')
    .replace(/(Bearer\s+)\S+/gi, '$1REDACTED')
    .replace(/https:\/\/discord(?:app)?\.com\/api\/webhooks\/\S+/gi, 'https://discord.com/api/webhooks/REDACTED');

function record(name, outcome) {
  results.push({ name, ...outcome });
  const mark = outcome.status === 'pass' ? 'PASS' : outcome.status === 'skip' ? 'SKIP' : 'FAIL';
  const detail = redact(outcome.detail ?? '');
  console.log(`  ${mark.padEnd(4)} ${name.padEnd(26)} ${detail.slice(0, 96)}`);
}

async function timed(fn) {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

// A simple limiter so each adapter's own rate limit is honoured.
function limiter() {
  let last = 0;
  let delay = 0;
  return {
    setMinInterval(ms) { delay = Math.max(delay, ms); },
    setCrawlDelay(s) { delay = Math.max(delay, s * 1000); },
    async wait() {
      const since = Date.now() - last;
      if (since < delay) await new Promise((r) => setTimeout(r, delay - since));
      last = Date.now();
    },
  };
}

console.log('\nLive verification — real calls to real endpoints.\n');

// --- 0. Exchange rates (no key required) -------------------------------------
//
// First, because it is the only check whose failure invalidates every other
// number in the platform. A poll that fails leaves a source visibly stale; an
// FX layer that fails leaves every margin looking exactly as trustworthy as
// before while being a few per cent wrong in the same direction.
try {
  const { value, ms } = await timed(() =>
    fetchRates(
      { baseCurrency: BASE, currencies: ['JPY', 'USD', 'GBP', 'CHF'], userAgent: UA },
      { fetchImpl: shapeSpy('fx response', (b) => b) },
    ),
  );
  if (!value.ok) {
    record('exchange rates', { status: 'fail', detail: value.error, ms });
  } else {
    const asOf = value.listings[0]?.asOf;
    const age = asOf ? Math.floor(ageInDays(asOf)) : Infinity;
    record('exchange rates', {
      status: value.listings.length ? 'pass' : 'fail',
      detail:
        `${value.listings.length} rates into ${BASE}, ECB fixing ${asOf} (${age}d old)` +
        (value.note ? ` — ${value.note}` : ''),
      ms,
      sample: value.listings.map((r) => ({ pair: `${r.from}->${r.to}`, rate: Number(r.rate.toPrecision(6)) })),
    });
  }
} catch (err) {
  record('exchange rates', { status: 'fail', detail: String(err?.message ?? err) });
}

// --- 1. Wikipedia pageviews (no key required) --------------------------------
if (!CONTACT) {
  record('wikipedia pageviews', {
    status: 'skip',
    detail: 'PROBE_CONTACT not set — Wikimedia requires a contactable User-Agent',
  });
} else {
  try {
    const { value, ms } = await timed(() =>
      fetchPageviews({
        title: 'Comme des Garçons', contact: CONTACT, days: 30,
        fetchImpl: shapeSpy('wikipedia item', (b) => b?.items?.[0]),
      }),
    );
    if (!value.ok) {
      record('wikipedia pageviews', { status: 'fail', detail: value.error, ms });
    } else {
      const pts = value.points;
      const total = pts.reduce((s, p) => s + p.value, 0);
      record('wikipedia pageviews', {
        status: pts.length ? 'pass' : 'fail',
        detail: `${pts.length} daily points, ${total} views over 30d${value.note ? ` (${value.note})` : ''}`,
        ms,
        sample: pts.slice(-3).map((p) => ({
          day: p.period_start.toISOString().slice(0, 10),
          views: p.value,
        })),
      });
    }
  } catch (err) {
    record('wikipedia pageviews', { status: 'fail', detail: String(err?.message ?? err) });
  }
}

// --- 2. Yahoo! Shopping ------------------------------------------------------
if (!process.env.YAHOO_APP_ID) {
  record('yahoo shopping', { status: 'skip', detail: 'YAHOO_APP_ID not set' });
} else {
  const { value, ms } = await timed(() =>
    yahoo.fetchListings(
      { appId: process.env.YAHOO_APP_ID, query: 'コムデギャルソン', currency: 'JPY', maxPages: 1 },
      { limiter: limiter(), fetchImpl: shapeSpy('yahoo hit', (b) => b?.hits?.[0]) },
    ),
  );
  if (!value.ok) {
    record('yahoo shopping', { status: 'fail', detail: value.error, ms });
  } else {
    // The real test is not "did it return 200" but "does the adapter get
    // usable fields out of a real payload".
    const usable = value.listings.filter((l) => l.sourceItemId && l.title && Number.isFinite(l.price));
    const onBrand = value.listings.filter((l) => resolveBrand(l.title).brandId);
    const withProxyFlag = value.listings.filter((l) => l.extra?.proxyPurchasable != null);
    record('yahoo shopping', {
      status: usable.length ? 'pass' : 'fail',
      detail:
        `${value.listings.length} hits, ${usable.length} with usable fields, ` +
        `${onBrand.length} on-roster, ${withProxyFlag.length} state proxy eligibility`,
      ms,
      sample: value.listings.slice(0, 3).map((l) => ({
        id: l.sourceItemId, title: l.title.slice(0, 60), price: l.price,
        currency: l.currency, proxyPurchasable: l.extra?.proxyPurchasable ?? null,
      })),
      note: withProxyFlag.length === 0
        ? 'No item stated proxy eligibility. Either the field is absent from this response shape, or these merchants have not set it. Worth checking the raw payload for the real field name.'
        : undefined,
    });
  }
}

// --- 3. Rakuten Ichiba -------------------------------------------------------
if (!process.env.RAKUTEN_APP_ID) {
  record('rakuten ichiba', { status: 'skip', detail: 'RAKUTEN_APP_ID not set' });
} else {
  const { value, ms } = await timed(() =>
    rakuten.fetchListings(
      { appId: process.env.RAKUTEN_APP_ID, keyword: 'コムデギャルソン', currency: 'JPY', maxPages: 1 },
      { limiter: limiter(), fetchImpl: shapeSpy('rakuten item', (b) => b?.Items?.[0]?.Item ?? b?.Items?.[0]) },
    ),
  );
  if (!value.ok) {
    record('rakuten ichiba', { status: 'fail', detail: value.error, ms });
  } else {
    const usable = value.listings.filter((l) => l.sourceItemId && Number.isFinite(l.price));
    const onBrand = value.listings.filter((l) => resolveBrand(l.title).brandId);
    record('rakuten ichiba', {
      status: usable.length ? 'pass' : 'fail',
      detail: `${value.listings.length} items, ${usable.length} usable, ${onBrand.length} on-roster`,
      ms,
      sample: value.listings.slice(0, 3).map((l) => ({
        id: l.sourceItemId, title: l.title.slice(0, 60), price: l.price, shop: l.extra?.shopName,
      })),
    });
  }
}

// --- 4. eBay Browse ----------------------------------------------------------
if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
  record('ebay browse', { status: 'skip', detail: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set' });
} else {
  const token = await ebay.fetchToken({
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
  });
  if (!token.ok) {
    record('ebay oauth', { status: 'fail', detail: token.error });
  } else {
    record('ebay oauth', { status: 'pass', detail: `token acquired, expires in ${token.expiresIn}s` });
    const { value, ms } = await timed(() =>
      ebay.fetchListings(
        { query: 'comme des garcons homme plus', token: token.token, maxPages: 1,
          marketplaceId: process.env.EBAY_MARKETPLACE_ID ?? 'EBAY_GB' },
        { limiter: limiter(), fetchImpl: shapeSpy('ebay summary', (b) => b?.itemSummaries?.[0]) },
      ),
    );
    if (!value.ok) {
      record('ebay browse', { status: 'fail', detail: value.error, ms });
    } else {
      const usable = value.listings.filter((l) => l.sourceItemId && Number.isFinite(l.price) && l.currency);
      record('ebay browse', {
        status: usable.length ? 'pass' : 'fail',
        detail: `${value.listings.length} summaries, ${usable.length} usable`,
        ms,
        sample: value.listings.slice(0, 3).map((l) => ({
          id: l.sourceItemId, title: l.title.slice(0, 60), price: l.price,
          currency: l.currency, condition: l.conditionRaw,
        })),
      });
    }
  }
}

// --- 5. Discord ---------------------------------------------------------------
const hook = process.env.DISCORD_WEBHOOK_URL;
if (!hook) {
  record('discord webhook', { status: 'skip', detail: 'DISCORD_WEBHOOK_URL not set' });
} else {
  const { value, ms } = await timed(() =>
    sendDiscord({
      webhookUrl: hook,
      content: 'Resale tracker — live verification. If you can read this, delivery works.',
      embeds: [{
        title: 'Verification message',
        description: 'Sent by `npm run verify:live`. Not an opportunity.',
        color: 0x1f5c3d,
      }],
    }),
  );
  record('discord webhook', {
    status: value.ok ? 'pass' : 'fail',
    detail: value.ok ? `delivered in ${value.batches} batch(es) — check the channel` : value.error,
    ms,
  });
}

// --- report -------------------------------------------------------------------
const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
console.log(
  `\n${counts.pass ?? 0} passed, ${counts.fail ?? 0} failed, ${counts.skip ?? 0} skipped ` +
  `(skipped means the credential is not set).\n`,
);

const md = `# Live verification

Generated ${new Date().toISOString()} by \`npm run verify:live\`.

Secrets are redacted. Safe to commit.

| Check | Result | Detail | ms |
|---|---|---|---|
${results.map((r) => `| ${r.name} | ${r.status} | ${redact(r.detail ?? '').replace(/\|/g, '\\|')} | ${r.ms ?? '—'} |`).join('\n')}

## Samples

These are the real payload fields as the adapters parsed them. If a field is
null or missing where it should not be, the adapter needs correcting against
the real API rather than the fixture.

${results
  .filter((r) => r.sample?.length || r.note)
  .map((r) => `### ${r.name}\n\n${r.note ? `> ${r.note}\n\n` : ''}\`\`\`json\n${JSON.stringify(r.sample ?? [], null, 2)}\n\`\`\``)
  .join('\n\n')}

## Raw response shapes

Field NAMES only, from one real record per endpoint — no values, so nothing
sensitive travels. If a parsed sample above shows null where it should not,
compare against the shape here: the adapter is probably reading a field the API
names differently.

\`\`\`json
${JSON.stringify(rawShapes, null, 2)}
\`\`\`
`;

await mkdir(join(ROOT, 'docs'), { recursive: true });
await writeFile(join(ROOT, 'docs/live-verification.md'), md);
console.log('Wrote docs/live-verification.md — commit it and the real payload shapes become reviewable.\n');

// A configured check that failed is a real failure; a skipped one is not.
if (counts.fail) process.exitCode = 1;
