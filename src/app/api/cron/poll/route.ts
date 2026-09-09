import { NextResponse } from 'next/server';
import { collectingUserAgent } from '@/lib/userAgent.mjs';
import { pool } from '@/lib/db';
import { runPoll } from '@/lib/pollRunner.mjs';
import { checkCron } from '@/lib/cronAuth';
import * as shopify from '@/lib/adapters/shopify.mjs';
import * as yahooShopping from '@/lib/adapters/yahooShopping.mjs';
import * as rakuten from '@/lib/adapters/rakuten.mjs';
import * as ebay from '@/lib/adapters/ebay.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADAPTERS: Record<string, unknown> = { shopify, yahoo_shopping: yahooShopping, rakuten, ebay };

export async function GET(request: Request) {
  const denied = checkCron(request);
  if (denied) return denied;

  const client = await pool.connect();
  const results: unknown[] = [];
  try {
    const { rows: sources } = await client.query(
      `select * from sources
        where tier = 'feed' and automation_allowed and permission_status <> 'declined'
        order by id`,
    );
    // Never a fabricated contact, and never a refusal to collect either: a
    // scheduled poll that stops for want of a contact simply gathers nothing,
    // for as long as nobody notices.
    const { ua } = collectingUserAgent();

    for (const source of sources) {
      const adapter = ADAPTERS[source.config?.adapter ?? 'shopify'];
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
  return NextResponse.json({ polled: results.length, results });
}
