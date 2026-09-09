import { fxHealth } from '@/lib/fx';

/**
 * The one warning that belongs above every page.
 *
 * A wrong exchange rate does not break a page or empty a table — it shifts
 * every margin in the platform by a few per cent in the same direction, which
 * is the same size as the edge being hunted. It has to be visible while it is
 * true, and invisible the rest of the time.
 */
export default async function FxBanner() {
  let health;
  try {
    health = await fxHealth();
  } catch {
    return null; // No database yet; the setup path must stay reachable.
  }
  if (health.healthy) return null;

  const notes: string[] = [];
  if (health.placeholders.length) {
    notes.push(
      `${health.placeholders.map((r) => r.base).join(', ')} still on seed placeholders`,
    );
  }
  if (health.stale.length) {
    const worst = Math.max(...health.stale.map((r) => r.ageDays));
    notes.push(
      `${health.stale.map((r) => r.base).join(', ')} last fixed ${Math.floor(worst)} days ago`,
    );
  }
  if (health.uncovered.length) {
    notes.push(`no rate at all for ${health.uncovered.join(', ')}`);
  }

  return (
    <div className="mb-4 border-l-4 border-accent bg-panel px-4 py-3 text-sm">
      <span className="font-semibold uppercase tracking-[0.1em]">
        Rates into {health.base} are not current
      </span>
      <span className="annot ml-2 text-muted">
        {notes.join('; ')} — margins are unreliable until <code className="not-italic">npm run fx</code> succeeds.
      </span>
    </div>
  );
}
