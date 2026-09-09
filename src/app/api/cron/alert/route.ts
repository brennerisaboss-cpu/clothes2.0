import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { runAlerts } from '@/lib/alertRunner.mjs';
import { checkCron } from '@/lib/cronAuth';
import {
  scoringCandidates, observationsForItems, listRoutes, calibrationRatios,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = checkCron(request);
  if (denied) return denied;

  const [candidates, routes, calibration] = await Promise.all([
    scoringCandidates(),
    listRoutes(),
    // The same correction /opportunities applies. Without it an alert pushes a
    // different profit figure from the one the screen shows for the same row.
    calibrationRatios().catch(() => new Map()),
  ]);
  const observations = await observationsForItems([...new Set(candidates.map((c) => c.item_id))]);

  const client = await pool.connect();
  try {
    const summary = await runAlerts({ client, candidates, observations, routes, calibration });
    return NextResponse.json(summary);
  } finally {
    client.release();
  }
}
