-- Repair disappearances that were recorded without their evidence.
--
-- planAbsences has always returned both a status and an evidence class, and
-- both callers wrote only the status. So every listing that left the market —
-- whether a poll noticed it absent or a person confirmed it gone — kept the
-- evidence it was first seen with, `active_ask`.
--
-- Nothing failed. The rows looked right, the status was correct, and the only
-- symptom was downstream: anything asking "did something actually move at this
-- price?" saw a table of asking prices and nothing else. That is the question
-- the opportunities screen now gates on, so the whole disappearance tier was
-- inert against real data while passing every test that wrote its own rows.
--
-- A delisted listing is a disappearance by definition. Sales are excluded
-- explicitly: `sold_confirmed` is only ever set by a person recording a real
-- sale, and this must not overwrite that.

update listings
   set evidence = 'inferred_disappearance'
 where status = 'delisted'
   and evidence <> 'inferred_disappearance'
   and evidence <> 'confirmed_sale';
