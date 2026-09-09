import { NextResponse } from 'next/server';

/**
 * Guard for the scheduled endpoints.
 *
 * These routes mutate data and reach out to third parties, so they are not
 * public. Vercel Cron sends the project's CRON_SECRET as a bearer token; the
 * same secret works for calling them by hand.
 *
 * Refuses when no secret is configured rather than defaulting to open — an
 * unauthenticated poll endpoint is a way for a stranger to make you hammer
 * someone else's shop.
 */
export function checkCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not set; scheduled endpoints are disabled' },
      { status: 503 },
    );
  }
  const header = request.headers.get('authorization');
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  return null;
}
