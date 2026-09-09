'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { prefill, saveListing, type SaveInput } from '@/app/actions';

type Subline = { id: string; display_name: string; monitored: boolean; ambiguous: boolean };
type Source = { id: string; display_name: string; tier: string };

const EMPTY = {
  url: '',
  title: '',
  brandRaw: '',
  sourceId: 'manual_other',
  sourceItemId: '',
  price: '',
  currency: '',
  sizeRaw: '',
  sizeRegion: 'UNKNOWN',
  conditionRaw: '',
  conditionTier: '',
  imageUrl: '',
  adYear: '',
  sublineId: '',
  notes: '',
};

type Resolution = {
  sublineId: string | null;
  ambiguous: boolean;
  monitored: boolean;
  reason: string;
  adYear: number | null;
} | null;

export default function AddForm({
  sublines,
  sources,
  conditionsBySource,
}: {
  sublines: Subline[];
  sources: Source[];
  conditionsBySource: Record<string, { raw_label: string; tier: string }[]>;
}) {
  const [form, setForm] = useState({ ...EMPTY });
  const [resolution, setResolution] = useState<Resolution>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [recent, setRecent] = useState<{ title: string; price: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const urlRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Currency is the field most likely to repeat across a run of entries, so it
  // is remembered between saves. Everything else resets.
  useEffect(() => {
    const saved = localStorage.getItem('lastCurrency');
    if (saved) setForm((f) => ({ ...f, currency: saved }));
    urlRef.current?.focus();
  }, []);

  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  // Resolve the sub-line as you type so a mis-typed brand is visible before
  // saving, not after.
  useEffect(() => {
    const text = `${form.brandRaw} ${form.title}`.trim();
    if (!text) {
      setResolution(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { resolveBrand } = await import('@/lib/resolve.mjs');
      if (cancelled) return;
      const r = resolveBrand(text);
      setResolution({
        sublineId: r.sublineId,
        ambiguous: r.ambiguous,
        monitored: r.monitored,
        reason: r.reason,
        adYear: r.adYear,
      });
      if (r.adYear && !form.adYear) set({ adYear: String(r.adYear) });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.brandRaw, form.title]);

  const runPrefill = useCallback(async (url: string) => {
    if (!url.trim()) return;
    const result = await prefill(url);
    if (!result.ok) {
      setStatus({ kind: 'err', text: result.note });
      return;
    }
    set({
      url: result.url ?? url,
      sourceId: result.sourceId ?? 'manual_other',
      sourceItemId: result.fields?.sourceItemId ?? '',
      title: result.fields?.titleRaw ?? '',
      brandRaw: result.fields?.brandRaw ?? '',
    });
    setStatus({ kind: 'info', text: `${result.note}. Price, currency, size and condition are never derived from a URL — fill those in.` });
    titleRef.current?.focus();
  }, []);

  const submit = () => {
    if (pending) return;
    startTransition(async () => {
      const payload: SaveInput = { ...form };
      const result = await saveListing(payload);
      if (!result.ok) {
        setStatus({ kind: 'err', text: result.error });
        return;
      }
      localStorage.setItem('lastCurrency', form.currency);
      setRecent((r) => [{ title: form.title, price: `${form.price} ${form.currency}` }, ...r].slice(0, 6));
      const notes = [
        result.needsResolution ? 'sub-line unresolved — flagged for manual matching' : null,
        result.fxMissing ? 'no FX rate on file, base price left empty' : null,
      ].filter(Boolean);
      setStatus({
        kind: 'ok',
        text: `Saved.${notes.length ? ' ' + notes.join('; ') + '.' : ''}`,
      });
      setForm({ ...EMPTY, currency: form.currency, sourceId: form.sourceId });
      setResolution(null);
      urlRef.current?.focus();
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const conditions = conditionsBySource[form.sourceId] ?? [];
  const activeSubline = form.sublineId || resolution?.sublineId || '';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-xl border border-edge bg-ink p-5">
        <div className="mb-5">
          <label className="label" htmlFor="url">
            Paste listing URL
          </label>
          <input
            id="url"
            ref={urlRef}
            className="field font-mono text-xs"
            placeholder="https://www.grailed.com/listings/…"
            value={form.url}
            onChange={(e) => set({ url: e.target.value })}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              if (text) setTimeout(() => runPrefill(text), 0);
            }}
            onBlur={(e) => runPrefill(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <label className="label" htmlFor="title">
              Title <span className="text-alarm">*</span>
            </label>
            <input
              id="title"
              ref={titleRef}
              className="field"
              placeholder="Comme des Garçons Homme Plus AD2002 wool jacket"
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="price">
              Price <span className="text-alarm">*</span>
            </label>
            <input
              id="price"
              className="field"
              inputMode="decimal"
              placeholder="48000"
              value={form.price}
              onChange={(e) => set({ price: e.target.value })}
            />
          </div>
          <div className="sm:col-span-1">
            <label className="label" htmlFor="currency">
              Currency <span className="text-alarm">*</span>
            </label>
            <input
              id="currency"
              className="field uppercase"
              maxLength={3}
              placeholder="JPY"
              value={form.currency}
              onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="size">
              Size (as listed)
            </label>
            <input
              id="size"
              className="field"
              placeholder="M / 3 / 48"
              value={form.sizeRaw}
              onChange={(e) => set({ sizeRaw: e.target.value })}
            />
          </div>
          <div className="sm:col-span-1">
            <label className="label" htmlFor="region">
              Region
            </label>
            <select
              id="region"
              className="field"
              value={form.sizeRegion}
              onChange={(e) => set({ sizeRegion: e.target.value })}
            >
              {['UNKNOWN', 'JP', 'EU', 'US', 'UK', 'IT', 'FR', 'ALPHA'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="source">
              Source
            </label>
            <select
              id="source"
              className="field"
              value={form.sourceId}
              onChange={(e) => set({ sourceId: e.target.value, conditionRaw: '', conditionTier: '' })}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="conditionRaw">
              Condition (source wording)
            </label>
            <select
              id="conditionRaw"
              className="field"
              value={form.conditionRaw}
              onChange={(e) => {
                const match = conditions.find((c) => c.raw_label === e.target.value);
                set({ conditionRaw: e.target.value, conditionTier: match?.tier ?? '' });
              }}
            >
              <option value="">—</option>
              {conditions.map((c) => (
                <option key={c.raw_label} value={c.raw_label}>
                  {c.raw_label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="tier">
              Normalised tier
            </label>
            <select
              id="tier"
              className="field"
              value={form.conditionTier}
              onChange={(e) => set({ conditionTier: e.target.value })}
            >
              <option value="">—</option>
              {['new_with_tags', 'new', 'excellent', 'good', 'fair', 'damaged'].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <label className="label" htmlFor="subline">
              Sub-line{' '}
              {resolution?.sublineId && !form.sublineId ? (
                <span className="text-ok normal-case tracking-normal">auto-detected</span>
              ) : null}
            </label>
            <select
              id="subline"
              className="field"
              value={activeSubline}
              onChange={(e) => set({ sublineId: e.target.value })}
            >
              <option value="">— unresolved (flag for manual matching) —</option>
              {sublines.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                  {s.ambiguous ? ' (ambiguous)' : ''}
                  {!s.monitored ? ' (not monitored)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-1">
            <label className="label" htmlFor="adYear">
              AD year
            </label>
            <input
              id="adYear"
              className="field"
              inputMode="numeric"
              placeholder="2002"
              value={form.adYear}
              onChange={(e) => set({ adYear: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="image">
              Image URL
            </label>
            <input
              id="image"
              className="field font-mono text-xs"
              placeholder="https://…"
              value={form.imageUrl}
              onChange={(e) => set({ imageUrl: e.target.value })}
            />
          </div>

          <div className="sm:col-span-6">
            <label className="label" htmlFor="notes">
              Notes
            </label>
            <input
              id="notes"
              className="field"
              placeholder="Measurements, flaws, seller notes…"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button className="btn btn-primary" onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Save listing'}
          </button>
          <span className="text-xs text-muted">
            <kbd>⌘</kbd> <kbd>↵</kbd> to save and start the next one
          </span>
          <button
            className="btn ml-auto"
            onClick={() => {
              setForm({ ...EMPTY, currency: form.currency });
              setResolution(null);
              setStatus(null);
              urlRef.current?.focus();
            }}
          >
            Clear
          </button>
        </div>

        {status ? (
          <p
            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              status.kind === 'ok'
                ? 'border-ok bg-ok/10 text-ok'
                : status.kind === 'err'
                  ? 'border-alarm/40 bg-alarm/10 text-alarm'
                  : 'border-edge bg-ink text-muted'
            }`}
          >
            {status.text}
          </p>
        ) : null}
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-edge bg-ink p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Resolution</h2>
          {resolution ? (
            <div className="space-y-2 text-sm">
              <div
                className={
                  resolution.ambiguous
                    ? 'text-warn'
                    : resolution.sublineId
                      ? 'text-ok'
                      : 'text-muted'
                }
              >
                {resolution.sublineId
                  ? sublines.find((s) => s.id === resolution.sublineId)?.display_name
                  : 'No sub-line resolved'}
              </div>
              <p className="text-xs leading-relaxed text-muted">{resolution.reason}</p>
              {resolution.adYear ? (
                <p className="text-xs text-muted">
                  AD year <span className="text-fg">{resolution.adYear}</span> parsed from title
                </p>
              ) : null}
              {!resolution.monitored ? (
                <p className="text-xs text-warn">
                  This sub-line is excluded from monitoring. It will be saved and filtered, not
                  scored.
                </p>
              ) : null}
              {resolution.ambiguous ? (
                <p className="text-xs text-warn">
                  Ambiguous by name — pick the sub-line by hand rather than letting it auto-match.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted">Start typing a title to see the sub-line resolve.</p>
          )}
        </div>

        {recent.length ? (
          <div className="rounded-xl border border-edge bg-ink p-4">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">
              Added this session
            </h2>
            <ul className="space-y-1.5">
              {recent.map((r, i) => (
                <li key={i} className="truncate text-xs text-muted">
                  <span className="text-fg">{r.price}</span> · {r.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
