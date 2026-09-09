import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { saveDrafts, type SaveInput } from '@/app/actions';
import { parseAlertEmail, parseBulk } from '@/lib/bulkPaste.mjs';
import { parseHtml } from '@/lib/html.mjs';
import { walkParsedHtml } from '@/lib/pastedHtml.mjs';
import { prefillFromUrl } from '@/lib/urlPrefill.mjs';
import { query } from '@/lib/db';
import { bearerAccepted } from '@/lib/session';

// One way in for everything that is not a person at the keyboard.
//
//   the mailbox poller   an alert email the venue sent you
//   a bookmarklet        the page you are looking at, when you click it
//   a phone shortcut     a listing URL from the share sheet
//
// All three are the same act the /add screen already performs — you, present,
// deciding to record something — with fewer steps. None of them fetches
// anything from a venue: the email was sent to you, the page is already open in
// front of you, and the URL came out of your own share sheet.
//
// Everything still lands as an ordinary manual listing, and nothing here can
// buy anything.

export const dynamic = 'force-dynamic';

/** The bookmarklet posts from the venue's own origin, so it is a CORS request. */
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
  // Chrome's private-network rules: a page on a public HTTPS origin may not
  // call a local address at all unless the local server says on the preflight
  // that it accepts it. Without this the bookmarklet's fetch never completes
  // and never errors — it simply hangs, which is exactly how it behaved the
  // first time this was tested rather than assumed.
  'access-control-allow-private-network': 'true',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(request: Request) {
  // The token is the whole gate for this route. The wildcard origin above is
  // only safe because of it: any page can ASK, none can succeed without the
  // secret, and it is never sent to a venue — the bookmarklet holds it.
  if (!bearerAccepted((await headers()).get('authorization'))) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401, headers: cors });
  }

  let body: {
    kind?: 'email' | 'page' | 'url';
    html?: string;
    text?: string;
    links?: [number, string | null, string | null][];
    url?: string;
    baseUrl?: string;
    sourceId?: string;
    dryRun?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body was not JSON' }, { status: 400, headers: cors });
  }

  const sources = await query<{ id: string; base_url: string | null }>(
    `select id, base_url from sources where base_url is not null`,
  ).catch(() => []);

  let drafts: Record<string, unknown>[] = [];
  let note = '';

  if (body.kind === 'email' && body.html) {
    ({ drafts, note } = parseAlertEmail(body.html, sources));
  } else if (body.kind === 'page' && body.html) {
    // The bookmarklet's path. It sends the markup of what you are looking at
    // and the same walk runs here that runs on a paste — so the bookmarklet
    // itself stays one line and gains nothing to keep in step.
    // The page's own address, so relative hrefs resolve. Markup read straight
    // off a page keeps them exactly as the author wrote them — unlike a
    // clipboard, which absolutises on the way out.
    const walked = walkParsedHtml(parseHtml(body.html), { base: body.baseUrl });
    ({ drafts, note } = parseBulk(walked.lines.join('\n'), walked.links, sources));
  } else if (body.kind === 'url' && body.url) {
    // A bare URL from a share sheet. Everything a URL cannot carry — price,
    // size, condition — stays empty rather than being invented, so it arrives
    // in the verification queue as something to finish rather than as a fact.
    const prefill = prefillFromUrl(body.url, sources);
    if (!prefill.ok) {
      return NextResponse.json({ error: prefill.note }, { status: 400, headers: cors });
    }
    drafts = [{
      titleRaw: prefill.fields.titleRaw ?? body.url,
      sourceId: body.sourceId ?? prefill.sourceId,
      sourceItemId: prefill.fields.sourceItemId ?? null,
      url: prefill.url,
      price: null,
      currency: null,
    }];
    note = prefill.note;
  } else if (body.text) {
    ({ drafts, note } = parseBulk(body.text, body.links ?? [], sources));
  } else {
    return NextResponse.json(
      { error: 'send { kind: "email", html } or { kind: "url", url } or { text, links }' },
      { status: 400, headers: cors },
    );
  }

  if (body.sourceId) drafts = drafts.map((d) => ({ ...d, sourceId: body.sourceId }));

  // A capture with no price is still worth keeping — it is a piece you saw and
  // want to look at again — but it cannot be scored, so it is saved with the
  // price left empty rather than dropped or guessed at.
  const ready = drafts.filter((d) => d.titleRaw);
  if (body.dryRun) {
    return NextResponse.json({ note, drafts: ready }, { headers: cors });
  }

  const result = await saveDrafts(
    ready.map((d) => ({
      title: String(d.titleRaw),
      brandRaw: (d.brandRaw as string) ?? undefined,
      sourceId: String(d.sourceId ?? 'manual_other'),
      sourceItemId: (d.sourceItemId as string) ?? undefined,
      url: (d.url as string) ?? undefined,
      imageUrl: (d.imageUrl as string) ?? undefined,
      price: (d.price as number) ?? 0,
      currency: (d.currency as string) ?? 'EUR',
      sizeRaw: (d.sizeRaw as string) ?? undefined,
      conditionRaw: (d.conditionRaw as string) ?? undefined,
      sublineId: (d.sublineId as string) ?? undefined,
      adYear: (d.adYear as number) ?? undefined,
      notes: (d.notes as string) ?? undefined,
    })) as SaveInput[],
  );

  return NextResponse.json(
    { note, saved: result.saved, failed: result.failed.length, drafts: ready.length },
    { headers: cors },
  );
}
