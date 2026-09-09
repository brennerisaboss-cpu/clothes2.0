// Alert delivery runner.
//
// Ordering matters here. The alert row is claimed in the database BEFORE the
// webhook is called, using a unique constraint on (rule, listing). That way a
// crash mid-send leaves a record with delivery_ok = false rather than either
// losing the alert or duplicating it on the next run, and undelivered rows are
// retried on the following pass.

import { evaluateRule, latencyFor, formatLatency } from './alerting.mjs';
import { buildEmbed, send as sendDiscord } from './notifiers/discord.mjs';
import { proxyLinksFor } from './proxyLinks.mjs';
import { scoreAllRoutes } from './scoring.mjs';

/** Claim an alert. Returns null when this rule already alerted on this row. */
async function claim(client, rule, listing, score) {
  const flags = (score.flags ?? []).map((f) => f.kind);
  const res = await client.query(
    `insert into alerts (
       rule_id, listing_id, item_id, profit_base, spread_pct, confidence,
       provisional, flags, route_id, observed_at, published_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (rule_id, listing_id) do nothing
     returning id`,
    [
      rule.id, listing.id, listing.item_id ?? null,
      score.profit ?? null, score.spreadPct ?? null, score.confidence ?? null,
      Boolean(score.provisional), flags, score.route?.id ?? null,
      listing.date_seen, listing.source_published_at ?? null,
    ],
  );
  return res.rows[0]?.id ?? null;
}

async function markDelivered(client, alertId, result) {
  await client.query(
    `update alerts set delivery_ok = $2, sent_at = case when $2 then now() else null end,
            delivery_error = $3
      where id = $1`,
    [alertId, result.ok, result.ok ? null : (result.error ?? 'unknown delivery error')],
  );
}

function toEmbed(listing, score) {
  const sentAt = new Date();
  const latency = latencyFor(listing, sentAt);
  const proxy = proxyLinksFor(listing);
  return buildEmbed({
    listing,
    score,
    latency: { ...latency, label: formatLatency(latency.best) },
    proxyLinks: proxy.links,
  });
}

/**
 * Run every enabled rule over the current candidates.
 *
 * @param {object} opts { client, candidates, observations, routes, fetchImpl, now }
 */
export async function runAlerts({ client, candidates, observations, routes, fetchImpl, sleep }) {
  const { rows: rules } = await client.query(
    `select * from alert_rules where enabled order by id`,
  );
  if (!rules.length) return { rules: 0, fired: 0, delivered: 0, skipped: 'no enabled rules' };

  // Score once, evaluate many: rules differ, the arithmetic does not.
  const scored = candidates.map((listing) => ({
    listing,
    score: scoreAllRoutes({
      listing,
      observations: observations.get(listing.item_id) ?? [],
      routes,
    }).best,
  }));

  const summary = { rules: rules.length, fired: 0, delivered: 0, failed: 0, retried: 0, byRule: {} };

  for (const rule of rules) {
    const firing = [];
    for (const { listing, score } of scored) {
      const verdict = evaluateRule(score, rule, listing);
      if (!verdict.fires) continue;
      const alertId = await claim(client, rule, listing, score);
      // Already alerted on this exact snapshot — not a new event.
      if (!alertId) continue;
      firing.push({ alertId, listing, score });
    }

    summary.byRule[rule.id] = { fired: firing.length, mode: rule.mode };
    summary.fired += firing.length;

    if (!firing.length) continue;
    if (rule.channel === 'none') {
      // A rule can record without notifying — useful while tuning thresholds
      // before pointing it at a webhook.
      for (const f of firing) await markDelivered(client, f.alertId, { ok: true });
      summary.delivered += firing.length;
      continue;
    }

    if (rule.mode === 'digest') {
      // One message for the batch. The digest is for noticing patterns; the
      // realtime alert is for acting now. Different jobs, different cadence.
      const embeds = firing.map((f) => toEmbed(f.listing, f.score));
      const result = await sendDiscord({
        webhookUrl: rule.webhook_url,
        content: `**${rule.display_name}** — ${firing.length} item${firing.length === 1 ? '' : 's'} since the last digest`,
        embeds,
        fetchImpl,
        sleep,
      });
      for (const f of firing) await markDelivered(client, f.alertId, result);
      if (result.ok) summary.delivered += firing.length;
      else summary.failed += firing.length;
      continue;
    }

    // Realtime: one message per item, so each arrives as its own notification.
    for (const f of firing) {
      const result = await sendDiscord({
        webhookUrl: rule.webhook_url,
        embeds: [toEmbed(f.listing, f.score)],
        fetchImpl,
        sleep,
      });
      await markDelivered(client, f.alertId, result);
      if (result.ok) summary.delivered++;
      else summary.failed++;
    }
  }

  // Retry anything a previous run claimed but failed to deliver. At-least-once
  // beats silently dropping the one alert that mattered.
  const { rows: pending } = await client.query(
    `select a.id, a.rule_id, r.webhook_url, r.channel
       from alerts a join alert_rules r on r.id = a.rule_id
      where not a.delivery_ok and r.enabled and r.channel <> 'none'
        and a.created_at < now() - interval '1 minute'
      order by a.created_at limit 20`,
  );
  for (const row of pending) {
    const listing = await client.query(
      `select l.*, s.display_name as source_name from listings l
         join sources s on s.id = l.source_id where l.id = (
           select listing_id from alerts where id = $1)`,
      [row.id],
    );
    if (!listing.rows[0]) continue;
    const result = await sendDiscord({
      webhookUrl: row.webhook_url,
      content: 'Retrying an alert that failed to deliver earlier.',
      embeds: [{ title: listing.rows[0].title_raw, url: listing.rows[0].url ?? undefined }],
      fetchImpl,
      sleep,
    });
    await markDelivered(client, row.id, result);
    summary.retried++;
    if (result.ok) summary.delivered++;
  }

  return summary;
}
