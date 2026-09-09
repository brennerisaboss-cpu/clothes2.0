'use client';

import { useId, useMemo, useState } from 'react';

// Categorical slots 1-3 from the validated light palette, re-checked against
// this app's cream chart surface (#f7f4ea) with `--pairs all`: lightness,
// chroma, CVD separation (worst ΔE 9.2) and normal-vision separation (worst
// ΔE 24.0) all pass. Two slots sit below 3:1 against cream, which triggers the
// relief rule — satisfied here by the shape encoding, the direct legend, and
// the snapshot table beneath the chart.
//
// Evidence class is encoded by marker shape as well as colour, so identity
// never rests on colour alone.
const SERIES = {
  confirmed_sale: { color: '#2a78d6', label: 'Confirmed sale', shape: 'square' },
  active_ask: { color: '#1baf7a', label: 'Active ask', shape: 'circle' },
  inferred_disappearance: { color: '#eb6834', label: 'Inferred', shape: 'triangle' },
} as const;

// Chart chrome, matched to the paper palette.
const SURFACE = '#f7f4ea';
const GRID = '#cfc8b5';
const AXIS_TEXT = '#5f5a4b';
const RULE = '#16150f';

type Point = {
  id: string;
  date: string | Date;
  value: number;
  evidence: keyof typeof SERIES;
  tier: string | null;
  source: string;
  chainId: string;
  /** Which side of the trade this observation is. Exit prices set the
   *  valuation; acquisition prices are what you would pay. Plotting them
   *  identically next to an exit-only median line reads as a contradiction,
   *  so they are drawn hollow. */
  role?: 'exit' | 'acquisition' | 'both';
};

const PAD = { top: 16, right: 16, bottom: 30, left: 52 };

function Marker({
  x, y, kind, color, hollow = false,
}: { x: number; y: number; kind: string; color: string; hollow?: boolean }) {
  // Filled = exit market (what it sells for). Hollow = acquisition (what it
  // costs). A 2px ring keeps overlapping marks separable either way.
  const common = hollow
    ? { fill: SURFACE, stroke: color, strokeWidth: 2.5 }
    : { fill: color, stroke: SURFACE, strokeWidth: 2 };
  if (kind === 'square') return <rect x={x - 5} y={y - 5} width={10} height={10} {...common} />;
  if (kind === 'triangle')
    return <polygon points={`${x},${y - 6} ${x + 6},${y + 5} ${x - 6},${y + 5}`} {...common} />;
  return <circle cx={x} cy={y} r={5.5} {...common} />;
}

