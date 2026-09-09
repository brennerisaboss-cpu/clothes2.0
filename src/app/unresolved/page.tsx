import ResolvePanel from '@/components/ResolvePanel';
import type { Suggestion } from '@/components/ResolvePanel';
import RunMatching from '@/components/RunMatching';
import AcceptSuggestions from '@/components/AcceptSuggestions';
import ClusterPanel from '@/components/ClusterPanel';
import type { Cluster } from '@/components/ClusterPanel';
import { SectionHead } from '@/components/Plate';
import { listCards, facets } from '@/lib/queries';
import { suggestionsFor, clustersFor } from '@/app/actions';
import { PageHead } from '@/components/Plate';

export const dynamic = 'force-dynamic';

export default async function UnresolvedPage() {
  const [cards, f] = await Promise.all([
    listCards({ needsResolution: true, sort: 'newest' }),
    facets(),
  ]);

  // Scored on the server, in one pass over the items held for these houses,
  // rather than per panel: a paste of a hundred rows would otherwise be a
  // hundred round trips to score against the same list.
  const suggestions = (await suggestionsFor(
    cards.map((c) => ({
      id: c.id,
      title_raw: c.title_raw,
      // The house as the source stated it, separately from the title. A feed
      // puts it there rather than in the title, so leaving it out left the
      // matchmaker unable to see a house at all on exactly the rows this screen
      // exists for — and its first refusal is that the house is unidentified.
      brand_raw: c.brand_raw,
      brand_id: c.brand_id ?? null,
      subline_id: c.subline_id,
    })),
  )) as Record<string, Suggestion[]>;

  const proposed = Object.values(suggestions).filter((s) => s.length).length;

  // The best proposal for each listing, where it is strong enough to take in
  // bulk. Weaker ones stay one at a time, on their own row, with their reasons.
  // Listings with no suggestion have nothing existing to be matched against,
  // so they are compared with each other instead — the case a fresh paste is
  // almost entirely made of.
  const stranded = cards.filter((c) => !(suggestions[c.id] ?? []).length);
  const clusters = (await clustersFor(
    stranded.map((c) => ({
      id: c.id,
      title_raw: c.title_raw,
      brand_raw: c.brand_raw,
      brand_id: c.brand_id ?? null,
      subline_id: c.subline_id,
    })),
  )) as { members: { id: string }[] }[];

  // Enough of each member to show a row without a second query.
  const byId = new Map(cards.map((c) => [c.id, c]));
  const grouped: Cluster[] = clusters.map((g) => ({
    ...(g as unknown as Cluster),
    members: g.members.map((m) => {
      const card = byId.get(m.id);
      return {
        id: m.id,
        title_raw: card?.title_raw ?? '',
        source_name: card?.source_name ?? '',
        price: card?.price ?? 0,
        currency: card?.currency ?? '',
      };
    }),
  }));
  const inAGroup = new Set(grouped.flatMap((g) => g.members.map((m) => m.id)));

  // `safe`, not `tier === 'strong'`.
  //
  // The bar this screen is meant to apply is "nothing was assumed" — a strong
  // tier alone can still rest on an assumption, and those are exactly the ones
  // worth a person's eye. The action re-derives this for itself and refuses
  // anything that does not clear it, so this list is now a convenience rather
  // than the enforcement; it should still ask for the same thing, or the
  // button would offer rows the server will reject.
  const strong = Object.entries(suggestions)
    .map(([listingId, list]) => ({ listingId, best: list[0] }))
    .filter(({ best }) => best && best.safe)
    .map(({ listingId, best }) => ({ listingId, itemId: best.itemId }));

  return (
    <div className="space-y-5">
      <PageHead
        title="Unresolved"
        annot={
          cards.length
            ? `${cards.length} listing${cards.length === 1 ? '' : 's'} ${cards.length === 1 ? 'pools' : 'pool'} with nothing and cannot be scored` +
              (proposed ? ` · ${proposed} have a suggested match` : '')
            : undefined
        }
        right={
          <span className="flex flex-wrap items-center gap-2">
            <AcceptSuggestions pairs={strong} />
            <RunMatching />
          </span>
        }
      />

      {grouped.length ? (
        <section>
          <SectionHead
            title="These look like each other"
            annot="Nothing existing matches them, so they were compared with one another. One sub-line settles the whole group."
          />
          <div className="space-y-3">
            {grouped.map((g) => (
              <ClusterPanel key={g.members[0].id} cluster={g} sublines={f.sublines} />
            ))}
          </div>
        </section>
      ) : null}

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge p-12 text-center text-sm text-muted">
          Nothing unresolved.
        </div>
      ) : (
        <div className="space-y-3">
          {cards.filter((c) => !inAGroup.has(c.id)).map((c) => (
            <ResolvePanel
              key={c.id}
              listing={{
                id: c.id,
                title_raw: c.title_raw,
                image_url: c.image_url,
                url: c.url,
                subline_id: c.subline_id,
                price: c.price,
                currency: c.currency,
                source_name: c.source_name,
              }}
              sublines={f.sublines}
              suggestions={suggestions[c.id] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
