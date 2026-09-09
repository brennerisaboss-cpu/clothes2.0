import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLoopback, issueToken, tokenValid, passwordMatches, boundToLoopback, viaProxy,
  localWithoutPassword,
} from '../src/lib/gate.mjs';

/** A minimal stand-in for the request headers the proxy sees. */
const headers = (obj = {}) => ({
  get: (k) => obj[k.toLowerCase()] ?? null,
});

test('a token proves the password and nothing else', () => {
  const good = issueToken('correct horse');
  assert.equal(tokenValid(good, 'correct horse'), true);
  assert.equal(tokenValid(good, 'Correct horse'), false, 'a near miss is a miss');
  assert.equal(tokenValid(good, ''), false);
});

test('a token cannot be forged from its own shape', () => {
  const good = issueToken('correct horse');
  const [, expires] = good.split('.');
  assert.equal(tokenValid(`v1.${expires}.` + 'a'.repeat(43), 'correct horse'), false);
  assert.equal(tokenValid(`v1.${expires}`, 'correct horse'), false);
  assert.equal(tokenValid('', 'correct horse'), false);
  assert.equal(tokenValid(undefined, 'correct horse'), false);
});

test('a token expires, and an expired one is not "nearly valid"', () => {
  const now = Date.UTC(2026, 0, 1);
  const token = issueToken('correct horse', now);
  assert.equal(tokenValid(token, 'correct horse', now + 29 * 86400e3), true);
  assert.equal(tokenValid(token, 'correct horse', now + 31 * 86400e3), false);
});

test('an expiry cannot simply be edited forwards', () => {
  const now = Date.UTC(2026, 0, 1);
  const token = issueToken('correct horse', now);
  const [v, expires, mac] = token.split('.');
  const later = `${v}.${Number(expires) + 86400 * 365}.${mac}`;
  assert.equal(tokenValid(later, 'correct horse', now), false, 'the expiry is signed too');
});

test('loopback is recognised in the forms a browser actually sends', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', 'localhost', '[::1]:3000']) {
    assert.equal(isLoopback(host), true, host);
  }
  for (const host of ['resale.example.com', 'clothes.vercel.app', '', null, undefined]) {
    assert.equal(isLoopback(host ?? null), false, String(host));
  }
  // "Every interface" is not "this machine". Binding 0.0.0.0 is how the LAN,
  // the VPN and every tunnel reach the port.
  assert.equal(isLoopback('0.0.0.0'), false);
  assert.equal(boundToLoopback('0.0.0.0'), false);
  assert.equal(boundToLoopback('::'), false);
  assert.equal(boundToLoopback('127.0.0.1'), true);
});

test('a bind nobody declared is unknown, not safe', () => {
  // A server started outside our own scripts leaves APP_BIND unset. Reading
  // that as "probably local" is how a 0.0.0.0 bind serves the LAN silently.
  assert.equal(boundToLoopback(undefined), false);
  assert.equal(boundToLoopback(''), false);
});

test('a spoofed Host header alone does not make a request local', () => {
  // The whole attack: one curl flag, from anywhere that can reach the port.
  // What answers it is the bind, which the attacker does not write.
  const spoofed = headers({ host: 'localhost:3000' });
  assert.equal(localWithoutPassword(spoofed, '0.0.0.0'), false, 'bound to every interface');
  assert.equal(localWithoutPassword(spoofed, '::'), false, 'the same, in v6');
  assert.equal(localWithoutPassword(spoofed, undefined), false, 'bind unknown');
  assert.equal(localWithoutPassword(spoofed, '127.0.0.1'), true, 'only a loopback bind is local');
});

test('a forwarded header is read for what it says, not for existing', () => {
  // Next writes x-forwarded-* onto every request it handles, local ones
  // included. Treating their presence as evidence of a proxy would lock out
  // every request in the application, which is how the first version of this
  // failed its own smoke test.
  const asNextWritesThem = headers({
    host: '127.0.0.1:3000',
    'x-forwarded-for': '127.0.0.1',
    'x-forwarded-host': '127.0.0.1:3000',
    'x-forwarded-proto': 'http',
  });
  assert.equal(viaProxy(asNextWritesThem), false);
  assert.equal(localWithoutPassword(asNextWritesThem, '127.0.0.1'), true);

  // A real client address in front of it is a different matter.
  for (const [header, value] of [
    ['x-forwarded-for', '198.51.100.4'],
    ['x-forwarded-for', '198.51.100.4, 127.0.0.1'],
    ['x-real-ip', '198.51.100.4'],
    ['x-forwarded-host', 'resale.example.com'],
  ]) {
    const h = headers({ host: 'localhost:3000', [header]: value });
    assert.equal(viaProxy(h), true, `${header}: ${value}`);
    assert.equal(localWithoutPassword(h, '127.0.0.1'), false, `${header}: ${value}`);
  }
});

