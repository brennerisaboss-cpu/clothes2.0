import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { GATE_COOKIE, gatePassword, localWithoutPassword, tokenValid } from '@/lib/gate.mjs';

// Runs before every page. `middleware.ts` was the name for this until Next 16
// deprecated it in favour of `proxy.ts`; same function, same signature.
//
// The scheduled endpoints are excluded because they carry their own bearer
// token (CRON_SECRET) and are called by a scheduler that has no cookie jar.

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/cron/')) return NextResponse.next();
  if (pathname === '/unlock' || pathname === '/api/unlock') return NextResponse.next();

  const password = gatePassword();

  if (!password) {
    // Serving with no password at all is allowed in exactly one situation: a
    // server we started ourselves, bound to loopback, answering a request that
    // claims to be local and was not forwarded by anything. Then there is
    // genuinely nobody else who can reach the port, and demanding a password
    // to open your own laptop's tool would be theatre.
    //
    // Every other case is refused. Note what is NOT enough on its own: a
    // loopback Host header. A server bound to 0.0.0.0 — which is what plain
    // `next start` does — is reachable from the LAN, the VPN and any tunnel,
    // and `curl -H "Host: localhost"` from any of them looks identical to a
    // local browser. The bind is the fact; the header is a claim.
    if (localWithoutPassword(request.headers)) return NextResponse.next();

    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>Locked</title>` +
        `<body style="font:14px/1.6 ui-monospace,monospace;max-width:38rem;margin:4rem auto;padding:0 1rem">` +
        `<h1 style="font-size:1rem;text-transform:uppercase;letter-spacing:.08em">Locked</h1>` +
        `<p>This server has no password set and is not known to be listening on ` +
        `loopback only, so it serves nothing. The pages hold what you are about to ` +
        `buy and what you think it is worth; they are not published by accident.</p>` +
        `<p>Either set <code>APP_PASSWORD</code>, or start it with ` +
        `<code>npm start</code> or the launcher, which bind to 127.0.0.1 and say so ` +
        `through <code>APP_BIND</code>.</p>` +
        `</body>`,
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

  if (tokenValid(request.cookies.get(GATE_COOKIE)?.value, password)) {
    return NextResponse.next();
  }

  const unlock = request.nextUrl.clone();
  unlock.pathname = '/unlock';
  unlock.search = '';
  // Where to go back to once unlocked, so a bookmarked deep link survives.
  unlock.searchParams.set('next', pathname + request.nextUrl.search);
  return NextResponse.redirect(unlock);
}

export const config = {
  // Everything except Next's own static output. Without a matcher this runs on
  // stylesheets and images too, which would leave the unlock page unstyled.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)'],
};
