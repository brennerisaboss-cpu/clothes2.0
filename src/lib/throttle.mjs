// How hard to make the next guess.
//
// Kept as a pure function of the recorded state so it can be tested without a
// database and without waiting for real seconds to pass. The database part —
// counting attempts under a row lock so parallel requests queue rather than
// race — lives in unlockAttempts.ts beside it.
//
// The shape of the defence, in order of what it stops:
//
//   1. A delay that doubles with each failure. One wrong password costs a
//      quarter second; the tenth costs eight. Sequential guessing dies here.
//   2. A lockout after a fixed number of failures, so the delay cannot simply
//      be waited out at scale.
//   3. The row lock in the caller, so ten simultaneous attempts are ten
//      sequential ones and both of the above still apply.
//
// None of it stops someone who knows the password, and none of it is a
// substitute for the password being long. It stops guessing, which is the
// attack a single shared secret is actually exposed to.

/** Failures needed before the door closes entirely. */
export const MAX_FAILURES = 10;

/** How long it stays closed once it does. */
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Quiet period after which the count resets.
 *
 * Long enough that a run of guesses cannot be spread out cheaply, short enough
 * that mistyping your own password twice on Monday is not still costing you on
 * Tuesday.
 */
export const RESET_AFTER_MS = 60 * 60 * 1000;

const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 8000;

/**
 * What should happen to the attempt about to be made?
 *
 * @param {{failures?: number, last_failure_at?: Date|string|null, locked_until?: Date|string|null}|null} state
 * @param {number} now epoch millis
 * @returns {{locked: boolean, retryAfterMs: number, delayMs: number, failures: number}}
 */
export function throttleFor(state, now = Date.now()) {
  const lockedUntil = at(state?.locked_until);
  if (lockedUntil != null && lockedUntil > now) {
    return { locked: true, retryAfterMs: lockedUntil - now, delayMs: 0, failures: count(state) };
  }

  // A lockout that has expired takes the count with it, or the first attempt
  // after waiting it out would be locked again immediately.
  const last = at(state?.last_failure_at);
  const stale = last == null || now - last > RESET_AFTER_MS;
  const failures = stale || (lockedUntil != null && lockedUntil <= now) ? 0 : count(state);

  return {
    locked: false,
    retryAfterMs: 0,
    // Applied BEFORE the password is checked, so a correct password costs the
    // same as a wrong one and the timing says nothing about which it was.
    delayMs: Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** failures),
    failures,
  };
}

/** The state to store after an attempt fails. */
export function afterFailure(state, now = Date.now()) {
  const { failures } = throttleFor(state, now);
  const next = failures + 1;
  return {
    failures: next,
    first_failure_at: new Date(failures === 0 ? now : (at(state?.first_failure_at) ?? now)),
    last_failure_at: new Date(now),
    locked_until: next >= MAX_FAILURES ? new Date(now + LOCKOUT_MS) : null,
  };
}

const count = (state) => {
  const n = Number(state?.failures ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const at = (value) => {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};