test('a request addressed to a public name is not local either', () => {
  // Bound to loopback and still reached under a public hostname means a tunnel
  // is publishing the port — the case the bind alone cannot see.
  const remote = headers({ host: 'resale.example.com' });
  assert.equal(localWithoutPassword(remote, '127.0.0.1'), false);
  assert.equal(localWithoutPassword(remote, '0.0.0.0'), false);
});

test('the password comparison does not short-circuit on the first character', () => {
  assert.equal(passwordMatches('hunter2', 'hunter2'), true);
  assert.equal(passwordMatches('hunter3', 'hunter2'), false);
  assert.equal(passwordMatches('hunter', 'hunter2'), false);
  assert.equal(passwordMatches('', 'hunter2'), false);
  assert.equal(passwordMatches(undefined, 'hunter2'), false);
});

// --- what a capture credential may do ---------------------------------------
//
// CAPTURE_TOKEN lives in the places most likely to leak it: an env file on a
// mail box, the visible source of a javascript: bookmark, a phone shortcut's
// stored config. That is the whole reason it is separate from APP_PASSWORD.
//
// It was checked inside the gate every server action shares, so it did not mean
// "may add listings" — it meant everything the cookie means, across every
// mutating action, because a server action is independently callable as a raw
// POST. The comment claimed a scope the code did not enforce.

const TOKEN = 'capture-token-long-enough-0123456789';

test('a bearer token satisfies the capture capability and nothing else', async () => {
  const { bearerAllowed } = await import('../src/lib/gate.mjs');
  const header = `Bearer ${TOKEN}`;

  assert.equal(bearerAllowed({ capability: 'capture', header, captureToken: TOKEN }), true);

  // The regression this exists for. Every other action asks for 'full', and a
  // capture credential must bounce off all of them.
  assert.equal(bearerAllowed({ capability: 'full', header, captureToken: TOKEN }), false);
  for (const capability of [undefined, null, '', 'admin', 'FULL', 'Capture']) {
    assert.equal(
      bearerAllowed({ capability, header, captureToken: TOKEN }), false,
      `capability ${String(capability)} must not accept a bearer token`,
    );
  }
});

