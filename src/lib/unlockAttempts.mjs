import { afterFailure, throttleFor } from './throttle.mjs';
import { boundToLoopback } from './gate.mjs';

/**
 * Check one password attempt, under a lock, and record what happened.
 *
 * Takes the pool rather than importing it, so the integration test can prove
 * the thing that matters here — that ten simultaneous attempts are serialised
 * — against a real Postgres.
 *
 * The lock is the point. Ten simultaneous guesses against one client row are
 * serialised by `select … for update`, so each one sees the failures of the
 * one before it and pays the escalating delay — which is what turns a per-
 * request pause into an actual rate limit. Without it, the ten read a count of
 * zero, wait 250ms in parallel, and the throttle is decorative.
 *
 * The delay is applied before the password is compared and is the same
 * whichever way the comparison goes, so the time a response takes says nothing
 * about how close the guess was.
 */
export async function attemptUnlock(pool, client, check) {
  const db = await pool.connect();
  try {
    await db.query('begin');

    // Create the row before locking it, so the first attempt from a client
    // takes the same path as every later one.
    await db.query(
      `insert into unlock_attempts (client) values ($1) on conflict (client) do nothing`,
      [client],
    );
    const { rows } = await db.query(
      `select failures, first_failure_at, last_failure_at, locked_until
         from unlock_attempts where client = $1 for update`,
      [client],
    );

    const state = rows[0] ?? null;
    const decision = throttleFor(state);

    if (decision.locked) {
      await db.query('commit');
      return { ok: false, locked: true, retryAfterMs: decision.retryAfterMs, failures: decision.failures };
    }

    if (decision.delayMs > 0) await sleep(decision.delayMs);

    if (check()) {
      // Nothing to remember about a client that got in.
      await db.query('delete from unlock_attempts where client = $1', [client]);
      await db.query('commit');
      return { ok: true, locked: false, retryAfterMs: 0, failures: 0 };
    }

    const next = afterFailure(state);
    await db.query(
      `update unlock_attempts
          set failures = $2, first_failure_at = $3, last_failure_at = $4,
              locked_until = $5, updated_at = now()
        where client = $1`,
      [client, next.failures, next.first_failure_at, next.last_failure_at, next.locked_until],
    );
    await db.query('commit');

    return {
      ok: false,
      locked: next.locked_until != null,
      retryAfterMs: next.locked_until ? next.locked_until.getTime() - Date.now() : 0,
      failures: next.failures,
    };
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/**
 * Which counter this attempt belongs to.
 *
 * This took the first entry of x-forwarded-for and used it as the identity,
 * which defeats the entire lockout wherever that header is client-supplied: a
 * new fake address on every request is a new row with zero failures, forever.
 * `next start` behind an nginx that appends to a client's header rather than
 * overwriting it is enough. It is the same mistake the loopback check made —
 * a header believed on its own — and it takes the same fix: cross-check it
 * against something the request cannot forge.
 *
 * Three cases, in order of how much can be known:
 *
 *   Bound to loopback. Nobody but this machine can open a socket, so there is
 *   exactly one guesser and the header is irrelevant. One bucket.
 *
 *   A trusted proxy declared. APP_TRUST_PROXY says the thing in front
 *   OVERWRITES x-forwarded-for rather than appending to whatever arrived —
 *   which Vercel and Cloudflare do, and a hand-rolled nginx often does not.
 *   Only then is the first hop a fact about the client rather than a wish.
 *
 *   Anything else. One bucket for everyone, because no per-client identity
 *   here can be believed. It means a determined guesser can lock the owner out
 *   for fifteen minutes, and that is the right way round: a stranger delaying
 *   you is recoverable, a stranger reading your buying positions is not.
 */
export function clientKey(headers, options = {}) {
  const bind = options.bind ?? process.env.APP_BIND;
  const trustProxy = options.trustProxy ?? process.env.APP_TRUST_PROXY;

  if (boundToLoopback(bind)) return 'local';

  if (trusted(trustProxy)) {
    const forwarded = headers?.get?.('x-forwarded-for');
    const first = forwarded ? forwarded.split(',')[0].trim() : '';
    if (first) return `fwd:${first.slice(0, 100)}`;
    const real = headers?.get?.('x-real-ip')?.trim();
    if (real) return `ip:${real.slice(0, 100)}`;
  }

  // Deliberately one shared bucket, and deliberately not derived from anything
  // in the request: a key an attacker can vary is not a limit.
  return 'all';
}

const trusted = (value) => /^(?:1|true|yes|on)$/i.test(String(value ?? '').trim());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
