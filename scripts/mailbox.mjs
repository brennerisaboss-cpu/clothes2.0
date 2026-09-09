// Read the alerts the venues send you.
//
//   npm run mailbox                       read what is unread, record it
//   npm run mailbox -- --dry-run          parse and print, change nothing
//   npm run mailbox -- --file alert.eml   read one saved message, change nothing
//   npm run mailbox -- --file alert.txt   ...or the email simply copied
//
// The --file forms need no mailbox, no credentials and no app running, and
// they are how to find out whether this reads YOUR alerts. Every fixture
// behind it was written from what these emails are shaped like, not from one
// that was sent, so until a real message goes through, none of it is evidence.
//
// The easiest way to produce one, and the reason the .txt form exists:
//
//     open the alert, select all, copy, paste into a file, run it
//
// takes five seconds in any client on any device. The .eml form is better
// where you can get it — it keeps the links, which a plain-text copy loses —
// and in Gmail that is ⋮ → Download message. When nothing parses, this prints
// what the parser actually saw rather than asking you to work it out.
//
// The RealReal, Grailed and Vestiaire all offer saved-search email alerts, and
// that is the only channel any of them offers for this. Nothing here touches a
// venue: it opens YOUR mailbox, reads mail they chose to send, and records what
// is in it. On their schedule, through the mechanism they built for it.
//
// Setting it up
// -------------
//   1. Turn on saved-search alerts on each site, for the searches you care
//      about — the brands, sizes and price bands you actually buy in.
//   2. Point them at a mailbox this can log into, or filter them into their own
//      folder in the mailbox you have. A dedicated address is tidier and means
//      a mistake here cannot touch anything else you have.
//   3. Put the credentials in .env.local (MAILBOX_*), and an app password
//      rather than your real one wherever the provider offers one.
//   4. Run it, on whatever schedule you like. It is idempotent: mail already
//      read is not read again, and a listing already recorded is not doubled.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const file = flag('file');

// One saved message, read from disk. Deliberately checked before the mailbox
// credentials, so this path needs none of them.
if (file) {
  const { readFile } = await import('node:fs/promises');
  const { parseAlertEmail } = await import('../src/lib/bulkPaste.mjs');

  const raw = await readFile(file).catch((err) => {
    console.error(`\nCannot read ${file}: ${err.message}\n`);
    process.exit(1);
  });

  // Three shapes, because the difference between them is entirely about how
  // hard the file was to produce, and the hardest was the only one accepted.
  //
  //   .eml   a whole MIME message — accurate, and needs a mail client that
  //          offers "download message"
  //   .html  the part, saved out of a browser
  //   .txt   the email SELECTED AND COPIED, which anyone can do in five
  //          seconds from any client on any device
  //
  // That last one is why this had never been run against a real message: it
  // asked for the artefact that is most annoying to get. A copied email is the
  // same shape as a copied page, and the page parser already reads it.
  const head = raw.subarray(0, 400).toString('utf8');
  const looksLikeMime = /^[\w-]+:\s/m.test(head);
  const looksLikeHtml = /<\s*(?:html|body|table|div|a\s)/i.test(raw.subarray(0, 4000).toString('utf8'));

  const parsed = looksLikeMime ? await simpleParser(raw) : null;
  const html = parsed?.html || (looksLikeMime ? null : looksLikeHtml ? raw.toString('utf8') : null);

  if (!html) {
    // Plain text: read it the way a pasted page is read. Links printed in the
    // body become the listing URLs, which is what a text alert carries.
    const { parseBulk } = await import('../src/lib/bulkPaste.mjs');
    const text = raw.toString('utf8');
    const { drafts, note } = parseBulk(text, [], []);
    console.log(`\n${file} — read as plain text.\n${note}.\n`);
    for (const d of drafts) {
      console.log(`  ${d.titleRaw || '(no title)'}`);
      console.log(`     ${d.price ?? '?'} ${d.currency ?? ''}   ${d.sizeRaw ? `size ${d.sizeRaw}` : ''}`);
      console.log(`     ${d.url ?? 'NO LINK — this row could not be reopened'}`);
      console.log('');
    }
    if (!drafts.length) {
      console.log(`  Nothing in it parsed as a listing, and there was no HTML to fall back
  on. A plain-text copy loses the links, so if the message had any, save it as
  HTML instead: in most clients, print to PDF is not it — use "show original",
  "view source", or forward it to yourself and download the .eml.\n`);
    }
    process.exit(drafts.length ? 0 : 1);
  }

  const { drafts, note } = parseAlertEmail(html, []);
  console.log(`\n${parsed?.subject ?? file}\n${note}.\n`);
  for (const d of drafts) {
    console.log(`  ${d.titleRaw || '(no title)'}`);
    console.log(`     ${d.price ?? '?'} ${d.currency ?? ''}   ${d.sizeRaw ? `size ${d.sizeRaw}` : ''}`);
    console.log(`     ${d.url ?? 'NO LINK — this row could not be reopened'}`);
    if (d.imageUrl) console.log(`     ${d.imageUrl}`);
    for (const w of d.warnings) console.log(`     ! ${w}`);
    console.log('');
  }
  if (!drafts.length) {
    // What the parser SAW, rather than a request for help from the one person
    // who cannot give it. Each number below distinguishes a different failure,
    // and between them they say which.
    const { diagnoseEmail } = await import('../src/lib/alertEmail.mjs');
    const d = diagnoseEmail(html);

    console.log(`  Nothing parsed as a listing. What the parser found in it:\n`);
    console.log(`    ${String(d.lines).padStart(5)} lines of text`);
    console.log(`    ${String(d.urls).padStart(5)} distinct links, of which ${d.listingUrls} could be listings`);
    console.log(`    ${String(d.moneyLines).padStart(5)} lines that look like a price`);
    console.log(`    ${String(d.images).padStart(5)} images attached to a link\n`);

    if (!d.urls) {
      console.log(`  No links at all. Either the HTML part was stripped on the way here, or
  this is the plain-text alternative of the message rather than the HTML one.
  Save it again with "show original" / "view source".`);
    } else if (!d.listingUrls) {
      console.log(`  Links, but every one of them is a tracking, unsubscribe or navigation
  URL. If this sender wraps its listing links in a redirector this does not
  recognise, that is the one thing worth telling me — the sample above is
  enough to add it.`);
    } else if (!d.moneyLines) {
      console.log(`  Links to listings, but no prices anywhere in the text. Some senders put
  the price in the IMAGE of the card, and nothing here reads pixels. Those
  alerts cannot be parsed; the links are still real, so pasting the search
  page itself is the route for that sender.`);
    } else {
      console.log(`  Prices and listing links are both present, so the layout is one this does
  not yet group correctly — it assumes a listing's brand, name and price sit
  under ONE anchor. Worth showing me this message.`);
    }

    if (d.sampleUrls.length) {
      console.log(`\n  First links seen:`);
      for (const u of d.sampleUrls) console.log(`    ${u.slice(0, 100)}`);
    }
    if (d.sampleLines.length) {
      console.log(`\n  First lines seen:`);
      for (const l of d.sampleLines) console.log(`    ${l.slice(0, 80)}`);
    }
    console.log('');
  }
  process.exit(drafts.length ? 0 : 1);
}

