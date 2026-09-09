// Shop platform + robots.txt probe.
//
//   node scripts/probe-shops.mjs [--out docs/shop-probe-results.md]
//
// Answers phase 0 questions (c) and (d) for every shop in config/shops.json:
// what platform is it on, does a public product feed exist, and what does the
// site's robots.txt say about fetching it.
//
// Behaviour that is not negotiable, because the premise of this project is that
// access rules are obeyed rather than worked around:
//
//   * robots.txt is fetched and parsed FIRST. A path that robots disallows is
//     never requested — the probe reports "disallowed" from the rules alone.
//   * One request per host at a time, >= 1s apart, and a stated Crawl-delay
//     wins if it is longer.
//   * A 429 backs off and gives up on that host for this run. Retry-After is
//     honoured if present.
//   * A shop marked permission_status "declined" is skipped entirely and
//     permanently.
//   * Identifies itself honestly in User-Agent, with contact info. No spoofing
//     of a browser, ever.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { collectingUserAgent, NO_CONTACT_WARNING } from '../src/lib/userAgent.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRobots, isAllowed } from '../src/lib/robots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Be findable and contactable. A shop owner who wonders who this is should be
// able to find out and ask you to stop — and a request that writes "set
// PROBE_CONTACT to your email" into that slot is not findable, it is a request
// that was asked who it was and answered with the instructions for answering.
// It also went out anyway, behind a warning nobody had to act on.
// Probing warns rather than refuses, as it did before: a warning that was
// escalated to a hard exit stopped every shop from ever being probed.
const { ua: UA, anonymous } = collectingUserAgent();
if (anonymous) console.warn(`\n${NO_CONTACT_WARNING}`);

