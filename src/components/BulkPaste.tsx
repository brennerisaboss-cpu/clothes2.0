'use client';

import { useRef, useState, useTransition } from 'react';
import { parsePaste, saveDrafts } from '@/app/actions';
import { walkPastedHtml, shouldTakeOver } from '@/lib/pastedHtml.mjs';
import { looksLikePastedPage } from '@/lib/pastedPage.mjs';
import type { PastedLink } from '@/lib/bulkPaste.mjs';

type Draft = {
  titleRaw: string;
  brandRaw: string | null;
  sourceId: string;
  sourceItemId: string | null;
  url: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  sizeRaw: string | null;
  conditionRaw: string | null;
  sublineId: string | null;
  adYear: number | null;
  needsManualResolution: boolean;
  monitored: boolean;
  warnings: string[];
};

export default function BulkPaste({
  sublines,
  sources,
}: {
  sublines: { id: string; display_name: string }[];
  sources: { id: string; display_name: string }[];
}) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<string | null>(null);
  // Which venue the whole paste came from.
  //
  // Every row carries its own source, which is right for a mixed paste of
  // notes — but a copied page is one venue by definition, and setting fifty
  // dropdowns by hand is not a workflow. It matters more than it looks: a
  // Grailed page landing on "Other (manual)" would be filed as somewhere you
  // BUY, so it could never serve as a comp — which is the entire reason to
  // collect Grailed.
  const [batchSource, setBatchSource] = useState('');
  const [pending, startTransition] = useTransition();

  // What the clipboard's HTML knew, and the exact text it went with.
  //
  // A textarea receives only the plain-text flavour of a paste, so the links
  // were being dropped on the floor — and a listing you cannot reopen is
  // nearly useless when a hundred of them arrive at once. The HTML flavour is
  // sitting right there on the same clipboard with the anchors intact and the
  // URLs already absolute.
  //
  // The text is kept beside the links so an edited textarea falls back to the
  // plain path rather than pairing a row with somebody else's link — the two
  // are aligned by index, and only exact text can promise that.
  const links = useRef<{ text: string; links: PastedLink[] }>({ text: '', links: [] });

  // What the last paste actually carried.
  //
  // Kept and shown because the first version of this failed SILENTLY: when the
  // walk found no links it returned nothing, the paste fell back to plain text,
  // and the screen looked exactly as it does when everything worked. "Still not
  // fixed" is the only possible report from that, and it is not a useful one
  // for either of us. Now the paste says what it got, and hands over the
  // clipboard itself when it got nothing.
  const [diagnosis, setDiagnosis] = useState<{
    why: string | null;
    anchors: number;
    links: number;
    sample: string;
  } | null>(null);

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    if (!html) {
      setDiagnosis({
        why: 'your browser put no HTML on the clipboard, only plain text — that happens ' +
          'when copying from a text editor, a terminal or a PDF rather than from the page',
        anchors: 0,
        links: 0,
        sample: '',
      });
      return;
    }

    const walked = walkPastedHtml(html);
    const nativeText = e.clipboardData.getData('text/plain');
    const decision = shouldTakeOver(walked, nativeText, looksLikePastedPage);

    setDiagnosis({
      why: walked.why ?? (decision.takeOver ? null : decision.why),
      anchors: walked.anchors ?? 0,
      links: decision.takeOver ? walked.links.length : 0,
      // Enough of it to see how the page is built, and no more. This is what
      // to send me if a site still comes through without links.
      sample: html.slice(0, 4000),
    });

    // Everything that is not a copied listing page pastes natively. An alert
    // email and a spreadsheet row are both still supported inputs, and both are
    // parsed from the browser's own plain text — re-laying them out by DOM
    // block rules would change how they read for no gain.
    if (!decision.takeOver) return;

    // Taking over the paste is what keeps the indexes honest: the textarea gets
    // the text this walk produced, not the browser's own flattening of it.
    e.preventDefault();
    const next = walked.lines.join('\n');
    setText(next);
    links.current = { text: next, links: walked.links };
  };

  const parse = () =>
    startTransition(async () => {
      const carried = links.current.text === text ? links.current.links : [];
      const parsed = await parsePaste(text, carried);
      const rows = parsed.drafts as Draft[];
      setDrafts(batchSource ? rows.map((d) => ({ ...d, sourceId: batchSource })) : rows);
      setNote(parsed.note);
      setResult(null);
    });

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const commit = () =>
    startTransition(async () => {
      const ready = drafts.filter((d) => d.titleRaw && d.price != null && d.currency);
      const res = await saveDrafts(
        ready.map((d) => ({
          title: d.titleRaw,
          brandRaw: d.brandRaw ?? undefined,
          sourceId: d.sourceId,
          sourceItemId: d.sourceItemId ?? undefined,
          url: d.url ?? undefined,
          imageUrl: d.imageUrl ?? undefined,
          price: d.price!,
          currency: d.currency!,
          sizeRaw: d.sizeRaw ?? undefined,
          conditionRaw: d.conditionRaw ?? undefined,
          sublineId: d.sublineId ?? undefined,
          adYear: d.adYear ?? undefined,
        })),
      );
      const skipped = drafts.length - ready.length;
      setResult(
        `Saved ${res.saved}.${skipped ? ` ${skipped} skipped for missing price or currency.` : ''}${
          res.failed.length ? ` ${res.failed.length} failed.` : ''
        }`,
      );
      setDrafts([]);
      setText('');
    });

  return (
    <div className="space-y-4">
      <textarea
        className="field min-h-[130px] font-mono text-xs"
        placeholder={`Comme des Garcons Homme Plus wool jacket AD2002\n¥48,000\nhttps://www.grailed.com/listings/111-cdg-hp\n\nJunya Watanabe MAN denim\n€320.00`}
        value={text}
        onPaste={onPaste}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        {/* Asked before parsing, not after: it decides whether these listings
            are things you could buy or evidence of what things sell for, and
            that is not a per-row question when a whole page came from one
            venue. */}
        <label className="flex items-center gap-2 text-[12px] uppercase tracking-[0.08em] text-muted">
          These came from
          <select
            className="field w-auto py-1 text-[13px] normal-case tracking-normal"
            value={batchSource}
            onChange={(e) => {
              setBatchSource(e.target.value);
              if (e.target.value) {
                setDrafts((d) => d.map((row) => ({ ...row, sourceId: e.target.value })));
              }
            }}
          >
            <option value="">— per row —</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.display_name}</option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={parse} disabled={pending || !text.trim()}>
          Parse into drafts
        </button>
        {note ? <span className="text-xs text-muted">{note}</span> : null}
        {result ? <span className="text-xs text-ok">{result}</span> : null}
      </div>

      {diagnosis && (diagnosis.why || !diagnosis.links) ? (
        <div className="border-l-4 border-warn bg-panel px-4 py-3 text-[13px]">
          <p className="text-warn">
            This paste carried no links back to the listings.
          </p>
          <p className="mt-1 text-muted">
            {diagnosis.why ??
              `The copied HTML had ${diagnosis.anchors} link${diagnosis.anchors === 1 ? '' : 's'} in it, but none could be tied to a listing.`}
          </p>
          <p className="mt-1 text-muted">
            The rows still parse and still save — they just cannot be reopened afterwards.
          </p>
          {diagnosis.sample ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] uppercase tracking-[0.08em] text-muted">
                What the clipboard actually contained
              </summary>
              {/* So a site that still comes through without links can be fixed
                  from evidence rather than from guesswork about its markup. */}
              <p className="mt-1 text-[12px] text-muted">
                The first few thousand characters, which show how the page builds a card.
                Copy this if you want the site supported.
              </p>
              <textarea
                readOnly
                className="field mt-1 min-h-[120px] font-mono text-[11px]"
                value={diagnosis.sample}
                onFocus={(e) => e.currentTarget.select()}
              />
            </details>
          ) : null}
        </div>
      ) : null}

      {drafts.length ? (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="p-2 font-medium w-14"></th>
                <th className="p-2 font-medium">Title</th>
                <th className="p-2 font-medium">Price</th>
                <th className="p-2 font-medium">Cur</th>
                <th className="p-2 font-medium">Source</th>
                <th className="p-2 font-medium">Sub-line</th>
                <th className="p-2 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={i} className="border-t border-edge align-top">
                  {/* The picture, where the paste carried one. It is hotlinked
                      from the site it came from, so it may not load; the link
                      beside it is the part that matters and does not depend on
                      it. */}
                  <td className="p-2 w-14">
                    {d.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.imageUrl}
                        alt=""
                        className="h-12 w-12 border border-edge object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                        }}
                      />
                    ) : (
                      <div className="h-12 w-12 border border-dashed border-edge" />
                    )}
                  </td>
                  <td className="p-2">
                    <input
                      className="field"
                      value={d.titleRaw}
                      onChange={(e) => update(i, { titleRaw: e.target.value })}
                    />
                    {/* Confirming a row means looking at the listing. Without
                        this you would be checking a title against a memory of a
                        page you scrolled past an hour ago. */}
                    {d.url ? (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 block truncate text-[11px] text-accent underline"
                      >
                        open the listing ↗
                      </a>
                    ) : (
                      <span className="mt-1 block text-[11px] text-warn">
                        no link — paste again with the page selected, not the text
                      </span>
                    )}
                  </td>
                  <td className="p-2 w-28">
                    <input
                      className="field"
                      value={d.price ?? ''}
                      onChange={(e) =>
                        update(i, { price: e.target.value === '' ? null : Number(e.target.value) })
                      }
                    />
                  </td>
                  <td className="p-2 w-20">
                    <input
                      className="field uppercase"
                      maxLength={3}
                      value={d.currency ?? ''}
                      onChange={(e) => update(i, { currency: e.target.value.toUpperCase() })}
                    />
                  </td>
                  <td className="p-2 w-40">
                    <select
                      className="field"
                      value={d.sourceId}
                      onChange={(e) => update(i, { sourceId: e.target.value })}
                    >
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.display_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 w-56">
                    <select
                      className="field"
                      value={d.sublineId ?? ''}
                      onChange={(e) => update(i, { sublineId: e.target.value || null })}
                    >
                      <option value="">— unresolved —</option>
                      {sublines.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.display_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 w-64">
                    {d.warnings.length ? (
                      <ul className="space-y-1">
                        {d.warnings.map((w, j) => (
                          <li key={j} className="text-[11px] leading-snug text-warn">
                            {w}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-[11px] text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {drafts.length ? (
        <button className="btn btn-primary" onClick={commit} disabled={pending}>
          Confirm and save {drafts.length} draft{drafts.length === 1 ? '' : 's'}
        </button>
      ) : null}
    </div>
  );
}
