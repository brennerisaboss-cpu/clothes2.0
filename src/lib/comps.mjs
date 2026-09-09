// Which items may lend their observations to which.
//
// This lives apart from the query that uses it for one reason: it is the rule
// that decides what a piece is compared against, and getting it wrong does not
// crash anything — it quietly prices an accordion bag against every bag the
// house makes and reports the result with a confidence figure attached. That
// kind of mistake has to be testable against a real database, and the test
// must exercise the same SQL the application runs, not a copy of it that can
// drift.
//
// The rule
// --------
// Identity is `subline|adYear|type|material|model`, ordered most-certain to
// least, and a segment the seller never stated is `?`. An item with no `?`
// uses only its own listings.
//
// An item WITH a `?` may borrow from items that agree on every segment it does
// know, and differ only where it says `?`. Borrowing is one-directional and
// nothing is merged: an item that names its material never borrows from one
// that does not, so a wool coat's valuation is never diluted by an unlabelled
// one.
//
// The subtlety is that unknowns are not always trailing. A bag whose material
// nobody stated but whose model is printed on the tag keys as
//
//     ma-plus|ad?|bag|?|b7
//
// and the earlier version of this rule pooled on everything before the FIRST
// `?` — which threw away `b7` and compared that bag against every bag in the
// line. Wrong in the direction that looks right: more comps, higher
// confidence, a number that is not about this bag at all. So every known
// segment is checked, wherever it sits.
//
// $1 is the array of item ids being valued.

export const VISIBLE_ITEMS_CTE = `
  wanted as (
    select id, identity_key, string_to_array(identity_key, '|') as parts
      from items where id = any($1::uuid[])
  ),
  w2 as (
    select id, identity_key, parts,
           -- Only used to decide WHETHER this item borrows at all, and to
           -- give the index a prefix to work with. What it may borrow FROM is
           -- decided segment by segment below.
           array_position(parts, '?') as unknown_at
      from wanted
  ),
  visible as (
    select id as for_item, id as from_item, false as borrowed from w2
    union
    select w.id, i.id, true
      from w2 w
      join items i
        on i.id <> w.id
       -- Something must be unknown, or there is nothing to pool over.
       and w.unknown_at is not null
       -- An unknown SUBLINE is not a gap to be filled, it is an unidentified
       -- garment. Pooling on it would draw from the entire table.
       and w.unknown_at > 1
       -- Redundant against the segment check that follows, but it is a
       -- left-anchored LIKE, so the index on identity_key can use it.
       and i.identity_key like array_to_string(w.parts[1:w.unknown_at - 1], '|') || '|%'
       -- Every segment this item DOES know must match. The lender may be more
       -- specific where this one says '?'; it may not disagree anywhere else.
       and not exists (
         select 1
           from unnest(w.parts) with ordinality as known(segment, at)
          where known.segment <> '?'
            and known.segment is distinct from (string_to_array(i.identity_key, '|'))[known.at]
       )
  )
`;

/**
 * A comp is a PIECE, not a snapshot of one.
 *
 * `listings` is an append-only log: a re-price inserts a new row pointing at
 * the one it supersedes, so the table holds every price a listing has ever
 * worn. That makes the table the wrong thing to count. One jacket whose seller
 * cut its price twice is three rows, and counting them let a single garment on
 * a single venue satisfy the three-comp minimum by itself — reported as a
 * settled estimate, with a confidence figure whose volume factor had counted
 * the same jacket three times, at a median resting on a price the seller had
 * already abandoned.
 *
 * Only the head of each chain is a comp: the piece as it stands now, at its
 * current price, carrying whatever evidence it ended with — including the
 * disappearance, which `planAbsences` writes to the head row. The superseded
 * rows are not discarded. They are the price history, and the item page still
 * shows every one of them, which is the screen where a sequence of prices means
 * something.
 *
 * Exported as SQL rather than restated at each call site because there are
 * three of them — the dashboard, the alert script and the cron endpoint — and
 * they had already drifted apart once. `l` is the listings alias.
 */
export const HEAD_OF_CHAIN = `
  not exists (select 1 from listings sup where sup.supersedes_id = l.id)
`;
