// The unlock throttle, against a real Postgres.
//
// The pure delay/lockout arithmetic is covered in throttle.test.mjs. What only
// a database can show is the part that made the first attempt at this useless:
// whether ten SIMULTANEOUS guesses are actually slowed, or whether they all
// read a failure count of zero, wait in parallel and cost an attacker one
// round trip for ten guesses.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { attemptUnlock } from '../src/lib/unlockAttempts.mjs';
import { MAX_FAILURES } from '../src/lib/throttle.mjs';

const CLIENT = 'test-throttle-198.51.100.7';
let pool;

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
});

beforeEach(async () => {
  await pool.query('delete from unlock_attempts where client like $1', ['test-throttle-%']);
});

after(async () => {
  await pool.query('delete from unlock_attempts where client like $1', ['test-throttle-%']);
  await pool.end();
});

const wrong = () => false;
const right = () => true;

test('the right password gets in, and leaves no counter behind', async () => {
  await attemptUnlock(pool, CLIENT, wrong);
  const ok = await attemptUnlock(pool, CLIENT, right);
  assert.equal(ok.ok, true);

  const { rows } = await pool.query('select * from unlock_attempts where client = $1', [CLIENT]);
  assert.equal(rows.length, 0, 'a client that got in is not still being throttled');
});

test('simultaneous guesses are serialised, not answered in parallel', async () => {
  // The whole point. Ten parallel wrong guesses must see each other: the row
  // lock queues them, so each pays the delay earned by the ones before it.
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: 6 }, () => attemptUnlock(pool, CLIENT, wrong)),
  );
  const elapsed = Date.now() - started;

  // Every attempt was counted — nothing was lost to a lost update.
  const failures = results.map((r) => r.failures).sort((a, b) => a - b);
  assert.deepEqual(failures, [1, 2, 3, 4, 5, 6], 'each parallel attempt must see the ones before it');

  // 250 + 500 + 1000 + 2000 + 4000 = 7750ms of enforced delay across six
  // attempts (the first pays nothing). In parallel with no lock this would
  // have finished in about 250ms.
  assert.ok(elapsed > 5000, `six parallel guesses took only ${elapsed}ms — they raced`);
});

test('a run of wrong guesses ends in a lockout that refuses immediately', async () => {
  // Walk the counter up without paying the escalating delay for each step.
  await pool.query(
    `insert into unlock_attempts (client, failures, first_failure_at, last_failure_at)
     values ($1, $2, now(), now())`,
    [CLIENT, MAX_FAILURES - 1],
  );

  const last = await attemptUnlock(pool, CLIENT, wrong);
  assert.equal(last.locked, true, 'the tenth failure closes the door');

  const started = Date.now();
  const refused = await attemptUnlock(pool, CLIENT, right);
  assert.equal(refused.ok, false, 'even the correct password waits out the lockout');
  assert.equal(refused.locked, true);
  assert.ok(refused.retryAfterMs > 10 * 60 * 1000);
  // Refusing is free, so a locked-out attacker cannot hold connections open.
  assert.ok(Date.now() - started < 1000);
});

test('clients are counted apart, so one guesser cannot lock out the owner', async () => {
  const other = 'test-throttle-203.0.113.9';
  await pool.query(
    `insert into unlock_attempts (client, failures, first_failure_at, last_failure_at, locked_until)
     values ($1, $2, now(), now(), now() + interval '15 minutes')`,
    [other, MAX_FAILURES],
  );

  const mine = await attemptUnlock(pool, CLIENT, right);
  assert.equal(mine.ok, true);
});
