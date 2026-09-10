import { NextResponse } from 'next/server';
import { collectingUserAgent } from '@/lib/userAgent.mjs';
import { pool } from '@/lib/db';
import { runPoll } from '@/lib/pollRunner.mjs';
import { checkCron } from '@/lib/cronAuth';
import { adapterFor } from '@/lib/adapters/index.mjs';
import { DUE_FOR_POLL } from '@/lib/ingest.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = checkCron(request);
  if (denied) return denied;

  const client = await pool.connect();
  const results: unknown[] = [];
  try {
    const { rows: sources } = await client.query(
      // The same rule the CLI applies, shared so the two cannot drift: a source
      // is polled on its own cadence, and one that answered 429 is left alone
      // until its cooldown passes. This endpoint fires every fifteen minutes,
      // so without it every source was read every fifteen minutes whatever its
      // poll_interval_minutes said — which is what makes a shop rate-limit.
      `select s.* from sources s
        where s.tier = 'feed' and s.automation_allowed and s.permission_status <> 'declined'
          and ${DUE_FOR_POLL}
        order by s.id`,
    );
    // Never a fabricated contact, and never a refusal to collect either: a
    // scheduled poll that stops for want of a contact simply gathers nothing,
    // for as long as nobody notices.
    const { ua } = collectingUserAgent();

    for (const source of sources) {
      // One registry, shared with `npm run poll`. This endpoint used to keep
      // its own and knew three fewer adapters than the CLI, so a WooCommerce
      // shop or a merchant feed worked by hand and failed on every schedule.
      const adapter = adapterFor(source.config);
      if (!adapter) {
        results.push({ source: source.id, ok: false, error: 'no adapter configured' });
        continue;
      }
      const result = await runPoll({
        client,
        source,
        adapter,
        baseCurrency: process.env.BASE_CURRENCY ?? 'EUR',
        // Never a fabricated contact. A poll that cannot say who is making it
        // does not go out — see src/lib/userAgent.mjs.
        userAgent: ua,
      });
      results.push({ source: source.id, ...result });
    }
  } finally {
    client.release();
  }

  // A vetoed poll is a normal outcome, not a failure of the endpoint.
  // `polled` is now what was DUE, which on most ticks is fewer than the number
  // configured — that is the cadence working, not sources going missing.
  return NextResponse.json({ polled: results.length, results });
}
