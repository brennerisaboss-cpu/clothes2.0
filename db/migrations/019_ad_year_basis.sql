-- Where an item's production year came from.
--
-- Until now there was one answer and it did not need recording: `ad_year` was
-- read from an AD tag in the title and nothing else could set it. That made
-- every piece outside Comme des Garçons year-unknown, because nothing else in
-- the roster carries an AD tag — so a Yohji SS1998 coat and a Yohji AW2019 coat
-- were one item, sharing a comp set across twenty-one years of production.
--
-- Season codes now fill that segment: "02AW", "AW03", "SS19", "FW2018". They
-- name the same production year the AD tag does and are pooled with it on
-- purpose — AD2002 already spans SS02 and AW02, so folding a season into it
-- changes nothing about how coarse the bucket is.
--
-- But they are not the same KIND of fact. An AD tag is printed on the garment;
-- a season code is what a seller wrote about when they think it was made. Both
-- are worth acting on and only one of them is stamped on the label, and a
-- distinction that exists in the reasoning and not in the data is one nobody
-- can check later. Hence the column: same number, stated provenance.
alter table items
  add column if not exists ad_year_basis text
    check (ad_year_basis in ('ad_tag', 'season', 'manual'));

-- Every year already stored was read from an AD tag, because that was the only
-- reader there was. Backfilled rather than left null, so the column means the
-- same thing on old rows as on new ones.
update items set ad_year_basis = 'ad_tag'
 where ad_year is not null and ad_year_basis is null;

-- A basis with no year describes nothing, and a year with no basis is the state
-- this column exists to end. The two travel together, the way price_base and
-- fx_rate_at_snapshot do.
alter table items
  drop constraint if exists ad_year_basis_travels_with_the_year;
alter table items
  add constraint ad_year_basis_travels_with_the_year
    check ((ad_year is null) = (ad_year_basis is null));