test('the capture token is compared whole, in constant time', async () => {
  const { captureTokenAccepted } = await import('../src/lib/gate.mjs');
  assert.equal(captureTokenAccepted(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(captureTokenAccepted(`bearer ${TOKEN}`, TOKEN), true, 'the scheme is case-insensitive');
  assert.equal(captureTokenAccepted(`Bearer  ${TOKEN}  `, TOKEN), true, 'padding is not the secret');

  assert.equal(captureTokenAccepted(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(captureTokenAccepted(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN), false);
  assert.equal(captureTokenAccepted(TOKEN, TOKEN), false, 'without the scheme it is not a bearer token');
  assert.equal(captureTokenAccepted(null, TOKEN), false);
  assert.equal(captureTokenAccepted('Bearer ', TOKEN), false);
});

test('no token configured means no token accepted', async () => {
  const { captureTokenAccepted } = await import('../src/lib/gate.mjs');
  // An endpoint that opens itself because nobody set a secret is the fail-open
  // shape this codebase keeps refusing.
  for (const configured of [undefined, null, '', 'short', 'still-too-short']) {
    assert.equal(captureTokenAccepted(`Bearer ${configured}`, configured), false, String(configured));
    assert.equal(captureTokenAccepted(`Bearer ${TOKEN}`, configured), false, String(configured));
  }
});

test('exactly one action accepts a capture credential, and it is saveDrafts', async () => {
  // The capability is one argument per action, and the protection is that the
  // default is the strict one. That makes the risk a typo: a later action
  // written as requireUnlocked('capture') would hand a leaked token another
  // door, and nothing at runtime would look different. So the source itself is
  // the assertion.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');

  const scoped = [];
  for (const chunk of source.split('export async function ').slice(1)) {
    const name = chunk.match(/^(\w+)/)?.[1];
    const call = chunk.match(/requireUnlocked\(([^)]*)\)/);
    if (!name || !call) continue;
    const argument = call[1].trim();
    if (argument) scoped.push([name, argument]);
  }

  assert.deepEqual(scoped, [['saveDrafts', "'capture'"]]);

  // And every other exported action must ask for one, rather than relying on
  // the proxy: a server action is an independently callable POST.
  const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  const guarded = [...source.matchAll(/export async function (\w+)[\s\S]{0,400}?requireUnlocked\(/g)]
    .map((m) => m[1]);
  assert.deepEqual(
    exported.filter((name) => !guarded.includes(name)),
    [],
    'every exported server action must call requireUnlocked',
  );
});

// --- does every mutating action verify its own precondition? ----------------
//
// applySuggestions took whatever {listingId, itemId} pairs it was handed and
// wrote them, with the rule that decides which pairs are legitimate living in
// the PAGE that rendered the button. A server action is an independently
// callable POST, so that was no enforcement at all — the same shape as the
// Host-header check, the x-forwarded-for check and the capture-token scope
// before it. Four times is a pattern rather than four mistakes, so it gets a
// standing check instead of being found again.
//
// This cannot be decided automatically: whether an action's arguments are
// merely DATA (a title, a price — the operator may write what they like) or a
// CLAIM about the database's own state ("these two rows belong together",
// "this listing is gone") is a judgement. So the judgement is written down
// here, and an action added later belongs to neither list until someone makes
// it — which is the point. The test fails until they do.

// Arguments are data the operator is entitled to write. Nothing is asserted
// about other rows, so there is no precondition to verify beyond the gate.
const TAKES_ONLY_DATA = [
  'saveListing', 'verifyListing', 'recordReview', 'prefill', 'parsePaste',
  'saveDrafts', 'runMatching', 'candidateItems', 'suggestionsFor', 'clustersFor',
  'watchItemHeat', 'unwatchItemHeat', 'isWatchedForHeat',
  // runMatching takes a boolean that lets it accept the matchmaker's strongest
  // proposals, which sounds like a claim and is not one: the caller cannot name
  // a pair. WHICH links are permissible is re-derived inside matchRunner from
  // the listing and item rows as they are now, by the same safeToApply test
  // applySuggestions is held to. A mode the operator turns on, not a list they
  // hand in — which is exactly the distinction this file draws.
  // Writes the strongest evidence class the platform stores — "these pieces
  // sold at these prices" — and is still data rather than a claim, because the
  // distinction this list draws is about EXISTING ROWS. saveSoldDrafts creates
  // new observations from a page the operator is looking at; there is nothing
  // in the database for it to check them against, and if there were, the
  // operator's eyes would still be the better source. What protects it is the
  // capability gate rather than a precondition: it takes the default capability
  // and therefore refuses a capture token, which the scope test above pins.
  'saveSoldDrafts',
];

// Arguments assert something about the data that the action must CHECK rather
// than believe. Each name maps to the thing in its body that does the checking.
const VERIFIES_ITS_CLAIM = {
  // Re-derives every pair from the listing and item rows as they are now.
  applySuggestions: 'admissibleLinks',
  // A person chose this one link, one at a time, having read the reasons: the
  // deliberate single act is the check, and it is the escape hatch bulk-accept
  // deliberately does not have.
  resolveListing: 'requireUnlocked',
  // Same: a group the operator looked at, with the sub-line typed by hand,
  // because none of the members states one.
  resolveCluster: 'requireUnlocked',
};

test('every mutating server action is classified, and the claim-bearing ones check their claim', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');

  const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  const classified = new Set([...TAKES_ONLY_DATA, ...Object.keys(VERIFIES_ITS_CLAIM)]);

  assert.deepEqual(
    exported.filter((name) => !classified.has(name)),
    [],
    'a new server action must be classified above: are its arguments data the operator may ' +
      'write, or a claim about existing rows that it has to verify for itself?',
  );

  // And the ones that carry a claim must visibly do the checking.
  for (const [name, mustCall] of Object.entries(VERIFIES_ITS_CLAIM)) {
    const body = source.split(`export async function ${name}`)[1]?.split('\nexport async function')[0] ?? '';
    assert.ok(body.includes(mustCall), `${name} must call ${mustCall} — that is what verifies its claim`);
  }
});
