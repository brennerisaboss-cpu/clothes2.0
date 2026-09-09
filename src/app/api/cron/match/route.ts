import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { runMatching } from '@/lib/matchRunner.mjs';
import { checkCron } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The matching stage, on a schedule.
 *
 * Polled listings are matched as they land, inside the poll itself. Everything
 * else is not: a pasted page, the capture endpoint and the mailbox reader all
 * write listings with `item_id` null, and a listing with no item pools with
 * nothing, has no comps and can never be scored. On a deployment the only thing
 * that ever fixed that was a person opening the app and pressing a button, so a
 * hosted install collected diligently and produced an empty opportunities
 * screen for as long as nobody visited.
 *
 * Runs between the poll and the alert, so anything matched here is scoreable by
 * the time the alert reads it.
 */
export async function GET(request: Request) {
  const denied = checkCron(request);
  if (denied) return denied;

  const client = await pool.connect();
  try {
    // Deliberately NOT accepting the matchmaker's suggestions. "Nothing is ever
    // linked without you" is a rule this codebase keeps, and a cron job is not
    // a person — the suggestions wait on /unresolved, where they are shown with
    // what they agreed on and what they had to assume.
    const summary = await runMatching({ client });
    return NextResponse.json({
      considered: summary.considered,
      matched: summary.matched,
      unmatched: summary.skipped.length,
    });
  } finally {
    client.release();
  }
}
