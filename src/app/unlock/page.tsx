import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PageHead } from '@/components/Plate';
import {
  GATE_COOKIE, GATE_MAX_AGE, gatePassword, issueToken, passwordMatches,
} from '@/lib/gate.mjs';
import { MAX_FAILURES } from '@/lib/throttle.mjs';
import { attemptUnlock, clientKey } from '@/lib/unlockAttempts.mjs';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The one page that is served without a cookie.
 *
 * Deliberately spare: it says nothing about what is behind it, holds no
 * counts, and touches no data. A locked door should not describe the room.
 */
export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; bad?: string; locked?: string }>;
}) {
  const { next, bad, locked } = await searchParams;
  const password = gatePassword();

  async function unlock(formData: FormData) {
    'use server';
    const secret = gatePassword();
    if (!secret) redirect('/');

    const given = String(formData.get('password') ?? '');
    const to = String(formData.get('next') ?? '/');

    // Counted in the database under a row lock, not paused in this process.
    // A delay alone is per-request latency: it slows a sequential guesser and
    // does nothing to ten parallel requests, which is one line of shell. The
    // lock makes those ten sequential, the count makes each one slower than
    // the last, and ten failures shut the door for fifteen minutes.
    const attempt = await attemptUnlock(
      pool,
      clientKey(await headers()),
      () => passwordMatches(given, secret),
    );

    if (attempt.locked) {
      redirect(`/unlock?locked=${Math.ceil(attempt.retryAfterMs / 60000)}&next=${encodeURIComponent(to)}`);
    }
    if (!attempt.ok) {
      const left = MAX_FAILURES - attempt.failures;
      redirect(`/unlock?bad=${left}&next=${encodeURIComponent(to)}`);
    }

    const store = await cookies();
    const proto = (await headers()).get('x-forwarded-proto');
    store.set(GATE_COOKIE, issueToken(secret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: proto === 'https',
      path: '/',
      maxAge: GATE_MAX_AGE,
    });

    // Only ever back into this app, never to a URL an attacker put in the
    // query string.
    redirect(to.startsWith('/') && !to.startsWith('//') ? to : '/');
  }

  if (!password) redirect('/');

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHead title="Locked" motif="rosette" />
      <form action={unlock} className="space-y-3">
        <input type="hidden" name="next" value={next ?? '/'} />
        <label className="block text-sm" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          className="field w-full"
        />
        {locked ? (
          <p className="text-sm ink-madder">
            Too many attempts. Try again in {locked} minute{locked === '1' ? '' : 's'}.
          </p>
        ) : bad ? (
          <p className="text-sm ink-madder">
            That is not it. {bad} attempt{bad === '1' ? '' : 's'} before this locks for fifteen
            minutes.
          </p>
        ) : null}
        <button type="submit" className="btn">
          Unlock
        </button>
      </form>
    </div>
  );
}
