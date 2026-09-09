# Design notes

## Where this came from

The reference material you sent: dot-matrix embroidery charts, mid-century
Japanese and Swiss print work, the YMO 1983 tour sleeve, halftone compositions,
and bold geometric letterforms treated as objects on a ground.

## The pass this replaces, and why

The first two passes read those references as a Victorian specimen sheet. They
produced: a sepia cream ground, a dotted lattice with a second grain layer
under it, a didone display face, an old-style italic serif for every caption, a
plotted dot ornament beside each heading, roman plate numbers, and a shadowed
"sheet" floating over the page.

Every one of those is defensible on its own and together they were wrong. Three
things went bad:

- **It read as a museum label, not a tool.** The italic serif turned live counts
  and warnings into commentary in someone else's voice. A caveat about your own
  data should be in the same voice as the data.
- **Nothing could be emphatic.** Six inks — two creams, madder, ochre, indigo,
  green — competing on a low-contrast sepia ground meant no element could carry
  weight, so everything was decorated to compensate.
- **The texture fought the content.** A dot lattice is handsome behind an empty
  screen and noise behind a dense table, which is where this actually lives.

## What it is now

One face, one red, and rules.

| Reference trait | How it is used |
|---|---|
| Type as object | Archivo Narrow, uppercase, heavy, set large and tight. Size and weight carry the hierarchy — there is no second voice |
| A field of ink cut by one rule | The masthead is solid black with the name reversed out and a single red line under it. The one emphatic thing on the page |
| One accent, spent deliberately | A single vermillion: the masthead rule, the active item, section numbers, anything flagged. Nothing else is coloured |
| Uncoated stock, not aged paper | A cool warm-white. The sepia read as tea-stained; these references print on fresh stock |
| Structure by rule, not by box | A heavy rule under every heading and table header, hairlines between rows, nothing around the outside |
| Square, always | Not one rounded corner on any reference. Corners are squared once in CSS rather than across twenty files |

## Where usability wins over the reference

- **Red is not a confirmation colour.** It means attention. A healthy state uses
  a deep green, which a printed piece would plausibly carry as a second plate.
- **Contrast is measured, not eyeballed.** Against the paper: ink 17.4:1, muted
  6.4:1, red 5.1:1, green 5.4:1 — all clear AA at body size, and the red also
  clears AA against ink, which it must, because it lands on black.
- **Figures are tabular.** Numbers in a column line up or they are not a column.
- **Density is unchanged.** No padding was added for the sake of the look.

## Not done

- **No dark mode.** The palette commits to paper. A dark variant needs its own
  measured steps, not an inversion.
- **No custom face.** Archivo is served from Google Fonts with Helvetica Neue
  behind it, so a machine with no network looks nearly the same rather than
  broken. A licensed grotesque with a real condensed heavy would sharpen it.
- **The reference images were not on hand for this pass.** It was designed from
  the description above rather than from the pictures. If it is still not right,
  re-attach them and the specifics — proportion, spacing, exact reds — can be
  matched rather than inferred.
