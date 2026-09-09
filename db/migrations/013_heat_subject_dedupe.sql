-- A unique constraint that never fired.
--
-- heat_subjects is unique on (subject_type, brand_id, subline_id, item_id),
-- and for a brand or sub-line row item_id is NULL. Postgres treats NULLs as
-- DISTINCT in a unique index by default, so two rows differing only in a NULL
-- do not collide — the constraint permitted the exact duplicates it was
-- written to prevent, and the seed's ON CONFLICT DO NOTHING never matched.
--
-- The seed is idempotent by design and is run on every setup, so this leaked
-- one full set of subjects per run: 150 rows a time, 2,272 by the time it was
-- noticed. Nothing broke, which is why it went unnoticed — it only grew.
--
-- NULLS NOT DISTINCT makes the constraint mean what it was always meant to.

delete from heat_subjects a
 using heat_subjects b
 where a.id > b.id
   and a.subject_type = b.subject_type
   and a.brand_id is not distinct from b.brand_id
   and a.subline_id is not distinct from b.subline_id
   and a.item_id is not distinct from b.item_id;

alter table heat_subjects
  drop constraint if exists heat_subjects_subject_type_brand_id_subline_id_item_id_key;

alter table heat_subjects
  add constraint heat_subjects_subject_uniq
  unique nulls not distinct (subject_type, brand_id, subline_id, item_id);