const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { method = 'GET' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: '*/*' },
    });
    const body = method === 'HEAD' ? '' : await res.text();
    return { ok: res.ok, status: res.status, headers: res.headers, body, url: res.url };
  } catch (err) {
    return { ok: false, status: 0, headers: new Headers(), body: '', error: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Platform fingerprinting from response headers and well-known endpoints.
 * Header-based where possible; no HTML scraping.
 */
function fingerprint({ homeHeaders, productsJson, wpJson }) {
  const h = (name) => homeHeaders?.get(name) ?? '';

  if (h('x-shopid') || h('x-shopify-stage') || h('x-sorting-hat-shopid')) return 'shopify';
  if (productsJson?.looksShopify) return 'shopify';
  if (h('x-servedby')?.includes('squarespace') || h('server')?.toLowerCase().includes('squarespace')) {
    return 'squarespace';
  }
  if (wpJson?.isWordPress) return wpJson.isWoo ? 'woocommerce' : 'wordpress';
  if (h('x-powered-by')?.toLowerCase().includes('bigcommerce')) return 'bigcommerce';
  return 'unknown';
}

class HostLimiter {
  constructor() {
    this.last = 0;
    this.delayMs = MIN_INTERVAL_MS;
    this.blocked = false;
  }
  setCrawlDelay(seconds) {
    if (Number.isFinite(seconds) && seconds > 0) {
      this.delayMs = Math.max(MIN_INTERVAL_MS, seconds * 1000);
    }
  }
  async wait() {
    const since = Date.now() - this.last;
    if (since < this.delayMs) await sleep(this.delayMs - since);
    this.last = Date.now();
  }
}

async function probeShop(shop) {
  // `base` lets a shop override the scheme/host (a non-standard port, or a
  // local fixture in tests). Everything else assumes plain https.
  const base = shop.base ?? `https://${shop.domain}`;
  const result = {
    name: shop.name,
    domain: shop.domain,
    region: shop.region ?? null,
    permission_status: shop.permission_status ?? 'not_asked',
    robots: { fetched: false, status: null, crawlDelay: null, rules: {} },
    platform: 'unknown',
    productsJson: { checked: false, allowed: null, status: null, productCount: null, note: null },
    verdict: 'unknown',
    notes: [],
  };

  if (result.permission_status === 'declined') {
    result.verdict = 'skipped — permission declined';
    result.notes.push('Honoured permanently. Not contacted.');
    return result;
  }

  const limiter = new HostLimiter();

  // 1. robots.txt first, always.
  await limiter.wait();
  const robotsRes = await fetchText(`${base}/robots.txt`);
  result.robots.status = robotsRes.status;

  let groups = [];
  if (robotsRes.status === 200 && robotsRes.body) {
    result.robots.fetched = true;
    groups = parseRobots(robotsRes.body);
  } else if (robotsRes.status === 404) {
    // No robots.txt means no restrictions stated. Standard reading.
    result.robots.fetched = true;
    result.notes.push('No robots.txt (404) — no restrictions stated.');
  } else {
    // Anything else — a 403, a timeout, a 5xx — is not permission. Fail closed.
    result.verdict = 'blocked — could not read robots.txt';
    result.notes.push(
      `robots.txt returned ${robotsRes.status || 'no response'}${robotsRes.error ? ` (${robotsRes.error})` : ''}. Treated as "do not fetch".`,
    );
    return result;
  }

  for (const path of ['/', '/products.json', '/collections/all', '/wp-json/']) {
    const verdict = isAllowed(groups, UA, path);
    result.robots.rules[path] = verdict.allowed ? 'allowed' : `disallowed (${verdict.rule})`;
    if (verdict.crawlDelay != null) {
      result.robots.crawlDelay = verdict.crawlDelay;
      limiter.setCrawlDelay(verdict.crawlDelay);
    }
  }

  // 2. Homepage headers for fingerprinting, only if robots permits.
  let homeHeaders = null;
  if (isAllowed(groups, UA, '/').allowed) {
    await limiter.wait();
    const home = await fetchText(base, { method: 'HEAD' });
    if (home.status === 429) {
      result.verdict = 'rate limited — backed off';
      result.notes.push('429 on homepage; stopped probing this host.');
      return result;
    }
    homeHeaders = home.headers;
  } else {
    result.notes.push('robots.txt disallows "/" for this agent — did not fetch the homepage.');
  }

  // 3. The product feed, only if robots permits it specifically.
  const productsAllowed = isAllowed(groups, UA, '/products.json').allowed;
  result.productsJson.allowed = productsAllowed;

  let productsJson = null;
  if (productsAllowed) {
    await limiter.wait();
    const res = await fetchText(`${base}/products.json?limit=1`);
    result.productsJson.checked = true;
    result.productsJson.status = res.status;

    if (res.status === 429) {
      result.verdict = 'rate limited — backed off';
      const retry = res.headers.get('retry-after');
      result.notes.push(`429 on /products.json${retry ? ` (Retry-After: ${retry})` : ''}. Stopped.`);
      return result;
    }
    if (res.ok) {
      try {
        const parsed = JSON.parse(res.body);
        if (Array.isArray(parsed?.products)) {
          productsJson = { looksShopify: true };
          result.productsJson.productCount = parsed.products.length;
        } else {
          result.productsJson.note = 'JSON, but no products array';
        }
      } catch {
        // A storefront that serves HTML here has simply turned the feed off.
        result.productsJson.note = 'not JSON — feed not available';
      }
    } else {
      result.productsJson.note = `HTTP ${res.status} — feed not available`;
    }
  } else {
    result.productsJson.note = 'robots.txt disallows this path — not requested';
  }

  // 4. WordPress/Woo check only where the feed was not Shopify.
  let wpJson = null;
  if (!productsJson && isAllowed(groups, UA, '/wp-json/').allowed) {
    await limiter.wait();
    const res = await fetchText(`${base}/wp-json/`);
    if (res.ok) {
      try {
        const parsed = JSON.parse(res.body);
        const namespaces = parsed?.namespaces ?? [];
        wpJson = {
          isWordPress: true,
          isWoo: namespaces.some((n) => String(n).startsWith('wc/')),
        };
      } catch {
        /* not WordPress */
      }
    }
  }

  result.platform = fingerprint({ homeHeaders, productsJson, wpJson });

  // 5. Verdict.
  if (!productsAllowed) {
    result.verdict = 'manual-only — robots.txt disallows the feed';
  } else if (productsJson) {
    result.verdict = 'usable — public product feed';
  } else if (result.platform === 'woocommerce') {
    result.verdict = 'needs asking — WooCommerce, check for a public store API';
  } else {
    result.verdict = 'manual-only — no public feed found';
  }

  return result;
}

// --- main -------------------------------------------------------------------

const { shops } = JSON.parse(await readFile(join(ROOT, 'config/shops.json'), 'utf8'));
const outArgIdx = process.argv.indexOf('--out');
const outPath = outArgIdx > -1 ? process.argv[outArgIdx + 1] : 'docs/shop-probe-results.md';

console.log(`Probing ${shops.length} shops as:\n  ${UA}\n`);

const results = [];
for (const shop of shops) {
  process.stdout.write(`  ${shop.domain} … `);
  const result = await probeShop(shop);
  results.push(result);
  console.log(result.verdict);
}

const rows = results
  .map(
    (r) =>
      `| ${r.name} | \`${r.domain}\` | ${r.region ?? '—'} | ${r.platform} | ` +
      `${r.robots.fetched ? (r.robots.rules['/products.json'] ?? '—') : 'unreadable'} | ` +
      `${r.productsJson.productCount != null ? `yes (${r.productsJson.productCount})` : 'no'} | ` +
      `${r.verdict} |`,
  )
  .join('\n');

const md = `# Shop probe results

Generated ${new Date().toISOString()} by \`scripts/probe-shops.mjs\`.

User-Agent: \`${UA}\`

The probe reads robots.txt first and never requests a path robots disallows.
One request per host at a time, at least 1s apart, honouring any stated
Crawl-delay, backing off on 429, and skipping any shop whose permission_status
is \`declined\`.

| Shop | Domain | Region | Platform | robots on /products.json | Feed | Verdict |
|---|---|---|---|---|---|---|
${rows}

## Detail

${results
  .map(
    (r) => `### ${r.name} (\`${r.domain}\`)

- Verdict: **${r.verdict}**
- Platform: ${r.platform}
- robots.txt: HTTP ${r.robots.status ?? '—'}${r.robots.crawlDelay != null ? `, Crawl-delay ${r.robots.crawlDelay}s` : ''}
${Object.entries(r.robots.rules)
  .map(([p, v]) => `  - \`${p}\` → ${v}`)
  .join('\n')}
- /products.json: ${r.productsJson.checked ? `HTTP ${r.productsJson.status}` : 'not requested'}${r.productsJson.note ? ` — ${r.productsJson.note}` : ''}
${r.notes.length ? r.notes.map((n) => `- Note: ${n}`).join('\n') : ''}`,
  )
  .join('\n\n')}
`;

await mkdir(dirname(join(ROOT, outPath)), { recursive: true });
await writeFile(join(ROOT, outPath), md);
await writeFile(join(ROOT, 'config/shop-probe-results.json'), JSON.stringify(results, null, 2));

console.log(`\nWrote ${outPath} and config/shop-probe-results.json`);
const usable = results.filter((r) => r.verdict.startsWith('usable')).length;
console.log(`${usable} of ${results.length} shops have a usable public feed.`);
