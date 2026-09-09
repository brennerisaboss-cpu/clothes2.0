import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { runAlerts } from '@/lib/alertRunner.mjs';
import { checkCron } from '@/lib/cronAuth';
import { scoringCandidates, observationsForItems, listRoutes } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = checkCron(request);
  if (denied) return denied;

  const [candidates, routes] = await Promise.all([scoringCandidates(), listRoutes()]);
  const observations = await observationsForItems([...new Set(candidates.map((c) => c.item_id))]);

  const client = await pool.connect();
  try {
    const summary = await runAlerts({ client, candidates, observations, routes });
    return NextResponse.json(summary);
  } finally {
    client.release();
  }
}