const host = process.env.MAILBOX_HOST;
const user = process.env.MAILBOX_USER;
const pass = process.env.MAILBOX_PASSWORD;
const port = Number(process.env.MAILBOX_PORT ?? 993);
const folder = flag('folder', process.env.MAILBOX_FOLDER ?? 'INBOX');
const appUrl = (process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const token = process.env.CAPTURE_TOKEN;
const limit = Number(flag('limit', '50'));

if (!host || !user || !pass) {
  console.error(`
Usage: npm run mailbox

Set these in .env.local first:

  MAILBOX_HOST=imap.example.com     your provider's IMAP host
  MAILBOX_USER=alerts@example.com
  MAILBOX_PASSWORD=...              an app password, not your real one
  MAILBOX_FOLDER=INBOX              optional, if you filter alerts into a folder
  CAPTURE_TOKEN=...                 a long random string; the app needs the same one

Then turn on saved-search alerts on Grailed, Vestiaire and The RealReal and
point them here. Nothing in this script contacts those sites — it reads the
mail they send you.
`);
  process.exit(1);
}

if (!token || token.length < 16) {
  console.error('CAPTURE_TOKEN is not set (or is too short). The app refuses captures without it.');
  process.exit(1);
}

const client = new ImapFlow({
  host,
  port,
  secure: true,
  auth: { user, pass },
  logger: false,
});

let recorded = 0;
let skipped = 0;
let messages = 0;

await client.connect();
const lock = await client.getMailboxLock(folder);

try {
  // Unread only, which is what makes this safe to run on a timer: an alert
  // read once is not read again, so a listing cannot be recorded twice from
  // the same message however often this runs.
  const unseen = await client.search({ seen: false });
  const wanted = unseen.slice(-limit);

  if (!wanted.length) {
    console.log(`\nNothing unread in ${folder}.\n`);
  }

  for await (const message of client.fetch(wanted, { source: true, envelope: true })) {
    messages++;
    const parsed = await simpleParser(message.source);
    const subject = parsed.subject ?? '(no subject)';
    const from = parsed.from?.value?.[0]?.address ?? 'unknown';

    if (!parsed.html) {
      console.log(`  --  ${subject} — no HTML part, skipped`);
      skipped++;
      continue;
    }

    const res = await fetch(`${appUrl}/api/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 'email', html: parsed.html, dryRun }),
    }).catch((err) => ({ ok: false, statusText: String(err?.message ?? err) }));

    if (!res.ok) {
      // Left unread deliberately: a message this failed on should be tried
      // again next run, not silently lost because the app was down.
      console.log(`  --  ${subject} — capture failed (${res.status ?? ''} ${res.statusText})`);
      skipped++;
      continue;
    }

    const body = await res.json();
    const count = dryRun ? body.drafts?.length ?? 0 : body.saved ?? 0;
    recorded += count;
    console.log(`  ok  ${subject}  (${from}) — ${count} listing${count === 1 ? '' : 's'}`);
    if (dryRun && body.drafts?.length) {
      for (const d of body.drafts.slice(0, 5)) {
        console.log(`        ${d.titleRaw} — ${d.price ?? '?'} ${d.currency ?? ''}  ${d.url ?? ''}`);
      }
    }

    // Marked read only after it was recorded, and never in a dry run.
    if (!dryRun) await client.messageFlagsAdd(message.seq, ['\\Seen'], { uid: false });
  }
} finally {
  lock.release();
  await client.logout();
}

console.log(
  `\n${messages} message${messages === 1 ? '' : 's'} read, ` +
    `${recorded} listing${recorded === 1 ? '' : 's'} ${dryRun ? 'found (dry run — nothing saved)' : 'recorded'}` +
    `${skipped ? `, ${skipped} skipped` : ''}.\n`,
);
