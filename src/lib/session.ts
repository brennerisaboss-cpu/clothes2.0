import { cookies, headers } from 'next/headers';
import {
  GATE_COOKIE, bearerAllowed, captureTokenAccepted, gatePassword, localWithoutPassword, tokenValid,
} from './gate.mjs';
import type { Capability } from './gate.mjs';

/**
 * Refuse to run unless this request is allowed to be here.
 *
 * proxy.ts already gates every page, so in normal use this never fires. It is
 * here because a server action is not a route: it is a POST to whichever page
 * it was called from, and Next's own documentation warns that a matcher change
 * or moving an action to another file can silently take it out of the proxy's
 * coverage. Nothing would break at that moment — the actions would simply
 * become callable by anyone who knows they exist, and stay that way until
 * someone noticed. So the mutating paths check for themselves.
 *
 * Kept out of gate.ts because that module is imported by proxy.ts, which
 * cannot use next/headers.
 *
 * The capability says what the caller is about to do, and it decides which
 * credentials are enough. Only 'capture' accepts a bearer token; everything
 * else requires the cookie. Callers state it because the default has to be the
 * strict one — an action added later gets full protection by saying nothing.
 */
export async function requireUnlocked(capability: Capability = 'full'): Promise<void> {
  const password = gatePassword();
  const requestHeaders = await headers();

  // The capture credential, for callers that cannot hold a cookie: the mailbox
  // poller, the bookmarklet, a phone shortcut. It reaches exactly one thing,
  // and now it is the code that says so rather than a comment.
  if (bearerAllowed({
    capability,
    header: requestHeaders.get('authorization'),
    captureToken: process.env.CAPTURE_TOKEN,
  })) return;

  if (!password) {
    if (localWithoutPassword(requestHeaders)) return;
    throw new Error(
      'Locked: this server has no APP_PASSWORD set and is not known to be bound to loopback.',
    );
  }

  const token = (await cookies()).get(GATE_COOKIE)?.value;
  if (!tokenValid(token, password)) throw new Error('Locked: unlock this session and try again.');
}

/**
 * The capture routes' own door check.
 *
 * Separate from requireUnlocked because those routes are the only ones a
 * capture credential may open at all — the check there is "is this the capture
 * token", not "what may this caller do".
 */
export function bearerAccepted(header: string | null): boolean {
  return captureTokenAccepted(header, process.env.CAPTURE_TOKEN);
}
