// How fast to ask, and — the part that was missing — WHO is being asked.
//
// The limiter was created inside runPoll, which means one per source. Within a
// single shop's catalogue it paced properly; between shops it did nothing at
// all, because each poll started with a fresh one whose clock read zero. Seven
// shops therefore went out back to back, and the ones polled last are the ones
// that came back 429 — including on robots.txt, which is the first request a
// poll makes and the cheapest thing a host has to refuse.
//
// THE HOST IS NOT ALWAYS THE SHOP.
//
// Most of the roster is `something.myshopify.com`. Those are different shops and
// one platform, behind one edge, and the limit that matters is per CALLER
// rather than per shop — so pacing each shop separately paces nothing. Asking
// eight of them politely, one after another, is still asking Shopify
// twenty-four times in a minute from one address.
//
// So sources are grouped by where the limit actually lives, and a group shares
// one limiter for the whole run. A shop on its own domain is its own group and
// is unaffected.

/** Between requests to one host, when nothing has said otherwise. */
export const DEFAULT_MIN_INTERVAL_MS = 1500;

/**
 * Between requests to a host that is really a platform hosting many shops.
 *
 * Higher, because this one interval is being divided among every shop in the
 * group rather than spent on one — and because a shared edge is exactly where a
 * per-caller limit is enforced.
 */
export const SHARED_PLATFORM_INTERVAL_MS = 4000;

/**
 * Hostname suffixes that are one platform serving many shops.
 *
 * Deliberately short. Collapsing two shops that merely resemble each other into
 * one limiter would halve the rate of both for no reason, so this holds only
 * suffixes that are unambiguously multi-tenant — where the shop's name is a
 * subdomain the platform assigned, not a domain the shop owns.
 */
export const SHARED_PLATFORMS = [
  'myshopify.com',
  'mybigcommerce.com',
];

/** The name of the thing that will do the rate limiting. */
export function rateLimitHost(config = {}, adapterId = 'shopify') {
  const candidate =
    config.url ?? config.base ?? (config.domain ? `https://${config.domain}` : null);

  let host = null;
  if (candidate) {
    try {
      host = new URL(String(candidate)).hostname;
    } catch {
      host = String(config.domain ?? '') || null;
    }
  }
  if (!host) {
    // An API source has no shop host: the limit is on the credential, and every
    // source using that adapter shares it.
    return `adapter:${adapterId}`;
  }

  host = host.toLowerCase().replace(/^www\./, '');
  const platform = SHARED_PLATFORMS.find((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  return platform ?? host;
}

/** Is this key a platform many shops share? */
export function isSharedPlatform(key) {
  return SHARED_PLATFORMS.includes(key);
}

export class HostLimiter {
  constructor(minIntervalMs = DEFAULT_MIN_INTERVAL_MS) {
    this.last = 0;
    this.delayMs = minIntervalMs;
    this.floorMs = minIntervalMs;
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

  /**
   * One source in this group was refused. Slow the whole group.
   *
   * Without this, every shop on a shared platform has to discover the limit for
   * itself, one 429 at a time — which is what the screenshot showed: the shops
   * polled first got through, and the ones polled after them were refused
   * before they had fetched anything. The first refusal is information about
   * the group, and acting on it is the difference between one source backing
   * off and all of them being turned away.
   */
  backOff() {
    this.delayMs = Math.min(60_000, Math.max(this.delayMs * 2, this.floorMs * 2));
    return this.delayMs;
  }

  async wait() {
    const since = Date.now() - this.last;
    if (since < this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs - since));
    this.last = Date.now();
  }
}

/**
 * One limiter per host, for the length of a run.
 *
 * Created by the caller that loops over sources rather than by the poll itself,
 * which is the whole point: a limiter that does not outlive one source cannot
 * pace the source after it.
 */
export class LimiterPool {
  constructor() {
    this.byHost = new Map();
  }

  for(key) {
    let limiter = this.byHost.get(key);
    if (!limiter) {
      limiter = new HostLimiter(
        isSharedPlatform(key) ? SHARED_PLATFORM_INTERVAL_MS : DEFAULT_MIN_INTERVAL_MS,
      );
      this.byHost.set(key, limiter);
    }
    return limiter;
  }
}