export default function PriceHistoryChart({
  points,
  median,
  currencyLabel = 'EUR',
  height = 260,
}: {
  points: Point[];
  median?: number | null;
  currencyLabel?: string;
  height?: number;
}) {
  const clipId = useId();
  const [hover, setHover] = useState<{ p: Point; x: number; y: number } | null>(null);
  const width = 720;

  const model = useMemo(() => {
    const parsed = points
      .map((p) => ({ ...p, t: new Date(p.date).getTime() }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value))
      .sort((a, b) => a.t - b.t);
    if (!parsed.length) return null;

    const times = parsed.map((p) => p.t);
    const values = parsed.map((p) => p.value);
    let tMin = Math.min(...times);
    let tMax = Math.max(...times);
    // A single observation, or several on one day, would collapse the x-scale.
    if (tMax - tMin < 86_400_000) {
      tMin -= 43_200_000;
      tMax += 43_200_000;
    }
    const vMax = Math.max(...values, median ?? 0) * 1.12;
    // Bars and prices are read against zero, so the value axis starts there.
    const vMin = 0;

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    // Inset the time axis by a marker's width so the first and last
    // observations sit fully inside the plot instead of being clipped in half
    // by the plot boundary.
    const inset = 12;
    const sx = (t: number) =>
      PAD.left + inset + ((t - tMin) / (tMax - tMin)) * (plotW - inset * 2);
    const sy = (v: number) => PAD.top + plotH - ((v - vMin) / (vMax - vMin)) * plotH;

    // Connect observations only within one listing's own snapshot chain. Two
    // separate listings are not a trend line, and drawing one would imply a
    // continuity that does not exist.
    const chains = new Map<string, typeof parsed>();
    for (const p of parsed) {
      if (!chains.has(p.chainId)) chains.set(p.chainId, []);
      chains.get(p.chainId)!.push(p);
    }

    const ticks = 4;
    const yTicks = Array.from({ length: ticks + 1 }, (_, i) => vMin + ((vMax - vMin) / ticks) * i);
    const xTicks = [tMin, (tMin + tMax) / 2, tMax];

    return { parsed, sx, sy, chains: [...chains.values()].filter((c) => c.length > 1), yTicks, xTicks, plotH };
  }, [points, median, height]);

  if (!model) {
    return (
      <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">
        No priced observations yet.
      </div>
    );
  }

  const { sx, sy, parsed, chains, yTicks, xTicks } = model;
  const present = [...new Set(parsed.map((p) => p.evidence))];
  const roles = new Set(parsed.map((p) => p.role ?? 'exit'));
  const hasBothRoles = roles.has('acquisition') && (roles.has('exit') || roles.has('both'));
  const fmt = (v: number) =>
    new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(v);
  const fmtDate = (t: number) => new Date(t).toISOString().slice(0, 10);

  return (
    <figure className="m-0">
      <div className="relative overflow-x-auto rounded-xl border border-edge bg-ink p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[560px]"
          role="img"
          aria-label={`Price history, ${parsed.length} observations in ${currencyLabel}`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD.left} y={PAD.top} width={width - PAD.left - PAD.right} height={model.plotH} />
            </clipPath>
          </defs>

          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={sy(v)}
                y2={sy(v)}
                stroke={GRID}
                strokeWidth={1}
              />
              <text x={PAD.left - 8} y={sy(v) + 4} textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                {fmt(v)}
              </text>
            </g>
          ))}

          {xTicks.map((t, i) => (
            <text
              key={i}
              x={sx(t)}
              y={height - 10}
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
              fontSize={11}
              fill={AXIS_TEXT}
            >
              {fmtDate(t)}
            </text>
          ))}

          {median != null ? (
            <g clipPath={`url(#${clipId})`}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={sy(median)}
                y2={sy(median)}
                stroke={RULE}
                strokeWidth={2}
                strokeDasharray="5 4"
                opacity={0.75}
              />
              <text x={width - PAD.right} y={sy(median) - 8} textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                exit median {fmt(median)}
              </text>
            </g>
          ) : null}

          <g clipPath={`url(#${clipId})`}>
            {chains.map((chain, i) => (
              <polyline
                key={i}
                points={chain.map((p) => `${sx(p.t)},${sy(p.value)}`).join(' ')}
                fill="none"
                stroke={GRID}
                strokeWidth={2}
                opacity={0.5}
              />
            ))}

            {parsed.map((p) => {
              const s = SERIES[p.evidence] ?? SERIES.inferred_disappearance;
              return (
                <g
                  key={p.id}
                  onMouseEnter={() => setHover({ p, x: sx(p.t), y: sy(p.value) })}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* Hit target larger than the mark. */}
                  <circle cx={sx(p.t)} cy={sy(p.value)} r={14} fill="transparent" />
                  <Marker
                    x={sx(p.t)}
                    y={sy(p.value)}
                    kind={s.shape}
                    color={s.color}
                    hollow={p.role === 'acquisition'}
                  />
                </g>
              );
            })}
          </g>
        </svg>

        {hover ? (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-edge bg-ink px-2 py-1.5 text-[11px] shadow-lg"
            style={{
              left: `calc(${(hover.x / width) * 100}% + 8px)`,
              top: `calc(${(hover.y / height) * 100}% - 8px)`,
            }}
          >
            <div className="font-medium text-fg">
              {currencyLabel} {fmt(hover.p.value)}
            </div>
            <div className="text-muted">{SERIES[hover.p.evidence]?.label ?? hover.p.evidence}</div>
            <div className="text-muted">
              {hover.p.source}
              {hover.p.tier ? ` · ${hover.p.tier.replace(/_/g, ' ')}` : ''}
            </div>
            <div className="text-muted">
              {hover.p.role === 'acquisition' ? 'where you buy' : 'where you sell'}
            </div>
            <div className="text-muted">{fmtDate(new Date(hover.p.date).getTime())}</div>
          </div>
        ) : null}
      </div>

      {present.length >= 1 ? (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {hasBothRoles ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <svg width={12} height={12} aria-hidden>
                  <Marker x={6} y={6} kind="circle" color="#1baf7a" />
                </svg>
                Exit market (sets the value)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg width={12} height={12} aria-hidden>
                  <Marker x={6} y={6} kind="circle" color="#1baf7a" hollow />
                </svg>
                Acquisition (what you pay)
              </span>
            </>
          ) : null}
          {present.length >= 2 ? present.map((e) => {
            const s = SERIES[e] ?? SERIES.inferred_disappearance;
            return (
              <span key={e} className="inline-flex items-center gap-1.5">
                <svg width={12} height={12} aria-hidden>
                  <Marker x={6} y={6} kind={s.shape} color={s.color} />
                </svg>
                {s.label}
              </span>
            );
          }) : null}
          <span className="text-muted/70">Lines connect snapshots of one listing.</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
