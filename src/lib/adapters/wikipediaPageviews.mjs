// Wikipedia pageviews as an attention signal.
//
// Chosen because it is the cleanest legitimate proxy for cultural attention
// available without scraping anything: an official Wikimedia REST API, openly
// documented, no key, no auth, and explicitly published for reuse.
//
// What it is good for: noticing that a designer or a line is being looked up
// more than it used to be. Interest in "Junya Watanabe" climbing for six weeks
// is a real signal that something is happening.
//
// What it is NOT: a measure of demand for a specific garment. A page view is
// curiosity, not intent, and a spike can be a news cycle, an obituary, or a
// television appearance. Treated as one weak leading indicator among several,
// never on its own.
//
// Wikimedia's policy requires a descriptive User-Agent with contact details.
// Sending a generic one is both rude and a good way to get blocked.

import { usableContact, userAgent } from '../userAgent.mjs';

const BASE =
  process.env.WIKIMEDIA_PAGEVIEWS_BASE ??
  'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';

export const id = 'wikipedia_pageviews';
// Wikimedia asks for courtesy rather than publishing a hard limit; this is well
// inside anything reasonable for a personal tool.
export const MIN_INTERVAL_MS = 1000;

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * @param {object} opts { title, project?, days?, contact, fetchImpl?, now? }
 * @returns {Promise<{ ok: boolean, points?: object[], error?: string }>}
 */
export async function fetchPageviews({
  title,
  project = 'en.wikipedia',
  days = 90,
  contact,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!title) return { ok: false, error: 'no Wikipedia title configured for this subject' };
  // Truthy is not the test, and treating it as one is what produced the 403
  // nobody could explain. PROBE_CONTACT's default across four callers was the
  // string "contact not set", which is truthy, so this check passed and the
  // request went out under a User-Agent that declined in words to say who was
  // making it. Wikimedia's policy exists to make a client reachable, and it
  // answers exactly that with 403. The adapter was never the fault.
  if (!usableContact(contact)) {
    return {
      ok: false,
      error:
        'PROBE_CONTACT is not an email or a URL — Wikimedia requires a User-Agent somebody ' +
        'can be reached at, and refuses one that only claims to have a contact.',
    };
  }

  const end = new Date(now.getTime() - 86_400_000); // yesterday; today is partial
  const start = new Date(end.getTime() - days * 86_400_000);

  // Titles are path segments here, so slashes and spaces must be encoded.
  const encoded = encodeURIComponent(String(title).replace(/ /g, '_'));
  const url = `${BASE}/${project}/all-access/user/${encoded}/daily/${yyyymmdd(start)}/${yyyymmdd(end)}`;

  const ua = userAgent(contact);
  let res;
  try {
    res = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': ua,
      },
    });
  } catch (err) {
    return { ok: false, error: `pageviews request failed: ${err?.message ?? err}` };
  }

  // A title with no data is a legitimate answer — the page may not exist under
  // that exact name — not an error to retry.
  if (res.status === 404) return { ok: true, points: [], note: `no pageview data for "${title}"` };
  if (res.status === 429) return { ok: false, error: 'rate limited by Wikimedia; back off' };
  // A 403 gets the body attached rather than an explanation invented for it.
  //
  // This failure went several rounds reported as "returns HTTP 403", which is
  // the number and none of the reason, and the obvious reason is not the only
  // one: a corporate network, a VPN or a sandboxed environment answers CONNECT
  // with 403 too, and that 403 has nothing to do with Wikimedia. Attributing it
  // to their User-Agent policy would send you to fix a header that was fine —
  // exactly the wrong-diagnosis-confidently-stated failure this codebase keeps
  // trying to avoid. So: print what was sent, print what came back, and let the
  // body say which it was.
  if (res.status === 403) {
    let body = '';
    try { body = (await res.text()).trim().slice(0, 200); } catch { /* nothing to add */ }
    const blockedUpstream = /allowlist|egress|proxy|firewall|not permitted by/i.test(body);
    return {
      ok: false,
      error:
        `HTTP 403.\n  Sent as: ${ua}\n` +
        (body ? `  Response: ${body}\n` : '') +
        (blockedUpstream
          ? '  That is a network between you and Wikimedia refusing the connection, not\n' +
            '  Wikimedia refusing the request. Nothing in this project can change it.'
          : '  If that mentions the User-Agent, Wikimedia wants a contact that can be acted\n' +
            '  on: set PROBE_CONTACT to an email you read or a URL about you.'),
    };
  }
  if (!res.ok) return { ok: false, error: `pageviews returned HTTP ${res.status}` };

  let body;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return { ok: false, error: 'pageviews response was not JSON' };
  }

  const items = body?.items;
  if (!Array.isArray(items)) return { ok: false, error: 'pageviews response had no items array' };

  return {
    ok: true,
    points: items
      .map((item) => {
        // Timestamps arrive as YYYYMMDDHH.
        const stamp = String(item.timestamp ?? '');
        if (stamp.length < 8) return null;
        const day = new Date(
          `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T00:00:00Z`,
        );
        const views = Number(item.views);
        if (!Number.isFinite(day.getTime()) || !Number.isFinite(views)) return null;
        return {
          source: id,
          metric: 'views',
          value: views,
          period_start: day,
          period_end: new Date(day.getTime() + 86_400_000),
        };
      })
      .filter(Boolean),
  };
}
