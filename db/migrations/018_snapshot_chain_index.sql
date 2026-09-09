-- The head-of-chain test, made affordable.
--
-- `listings` is an append-only snapshot log: a re-price inserts a new row
-- pointing at the one it supersedes. Almost every read in the platform wants
-- the CURRENT state of a piece rather than every price it has worn, and asks
-- for it the same way:
--
--     not exists (select 1 from listings sup where sup.supersedes_id = l.id)
--
-- That runs on the grid, the verification queue, the facet counts, the scoring
-- candidates, the comp pool, the census, the survival spans, the alert script
-- and every poll. With no index on the column it was a sequential scan of the
-- whole log each time — and the log is the one table that only ever grows,
-- because it is the price history. The cost is invisible on a demo fixture and
-- compounds on exactly the installation that has collected enough to be worth
-- using.
--
-- Partial, because a null supersedes_id is the common case and the probe never
-- looks for one: the index holds only the rows that actually point at a
-- predecessor, which is a small fraction of the table.
create index if not exists listings_supersedes_id
  on listings (supersedes_id)
  where supersedes_id is not null;

-- Walking a chain forward, from the first sighting of a piece to its current
-- price, starts at the rows nothing supersedes. marketSpans() does exactly that
-- and needs the roots cheaply.
create index if not exists listings_chain_roots
  on listings (first_seen_at)
  where supersedes_id is null;

-- Scoring candidates are active listings on an acquisition source, matched to
-- an item, newest first. The existing indexes cover source and date but not the
-- match, so the join to `items` drove the plan and the status filter was
-- applied afterwards.
create index if not exists listings_scoring_candidates
  on listings (date_seen desc)
  where status = 'active' and item_id is not null;
