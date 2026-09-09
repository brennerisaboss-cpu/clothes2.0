-- Item identity, made explicit.
--
-- Until now an item was identified by its canonical_name, which was whichever
-- seller's title arrived first. That silently defeated the platform's whole
-- purpose: the same garment listed on two marketplaces never shares a title,
-- so it produced two items, each with a comp set of one, and nothing could be
-- valued against anything.
--
-- Identity is now the four things that can be proven from controlled
-- vocabularies — sub-line, AD year, garment type, dominant material — computed
-- in src/lib/garment.mjs and written here as a single key. Two listings pool
-- when and only when their keys are equal.
--
-- The uniqueness constraint is the point. It is what stops two code paths (a
-- poll and a hand-entry) from racing and creating a second item for one
-- garment, which would split its comps without any error being raised.

alter table items add column if not exists identity_key text;

-- Backfill. Existing rows were keyed on a raw title, so their real identity is
-- unknown here; they get a key derived from the id, which is unique and never
-- collides with a computed one (those always contain '|'). Re-running the
-- matcher re-pools them properly.
update items
   set identity_key = 'legacy:' || id::text
 where identity_key is null;

alter table items alter column identity_key set not null;

create unique index if not exists items_identity_key_uniq on items (identity_key);

comment on column items.identity_key is
  'subline|adYear|type|material — see src/lib/garment.mjs. Two listings are the same piece when and only when these are equal.';
