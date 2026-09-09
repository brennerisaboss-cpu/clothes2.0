import { createHmac, timingSafeEqual } from 'node:crypto';

// Who is allowed to look at this.
//
// Locally there is nothing to protect against: the server listens on loopback
// and the only person who can reach it is the person who started it. Deployed,
// every page is world-readable by default — and the pages are a list of what
// you are about to buy, at what price, and what you believe it is worth. That
// is not a dataset to publish, and the failure is silent: a deployment with no
// password looks exactly like one with a password until someone finds the URL.
//
// So the rule is loopback-open, everywhere-else-closed. A remote request with
// no APP_PASSWORD set is refused outright rather than served — fail closed,
// because the alternative fails open and says nothing.

const COOKIE = 'gate';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** The configured password, or null when there is none. */
export function gatePassword() {
  const raw = process.env.APP_PASSWORD;
  return raw && raw.length > 0 ? raw : null;
}

/**
 * Is this address the machine itself?
 *
 * Used for two different things below, and it is worth being clear that as a
 * judgement about a REQUEST it is worthless on its own: the Host header is
 * written by whoever sent the request. `curl -H "Host: localhost"` from
 * anywhere that can reach the port says the same thing a local browser does.
 */
export function isLoopback(host) {
  if (!host) return false;
  const name = String(host).replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

/**
 * Where this server is listening, if we were the ones who started it.
 *
 * `npm run dev`, `npm start` and the launcher all bind loopback explicitly and
 * pass the address through APP_BIND, so the answer is normally known. A server
 * started some other way — a raw `next start`, a platform that runs the
 * standalone output — leaves it unset, and unset means UNKNOWN rather than
 * safe.
 *
 * 0.0.0.0 and :: are not loopback. They are "every interface on this machine",
 * which is the LAN, the VPN and the tunnel as well.
 */
export function boundToLoopback(bind = process.env.APP_BIND) {
  if (!bind) return false;
  return isLoopback(bind);
}

/**
 * Did this request come from somewhere else, as far as the headers admit?
 *
 * Asked by VALUE, not by presence. Next writes x-forwarded-for, -host, -port
 * and -proto onto every request it handles, local ones included, so "a
 * forwarded header exists" describes every request in the application and is
 * worth nothing. What the values say is worth something: something genuinely
 * sitting in front puts the real client address in there, and that address is
 * not 127.0.0.1.
 *
 * A client can write those headers itself, so this is a second lock rather
 * than the lock. The bind below is the fact; this catches the honest case.
 */
export function viaProxy(headers) {
  const forwardedFor = headers?.get?.('x-forwarded-for');
  const firstHop = forwardedFor ? forwardedFor.split(',')[0].trim() : null;
  if (firstHop && !isLoopback(firstHop)) return true;

  const realIp = headers?.get?.('x-real-ip');
  if (realIp && !isLoopback(realIp)) return true;

  // A hostname that is not this machine's own means the request was addressed
  // to something else and routed here — a tunnel, or a proxy with its own name.
  const host = headers?.get?.('x-forwarded-host') ?? headers?.get?.('host');
  if (host && !isLoopback(host)) return true;

  return false;
}

/**
 * May this request be served without a password?
 *
 * The load-bearing half is the BIND. A server listening on 127.0.0.1 cannot be
 * connected to from another machine at all, so a request that arrives is local
 * by construction and no header has to be believed. A server on 0.0.0.0 —
 * which is what plain `next start` does — is reachable from the LAN, the VPN
 * and any tunnel, and there `curl -H "Host: localhost"` is indistinguishable
 * from a local browser. That is why the first version of this, which asked
 * only about the Host header, was not a check at all.
 *
 * An unset APP_BIND is UNKNOWN, and unknown is refused. Our own start paths
 * set it; anything else sets a password instead.
 *
 * What this cannot see is a deliberate forward of the loopback port — `ssh -L`,
 * a tunnel, a container publishing it. Nothing in the process can: those
 * arrive on loopback because someone with access to the machine arranged it.
 * Hence the guidance in the README, which is "set APP_PASSWORD unless this is
 * strictly localhost-bound and unforwarded" rather than "set it when you
 * deploy".
 */
export function localWithoutPassword(headers, bind = process.env.APP_BIND) {
  return boundToLoopback(bind) && !viaProxy(headers);
}

const key = (password) => createHmac('sha256', `resale-tracker-gate:${password}`);

/** A token that proves knowledge of the password, good for thirty days. */
export function issueToken(password, now = Date.now()) {
  const expires = Math.floor(now / 1000) + THIRTY_DAYS;
  const mac = key(password).update(String(expires)).digest('base64url');
  return `v1.${expires}.${mac}`;
}

export function tokenValid(token, password, now = Date.now()) {
  if (!token) return false;
  const [version, expires, mac] = token.split('.');
  if (version !== 'v1' || !expires || !mac) return false;
  if (Number(expires) * 1000 < now) return false;

  const expected = key(password).update(expires).digest('base64url');
  // Compared byte-by-byte in constant time. The comparison leaks nothing an
  // attacker could use here, but a length-dependent early return is the kind
  // of thing that gets copied into somewhere it does matter.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time password check, for the unlock form. */
export function passwordMatches(given, password) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(password);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const GATE_COOKIE = COOKIE;
export const GATE_MAX_AGE = THIRTY_DAYS;

/**
 * What a capture credential is allowed to do — and it is one thing.
 *
 * CAPTURE_TOKEN exists because the mailbox poller, the bookmarklet and a phone
 * shortcut cannot hold a cookie, and it deliberately lives in the places most
 * likely to leak one: an env file on a mail box, the visible source of a
 * `javascript:` bookmark, a shortcut's stored config. The whole reason it is a
 * SEPARATE secret from APP_PASSWORD is that it will end up somewhere exposed.
 *
 * Which makes where it is checked the load-bearing part. It was checked inside
 * the shared gate that every server action calls, so it did not mean "may add
 * listings" — it meant everything the cookie means, across every mutating
 * action in the app, because a server action is independently callable as a
 * raw POST. The comment claimed a scope the code did not enforce, which is the
 * same mistake as trusting the Host header and trusting x-forwarded-for: a
 * property assumed rather than checked.
 *
 * So the capability is a parameter, and this is the only pairing that lets a
 * bearer token through. Everything else requires the cookie, or a loopback
 * bind with no password set.
 */
export function bearerAllowed({ capability, header, captureToken }) {
  if (capability !== 'capture') return false;
  return captureTokenAccepted(header, captureToken);
}

/** Does this Authorization header carry the configured capture token? */
export function captureTokenAccepted(header, captureToken) {
  // No token configured means no token accepted. An endpoint that opens itself
  // because nobody set a secret is the fail-open shape this codebase keeps
  // refusing.
  if (!captureToken || String(captureToken).length < 16) return false;
  const given = /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim();
  if (!given) return false;
  return passwordMatches(given, String(captureToken));
}
