import { NextResponse } from 'next/server';
import { saveDrafts, type SaveInput } from '@/app/actions';
import { parseBulk } from '@/lib/bulkPaste.mjs';
import { parseHtml } from '@/lib/html.mjs';
import { walkParsedHtml } from '@/lib/pastedHtml.mjs';
import { query } from '@/lib/db';
import { bearerAccepted } from '@/lib/session';

// Where the capture bookmarklet lands.
//
// It arrives as a FORM POST rather than as fetch(), and that is not a stylistic
// choice: Chrome's private-network rules block a page on a public HTTPS origin
// from making a background request to 127.0.0.1 at all — the call hangs and
// never errors, which is how the first version of this behaved when it was
// tested rather than assumed. A form submission is a navigation, and
// navigations are not subject to that rule.
//
// Landing in a tab is also the better shape: you see what was captured instead
// of trusting an alert box.

export const dynamic = 'force-dynamic';

const page = (title: string, body: string, status = 200) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:14px/1.6 ui-monospace,monospace;max-width:40rem;margin:3rem auto;padding:0 1rem">` +
      `<h1 style="font-size:1rem;text-transform:uppercase;letter-spacing:.08em">${title}</h1>${body}` +
      `<p style="color:#777">You can close this tab.</p></body>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return page('Capture failed', '<p>That was not a form submission.</p>', 400);

  // The token travels in the form because the bookmarklet holds it; it is the
  // same secret and the same constant-time check as the header path.
  if (!bearerAccepted(`Bearer ${form.get('token') ?? ''}`)) {
    return page('Capture refused', '<p>The token in that bookmarklet is not the one this app expects.</p>', 401);
  }

  const html = String(form.get('html') ?? '');
  const baseUrl = String(form.get('baseUrl') ?? '') || null;
  if (!html.trim()) return page('Nothing captured', '<p>That page had no markup to read.</p>', 400);

  const sources = await query<{ id: string; base_url: string | null }>(
    `select id, base_url from sources where base_url is not null`,
  ).catch(() => []);

  const walked = walkParsedHtml(parseHtml(html), { base: baseUrl });
  const { drafts, note } = parseBulk(walked.lines.join('\n'), walked.links, sources);
  const ready = drafts.filter((d: { titleRaw?: string }) => d.titleRaw);

  if (!ready.length) {
    return page(
      'Nothing to record',
      `<p>${note}. Nothing on that page parsed as a listing with a price.</p>`,
    );
  }

  const result = await saveDrafts(ready.map((d: Record<string, unknown>) => ({
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
  })) as SaveInput[]);

  const rows = ready
    .slice(0, 20)
    .map((d: Record<string, unknown>) =>
      `<li>${escapeHtml(String(d.titleRaw))} — ${d.price ?? '?'} ${d.currency ?? ''}` +
      `${d.url ? ` <a href="${escapeHtml(String(d.url))}">↗</a>` : ''}</li>`)
    .join('');

  return page(
    `Captured ${result.saved}`,
    `<p>${note}.</p><ul>${rows}</ul>` +
      (result.failed.length ? `<p>${result.failed.length} could not be saved.</p>` : ''),
  );
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
