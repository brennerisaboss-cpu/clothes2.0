// Discord webhook delivery.
//
// Chosen because it is the simplest thing that actually reaches a phone. The
// message carries what the brief asks for — item, price, spread, link — plus
// the two things that stop an alert being acted on blindly: the flags, and how
// old the underlying data is.
//
// No secret ever appears in a message body; the webhook URL is the credential
// and stays in configuration.

const EMBED_LIMIT = 10; // Discord's per-message embed cap.

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const eur = (n) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(Number(n ?? 0));

/**
 * Build one embed for a scored listing.
 *
 * Colour carries meaning and nothing else does: red where a high-severity flag
 * means verify first, amber for a provisional estimate, green for a clean
 * signal. Anyone glancing at a phone should get the posture before the numbers.
 */
export function buildEmbed({ listing, score, latency, proxyLinks = [] }) {
  const highFlags = (score.flags ?? []).filter((f) => f.severity === 'high');
  const colour = highFlags.length ? 0xb3341f : score.provisional ? 0x8a5e12 : 0x1f5c3d;

  const fields = [
    {
      name: 'Buy → landed',
      value: `${eur(score.price)} → ${eur(score.cost?.total)}`,
      inline: true,
    },
    {
      name: 'Resale → net',
      value: `${eur(score.resale?.value)} → ${eur(score.proceeds?.total)}`,
      inline: true,
    },
    {
      name: 'Profit',
      value: `**${(score.profit ?? 0) > 0 ? '+' : ''}${eur(score.profit)}**${
        score.spreadPct == null ? '' : ` · ${(score.spreadPct * 100).toFixed(0)}%`
      }`,
      inline: true,
    },
    {
      name: 'Evidence',
      value: truncate(
        `${score.resale?.comps ?? 0} exit comp${score.resale?.comps === 1 ? '' : 's'}` +
          `${score.provisional ? ' — PROVISIONAL' : ''}` +
          ` · confidence ${score.confidence?.toFixed(2) ?? '—'}` +
          ` · freshest ${score.dataAgeDays ?? '?'}d old`,
        1024,
      ),
      inline: false,
    },
  ];

  if (highFlags.length) {
    fields.push({
      name: '⚠ Verify before acting',
      value: truncate(highFlags.map((f) => `• ${f.message}`).join('\n'), 1024),
      inline: false,
    });
  }

  if (proxyLinks.length) {
    fields.push({
      name: 'Buy via proxy',
      value: proxyLinks.map((l) => `[${l.label}](${l.href})`).join(' · '),
      inline: false,
    });
  }

  return {
    title: truncate(listing.title_raw ?? 'Listing', 256),
    url: listing.url ?? undefined,
    color: colour,
    description: truncate(
      [
        listing.subline_name,
        listing.ad_year ? `AD${listing.ad_year}` : null,
        listing.source_name,
        listing.size_raw,
        listing.condition_tier?.replace(/_/g, ' '),
      ]
        .filter(Boolean)
        .join(' · '),
      4096,
    ),
    fields,
    thumbnail: listing.image_url ? { url: listing.image_url } : undefined,
    footer: {
      text: truncate(
        `via ${score.route?.display_name ?? score.route?.id ?? 'route'}` +
          (latency?.best != null ? ` · ${latency.label} from ${latency.basis}` : ''),
        2048,
      ),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * POST embeds to a Discord webhook.
 *
 * Honours 429 by waiting the retry_after Discord returns rather than hammering:
 * being rate limited into silence is worse than being a second late.
 */
export async function send({ webhookUrl, content, embeds, fetchImpl = fetch, sleep = defaultSleep }) {
  if (!webhookUrl) return { ok: false, error: 'no webhook URL configured' };

  const batches = [];
  for (let i = 0; i < embeds.length; i += EMBED_LIMIT) {
    batches.push(embeds.slice(i, i + EMBED_LIMIT));
  }
  if (!batches.length) batches.push([]);

  for (let i = 0; i < batches.length; i++) {
    const payload = {
      content: i === 0 ? truncate(content ?? '', 2000) || undefined : undefined,
      embeds: batches[i],
    };

    let attempt = 0;
    for (;;) {
      let res;
      try {
        res = await fetchImpl(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        return { ok: false, error: `webhook request failed: ${err?.message ?? err}` };
      }

      if (res.status === 429 && attempt < 3) {
        let waitMs = 1000;
        try {
          const body = JSON.parse(await res.text());
          if (Number.isFinite(body?.retry_after)) waitMs = Math.ceil(body.retry_after * 1000);
        } catch {
          /* fall back to the default wait */
        }
        await sleep(waitMs);
        attempt++;
        continue;
      }

      // Discord returns 204 on success.
      if (res.status >= 200 && res.status < 300) break;
      return { ok: false, error: `webhook returned HTTP ${res.status}` };
    }
  }

  return { ok: true, batches: batches.length };
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
