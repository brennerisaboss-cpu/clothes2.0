import Link from 'next/link';
import AddForm from '@/components/AddForm';
import BulkPaste from '@/components/BulkPaste';
import { facets, conditionLabels } from '@/lib/queries';
import { PageHead, SectionHead } from '@/components/Plate';

export const dynamic = 'force-dynamic';

/**
 * The bookmarklet, built around your own token.
 *
 * It sends the selection if there is one and the whole page otherwise, and
 * reports what came back. Everything else — the walk, the parsing, the venue —
 * happens on the server, so this stays one line and cannot fall out of step
 * with the parser.
 */
function bookmarklet(appUrl: string, token: string) {
  const action = `${appUrl.replace(/\/$/, '')}/capture`;
  // A form POST into a new tab, not a background fetch: Chrome refuses to let a
  // page on a public HTTPS origin call 127.0.0.1 in the background at all, and
  // refuses it by hanging rather than by failing. Submitting a form is a
  // navigation, which is not subject to that — and it means you SEE what was
  // captured instead of trusting an alert.
  return (
    `javascript:(()=>{const s=getSelection();` +
    `const h=s&&s.rangeCount&&!s.isCollapsed?(()=>{const d=document.createElement('div');` +
    `for(let i=0;i<s.rangeCount;i++)d.appendChild(s.getRangeAt(i).cloneContents());return d.innerHTML})()` +
    `:document.body.innerHTML;` +
    `const f=document.createElement('form');f.method='POST';f.action='${action}';f.target='_blank';` +
    `const add=(n,v)=>{const i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i)};` +
    `add('html',h);add('baseUrl',location.href);add('token','${token}');` +
    `document.body.appendChild(f);f.submit();f.remove()})()`
  );
}

export default async function AddPage() {
  const { sublines, sources } = await facets();
  const conditionsBySource: Record<string, { raw_label: string; tier: string }[]> = {};
  await Promise.all(
    sources.map(async (s) => {
      conditionsBySource[s.id] = await conditionLabels(s.id);
    }),
  );

  return (
    <div className="space-y-8">
      <PageHead
        title="Add listings"
        right={<Link href="/" className="btn">Back to grid</Link>}
      />

      {/* Pasting a page comes FIRST, and one entry at a time comes second.
          It was the other way round, under a heading that said "Bulk paste" —
          which describes the mechanism and not the reason, so the one route
          into the venues that publish nothing sat below the fold on a page
          nobody had a reason to scroll. The order here is the order of use. */}
      <section>
        <SectionHead
          title="Paste a page"
          no="I"
          annot="The way into The RealReal, Grailed and Vestiaire, which publish no feed."
        />
        <div className="mb-4 border-l-4 border-fg bg-panel px-4 py-3 text-sm">
          Open a search result on any site, select all, copy, and paste it below. A whole
          page arrives as drafts — brand, price, currency, size, the picture and a link
          back to each listing — to confirm before anything is saved.
          <span className="annot mt-1 block text-[13px] text-muted">
            Copy from the page itself, not from a text file: the clipboard carries the links
            alongside the text, and they are what let you reopen a piece afterwards. Nothing
            is fetched and nothing is crawled — it is writing the listings down at the speed
            of a keystroke. Alert emails and spreadsheet rows paste here too.
          </span>
        </div>
        <BulkPaste sublines={sublines} sources={sources} />
      </section>

      {/* The same capture, two steps shorter. Shown as source to copy rather
          than a link to drag, because React refuses to render a javascript:
          href — and a bookmarklet is exactly that. */}
      {process.env.CAPTURE_TOKEN ? (
        <section className="border-t border-edge pt-8">
          <SectionHead
            title="Capture from the page"
            no="II"
            annot="A bookmark that records what you are looking at, without the copy and paste."
          />
          <p className="mb-2 text-sm">
            Make a new bookmark, call it <strong>Capture</strong>, and paste this as its
            address. Then click it while looking at a search page or a listing.
          </p>
          <textarea
            readOnly
            className="field min-h-[90px] font-mono text-[11px]"
            value={bookmarklet(process.env.APP_URL ?? 'http://127.0.0.1:3000', process.env.CAPTURE_TOKEN)}
          />
          <p className="annot mt-1 text-[13px] text-muted">
            It sends the markup of the page you are on to this app and nothing else. Same
            act as the paste above — you, looking at something, deciding to keep it —
            with the select-all, copy, switch-tab and paste taken out.
          </p>
        </section>
      ) : null}

      <section className="border-t border-edge pt-8">
        <SectionHead
          title="One at a time"
          no="III"
          annot="For a single piece — paste its URL and what the link encodes is filled in."
        />
        <AddForm sublines={sublines} sources={sources} conditionsBySource={conditionsBySource} />
      </section>
    </div>
  );
}
