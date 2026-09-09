# Resale tracker

Personal, single-user price tracking and arbitrage scoring for a curated list of
resale brands. Not a marketplace, not public-facing, not a commercial product.

---

## Run it

| Your machine | What to open |
|---|---|
| macOS | **`start.command`** — double-click it. For an app icon instead, run **`Install on macOS.command`** once, then open **`Resale Tracker`** |
| Windows | **`start.bat`** — double-click it |
| Linux | run `./scripts/install-linux.sh` once, then launch **Resale Tracker** from your applications menu |

Nothing needs to be installed first. If Node 22+ is missing it fetches one
into `.runtime/` inside this folder (checksum-verified against the release's
own manifest before anything is run). If no database is reachable it finds the
Postgres already on your machine and runs a private one out of `.pgdata/`, on
its own port, without touching any database you already have. If there is no
Postgres at all it offers to install one.

Both are folders inside the project. Deleting the project deletes them; no
installers, no admin rights, nothing left on the system.

From there it installs dependencies, applies migrations, seeds the roster,
fetches exchange rates, builds, and opens your browser. Every step is skipped
when already done, so after the first run it starts in a couple of seconds.
Close the window, or press Ctrl-C, to stop.

### Why macOS needs one extra step

A folder downloaded from the internet arrives with no Unix permissions and
carrying a quarantine flag, and macOS launches an unsigned app under *App
Translocation* — from a random read-only copy where it cannot see the project
it is meant to launch. All three fail silently: you double-click and nothing
happens, or the app reports it has been moved when it has not.

`Install on macOS.command` fixes all three, once, without admin rights. Or skip
the app entirely and use `start.command`, which none of this affects.

The app is unsigned because signing requires a paid Apple developer account.

Docker is no longer needed. It is still used as a last resort if you have
Docker but no Postgres, and `docker compose up -d` still works if you prefer it.

## Quickstart, by hand

The same thing, if you would rather see the steps. Needs Node 22+ and
Postgres 14+.

```bash
git clone <this repo> && cd clothes
npm install
docker compose up -d              # or point DATABASE_URL at any Postgres
cp .env.example .env.local        # then set DATABASE_URL at minimum
npm run setup                     # migrate, seed, fetch real exchange rates
npm run dev                       # http://localhost:3000
```

`npm run setup` is idempotent — run it again after a pull. It prints which
optional credentials are unset and what each one unlocks.

To see the scoring and heat screens with something in them:

```bash
npm run setup:demo                # setup, plus sample listings
```

### Verify

```bash
npm test                  # 278 unit tests, no database needed
npm run test:integration  # 35 tests against a real Postgres (needs DATABASE_URL)
npm run typecheck
npm run verify:live       # real calls to every configured API — see below
```

`npm run verify:live` is the one that matters before trusting a source. It calls
each endpoint for real, reports what came back, and writes
`docs/live-verification.md` recording the *field names* of one raw record per
API — never values. If an adapter mis-parses a real response, that report shows
which field it was, without a second round trip. Secrets are redacted in both
the console output and the file.

### Exchange rates

Every comparison the platform makes crosses a currency, so this is the quietest
way for all of it to be wrong: a stale rate shifts every margin by roughly the
size of the edge being looked for, in the same direction, without failing.

Rates come from the ECB's daily fixing (via Frankfurter — no key, no account).
`npm run poll` refreshes them first, every time. `npm run fx` refreshes them on
demand and backfills any snapshot recorded while its currency had no rate.

While any rate is a seed placeholder, stale, or missing, every page carries a
banner saying so. If you see it, the margins on screen are not trustworthy yet.

### How a piece on two sites becomes one item

This is the mechanism the whole platform rests on, so it is worth knowing.

The same jacket is listed three ways by three sellers:

```
Comme des Garcons Homme Plus AD2002 wool tailored jacket
CDG HOMME PLUS 02AW ウール テーラード ジャケット
comme des garcons homme plus ad2002 wool jacket
```

Matching on the title gives three items and no comps. Instead an item is
identified by five things that can be *proven* from controlled vocabularies:

    sub-line | AD year | garment type | dominant material | model

Two listings are the same piece when and only when those agree
(`src/lib/garment.mjs`), and a unique index on the key means two code paths
cannot race and split a garment's comps in half.

The order is deliberate — most certain first. Everything before the first
unknown segment is what the piece is *known* to be, and an item pools with the
more specific items that share that known part. So an M.A+ bag whose model
nobody stated draws on the models that are named, while a listing that *does*
name its model uses only its own comps.

That last part matters more than it sounds. Without the model, every M.A+
leather bag was one item: an accordion bag priced against a tote, a pouch and a
shoulder bag, which is not a comparison. Footwear and bags are also split finer
than garments, because within one house the models differ far more in price
than a jacket differs from a jacket — a Guidi 788Z derby and a PL1 boot are not
comps for each other.

Where a figure rests entirely on other models, the row says `other models`: it
prices the category, not the piece.

Where a title cannot be read confidently the listing is **not** matched. It
appears in `/unresolved` to settle by eye, which is the intended destination
rather than a failure. Nothing is ever merged on a guess.

After changing how identity is derived, existing rows keep their old keys — run
`npm run rekey-items -- --dry-run` to see what would merge or split, then
without the flag to apply it.

## Which shops can be collected automatically

Two platforms, probed in turn by `npm run discover`:

- **Shopify** — `/products.json`, public and unauthenticated. It states no
  currency, so one has to be found from the storefront first, and a shop that
  will not say is skipped rather than guessed at.
- **WooCommerce** — the Store API at `/wp-json/wc/store/v1/products`, public,
  on by default, documented. It states its own currency alongside every price,
  as a code and a minor-unit exponent, so nothing has to be inferred — and a
  shop quoting two currencies, or contradicting what you configured, is
  refused rather than half-priced.

WooCommerce matters because it is what a large share of one-person archive
dealers run on. While only Shopify was supported, those shops had no route in
except by hand, however public their catalogue was.

Candidates live in `config/shops.json`, and everything in it is a guess until
probed: a domain that has moved, closed or never existed costs one request and
one skip line saying so. Add one you know of:

```bash
npm run discover -- --add shop.example
```

## The alerts they send you

The RealReal, Grailed and Vestiaire all offer saved-search email alerts. That
is a channel they built and chose to send through — reading it is not scraping,
because nothing is fetched from them at all: the mail is already in your inbox,
it arrived on their schedule, and they decided what was in it.

```bash
npm run mailbox                       # read what is unread, record it
npm run mailbox -- --dry-run          # parse and print, change nothing
npm run mailbox -- --file alert.eml   # read one saved message, no mailbox needed
```

**Try the last one first.** Every fixture behind this parser was written from
what these emails are shaped like, not from one they actually sent — so until a
real alert has been through it, it is untested against the only thing that
matters. Save one out of your mail client (in Gmail: ⋮ → Download message) and
run it. It needs no credentials, no token and no server, and what it prints is
exactly what would have been recorded. If it prints nothing, that message is
worth sending back here: the shape it expects is a guess, and a real one
settles it.

Turn on alerts for the searches you actually buy in, point them at a mailbox
(`MAILBOX_*` in `.env.local`, an app password rather than your real one), and
run it on whatever schedule you like. It reads unread mail only, so it is safe
to run on a timer: a message read once is not read again, and a listing cannot
be recorded twice from the same alert.

An email is parsed by its LINKS rather than by cutting at prices the way a
copied page is. Every listing in one of these is an anchor, and the lines that
belong to it are the lines inside it — cutting at prices instead turned a
two-listing email into eight fragments with the prices detached from the
titles, which is what it used to do. The footer, the greeting and the
unsubscribe link belong to no listing and are dropped rather than glued onto
whichever piece they sit beside.

## Capture what you are looking at

Two shorter routes to the same act, both reaching `/api/capture`, all of them
gated by `CAPTURE_TOKEN`:

- **A bookmarklet.** `/add` offers one built around your own token. Click it on
  a search page or a listing and it lands in a tab telling you what it
  recorded. It submits a form rather than calling in the background, because
  Chrome refuses to let a public HTTPS page make a background request to
  127.0.0.1 — and refuses by hanging rather than by failing.
- **A phone shortcut.** `POST /api/capture` with
  `{"kind":"url","url":"…"}` and an `Authorization: Bearer` header records a
  listing from its address alone: an iOS Shortcut on the share sheet is enough.
  Everything a URL cannot carry — price, size, condition — stays empty rather
  than being invented, so it arrives as something to finish.

Neither fetches anything from a venue. The page is already open in front of
you; the URL came out of your own share sheet.

`CAPTURE_TOKEN` is a second secret rather than your password because it has to
live where a password should not: in the visible source of a bookmark, in an
env file on a mail box, in a phone shortcut's stored config. It is therefore
scoped in the code and not merely in a comment — it satisfies exactly one
capability, which exactly one action asks for. A leaked capture token can add
listings. It cannot verify one, dismiss one, re-resolve an item or start a match
run, and a test reads `actions.ts` to assert that is still true.

## Venues with no feed and no API

The RealReal, Grailed and Vestiaire publish no product feed you can rely on
finding, expose no public API, and their terms rule out crawling them. That is
a real limit and no amount of configuration removes it.

What works instead: **copy the page you are looking at.**

Open a search result on any of them, select all, copy, and paste it into
**Paste a page** on `/add`. Say which venue it came from, and a whole page
arrives as drafts — brand resolved, price and currency parsed, size and
condition attached, the struck-through original kept as a note — to confirm.

Saying which venue matters more than it looks. A Grailed page filed under
"Other (manual)" would be recorded as somewhere you BUY, so it could never
serve as a comp — which is the entire reason to collect Grailed. One selector
sets the whole batch.

Mostly you will not have to. The venue is read from the host of each link
against the `base_url` of the sources you have configured, so every shop
`add-source` or `discover` set up is recognised the day it is added, with no
code change — the selector is there to override it, or for a paste that
arrived without links. What the PATH encodes — the listing id, sometimes a
brand or category — is per-site pattern matching against URL shapes nobody
promised us, so it is strictly additive: when a shape changes, those fields go
missing and nothing else moves. The venue is still right and the link still
opens.

Nothing is fetched and nothing is crawled. It is the same act as writing the
listings down, at the speed of a keystroke rather than a minute each, and it
works on any site regardless of what it does or does not publish.

The parsing is built for what a copied page actually looks like: a flat run of
lines with the structure stripped out. Records are cut at prices, because every
listing has exactly one current price and nothing else on the page looks like
money. A struck-through original does not become a phantom listing; a size
printed after its price is given back to the piece it belongs to; page
furniture is dropped.

### The link back to the listing

Each draft keeps a link to the piece it came from, and its picture. This is not
a nicety: without it a pasted row is a dead end, and finding that one item again
on The RealReal — by name, with no image — is close to impossible when a hundred
arrived in one paste.

It works because a browser puts *two* flavours on the clipboard when you copy:
the plain text a textarea receives, and `text/html`, which still has the anchors
and images in it with every relative URL already rewritten to an absolute one.
The first version of this read only the text and threw the rest away. So copy
from the page itself rather than from a text file — a plain-text paste still
parses, it just cannot link anywhere, and the parse note says how many rows
ended up that way.

Two things follow from having the links, both of which fix mistakes the text
alone could not:

- **The listing wins over the index it sits under.** Where a card links its
  brand to a designer page and its name to the product, the link nearest the
  price is taken — the piece, not the index.
- **Page furniture stops leaking into the first title.** The first card on a
  copied page inherits whatever preceded the grid, because records are cut at
  prices and nothing precedes the first one. Where one anchor demonstrably wraps
  a whole card, anything before it belongs to something else and is dropped —
  so "Menswear Comme des Garçons Homme Plus AD2002 wool jacket" becomes the
  garment again.

## When two sites describe one piece differently

The exact matcher keys a listing on sub-line, year, garment, material and
model, and anything that does not state enough to be keyed becomes an
unresolved listing: it pools with nothing, has no comps, and can never be
scored. That is most of what these venues publish. Grailed says "Comme des
Garcons Homme Plus AD2002 wool tailored jacket"; Vestiaire says "Comme des
Garçons — Wool jacket" and nothing else, because its seller never typed the
sub-line or the year. Those are the same coat, and exact matching will never
say so.

So every unresolved listing is now scored against the items already held for
its house, and `/unresolved` proposes what it probably is — with what it agreed
on and what it had to assume, both on the row:

> **Comme des Garçons Homme Plus AD2002 wool jacket** — 2 listings
> agrees on garment jacket, material wool, 67% of the describing words ·
> **assumes** it would be filed as cdg-homme-plus, which the listing does not say

Four things it will not do, because they are what make a comp mean anything: a
different house is a refusal, not a low score; so is a stated year, garment,
material or model that disagrees. Everything else is weighed. Nothing is ever
linked without you, and the assumption is always named — a sub-line decides
which comp pool a piece joins, and joining the wrong one corrupts both.

Strong proposals can be accepted in bulk, because a suggestion costing one
click each is a suggestion that goes unused when a paste is a hundred rows.

### When there is nothing to propose against

That only works for items you already hold, and a fresh paste has none: three
Vestiaire rows of one unnamed coat have nothing to be matched to, so they sit
unresolved forever — which is the state most of a first paste lands in.

So listings with no suggestion are compared with **each other** and grouped:

> **3 listings that look like each other** — agrees on garment jacket, material wool
> Assumes: none of them names a sub-line, so one has to be chosen

One sub-line settles the whole group, and the group becomes one item named from
what it agreed on rather than from whichever seller's wording came first. The
same four refusals apply, so a leather jacket never joins the wool ones — and
grouping is complete-linkage, meaning a listing joins only if it is compatible
with every member. Single linkage would chain a wool jacket to a leather one
through an unlabelled jacket that is compatible with both.

Two listings that agree only because neither says anything are not a group.
That is two silences, and making an item out of it would invent one out of no
information.

### Two things pasted pages put in titles

Grailed prints how long ago a piece was listed; Vestiaire prints a discount
badge. Both follow the price, so both used to land at the front of the NEXT
listing's title — and a title carrying "about 2 hours ago" is a different title
every hour. Identity comes from the title, so the same garment became a new
item on every paste and pooled with nothing. Both are now read as what they
are: the time is dropped, and the discount is kept as a note, since a seller
who has already moved on price is a fact about how the piece is selling.

## Why is nothing showing up?

```bash
npm run status
```

That question has one answer and it was never in one place. A source can be
configured but unpolled, polled but vetoed, ingesting but unmatched, matched
but unscored, or scored but held back for want of evidence — each stage has its
own screen and none of them says which stage you are stuck at.

`status` walks the whole pipeline in order and names the first thing genuinely
blocking, with the command that clears it. Later stages are reported but not
prescribed, because fixing one of those while an earlier stage is empty
achieves nothing.

The two credential setups check themselves before saving, so a wrong key fails
while you still have the dashboard open rather than silently producing a source
that returns nothing:

```bash
npm run add-ebay      # exchanges the credentials for a token first
npm run add-yahoo     # runs one real search first
```

## Reaching venues that refuse crawlers

The RealReal, Vestiaire and most large retailers block automated access to
their sites — and there is a front door that makes crawling them unnecessary.

They publish their entire catalogue to affiliate networks: id, title, brand,
price, currency, condition, link, image, as a Google Merchant XML or CSV feed.
That feed exists to be ingested and republished by other people. Joining the
programme gives you its URL, and reading it is its intended use.

```bash
npm run add-feed -- --id therealreal --name "The RealReal" \
  --url-env TRR_FEED_URL --currency USD --role both
```

```bash
npm run add-feed -- --preset vestiaire     # prints exactly where to get the feed
```

| Venue | Treated as | Notes |
|---|---|---|
| The RealReal | secondhand | buy from, and comp against |
| Vestiaire Collective | secondhand | |
| Farfetch | **retail** | buy from, never a comp |

**Find the network yourself: search "&lt;venue&gt; affiliate program".** This
document deliberately does not name networks. An earlier version asserted that
The RealReal's programme was on Rakuten Advertising; it is not, and that cost a
search for something that was not there. Programmes move networks, pause and
close, and a site's own footer is current where this file cannot be.

Not every venue runs one. If the search turns up nothing, that venue has no
sanctioned feed, and nothing in this project can create one — it stays manual
entry, with URL prefill on `/add` doing what it can from the link alone.

### Grailed has no equivalent

It is peer-to-peer, so there is no merchant catalogue to syndicate and no
affiliate product feed to join — the mechanism that makes the others reachable
does not exist there. Its terms also prohibit automated extraction, and it runs
bot protection that would end the data flow shortly after it started.

What replaces it is `npm run record-sale`: enter what your own pieces actually
fetched on Grailed, and the calibration layer learns the ratio between the
estimates here and what Grailed really pays, per brand. That is a better
foundation than scraped asking prices would have been — it is ground truth,
where an asking price is only what some other seller hoped for.

The feed URL embeds your publisher key, so it is a credential: put it in
`.env.local` and pass `--url-env` rather than putting it in your shell history.

Both XML and delimited feeds are read, the sale price is preferred over the
list price, and European and Anglo decimal conventions are told apart rather
than guessed — `1.234,56` and `1,234.56` are both 1234.56, and getting that
wrong moves a price by three orders of magnitude.

## Calibrating against what actually sold

Resale value is a median of comps from venues that can be polled, and the venue
you actually sell on may not be one of them. No proxy tracks it exactly: eBay
runs low on hyped archive and high on mainstream designer, and that gap is a
consistent per-brand ratio rather than noise.

So record what pieces really fetched, and the ratio is measured instead of
guessed:

```bash
npm run record-sale -- --brand cdg --venue grailed --price 700 --estimated 1150
```

Three sales are needed before anything is corrected. The correction ramps in
with evidence rather than switching on at the threshold, and a ratio far from 1
is clamped and flagged — that is far more often a mis-recorded sale than a real
market fact. Both numbers are kept, so what was adjusted and by how much stays
visible; a correction you cannot see is one you cannot check.

One consequence is worth knowing, because it is counterintuitive. Correcting a
venue downward, from real outcomes, ranks it *below* a venue you have never
sold on — whose estimate is not better, merely unadjusted. Left alone the
ranking would steer you toward whichever venue you understand least, and more
strongly the more honestly you recorded sales. That is not fixed by inventing a
correction for the unknown venue, which would be a guess dressed as a
measurement. It is labelled: a route leading only because nothing is known
about it is marked `uncalibrated venue`, and that warning is never suppressed
by warnings about the listing.

## What a route actually costs you

The profit figure is what you receive minus what you lay out, and "what you lay
out" is a whole stack: proxy commission, two shipping legs, customs duty, import
VAT, the exit venue's fee, payment processing, outbound postage. Every route
ships with a plausible set of these numbers, and they are guesses — written to
exercise the arithmetic, not measured against anything. The duty rate alone
varies by material and origin, and nothing here knows which proxy service you
use or what your seller-level fee is.

A guess is fine. A guess that reads as a fact is not: it lands in the same
`PROFIT €412` as everything else. So a route records whether anybody has ever
checked it, and until somebody has, every margin computed through it carries a
flag saying the deductions are estimates.

```bash
npm run route-costs                       # what each route currently assumes
npm run route-costs -- --route jp_to_grailed --sale-fee 0.09 --duty 0.04 --confirm
```

Percentages are fractions — `0.09` is nine percent, and `9` is refused rather
than interpreted, because a 900% fee would quietly invert every margin on the
route. `--confirm` is what clears the flag; changing numbers without it leaves
the flag on, since a half-corrected stack is still an unchecked one. Confirmed
costs also survive re-running `npm run seed`, which would otherwise put the
placeholders back and change every margin with nothing to say why.

## A wrong currency is the worst thing that can happen here

It does not look like an error. It looks like a bargain.

A €500 jacket read as ¥500 converts to about €3 and goes straight to the top of
the opportunities table, above every real find, wearing a 99% margin. Every
number after that is arithmetically correct, and the platform reports them with
full confidence. The same mistake in reverse buries a genuine piece at €128,000.

Three things guard against it, because detection alone cannot be trusted:

1. **Currency is never guessed.** A shop that does not state it is skipped.
2. **Detection reads only signals that mean what is needed.** `/products.json`
   is denominated in the shop's *base* currency while its storefront renders
   the *visitor's*, so a Japanese shop selling into Europe shows € to a European
   browser while its feed stays in ¥. Reading the storefront answers a different
   question, and does so most confidently on exactly the international shops
   where it is wrong. `meta.json` is preferred; the storefront is a last resort
   and is labelled as unverified.
3. **Every poll is checked for magnitude.** Once converted, does the catalogue
   look like clothing? A source whose *median* piece converts to €3 has been
   read in the wrong currency, whatever it claims. That poll is vetoed and
   nothing is written — ingesting and flagging afterwards would leave prices
   wrong by two orders of magnitude in the table that drives every decision.

To audit and repair:

```bash
npm run fix-currency -- --check                              # what looks wrong
npm run fix-currency -- --source archive_store --currency EUR
```

Repairing re-converts every snapshot that source ever wrote, at the rate
nearest each snapshot's own date rather than today's — converting an old price
at a new rate would fold FX drift into what looks like a price movement, and
price movement is the signal this platform reads.

## A margin is only real if somebody acted on the price

An asking price is what one seller hopes for. A margin computed from asks alone
is arithmetic on two hopes, and on screen it looks exactly like one computed
from evidence.

There are three tiers, and the middle one matters most in practice:

| Basis | What it means |
|---|---|
| recorded sale | you entered what a piece actually fetched (`npm run record-sale`) |
| disappearance | a piece was taken off the market at that price |
| asks only | nobody has agreed to this number at all |

Gating on recorded sales alone would leave `/opportunities` permanently empty,
because nothing in the automated path ever writes one — and rightly so: a poll
that stops seeing a listing cannot know it sold. But a piece that vanished at a
price is not nothing. It might have been withdrawn or reserved, yet across a
pool of comps most of them sold, and that is materially better evidence than an
asking price.

So the first two show by default, and asks-only sit behind a toggle that says
how many there are. They are not worthless — for thin archive pieces asks are
often all there is — but the two must never be mistaken for each other.

## An alert never pushes a number nobody agreed to

Alert rules fired on profit, provisional status and flags, but not on what the
margin rested on — so a figure the opportunities screen holds back would still
have arrived as a notification. That is the same fabricated profit delivered
more forcefully: a screen you chose to look at can carry a caveat beside a
number, a push notification is read as "act on this now".

Rules therefore ignore ask-only margins unless `include_asks_only` says
otherwise, and the column defaults to false so a change nobody is watching for
makes existing rules stricter rather than looser.

## Sold pieces leave the buy side and stay as evidence

The grid used to have no status filter at all, so sold and out-of-stock
listings sat among the buyable ones looking identical. On the one-off archive
shops this platform watches, most of a catalogue is gone — which made the whole
screen useless, since every promising row had to be clicked to find out it was
not real.

They are hidden now, one filter away (`show sold & gone`), still in the table
and still counted as comps. That is the same fact doing both jobs: a piece that
disappeared at a price is not a thing to buy, and is exactly the evidence the
estimate above rests on.

## Retail is never a comp

A boutique's full price for a current-season piece is not a comp for a
fifteen-year-old archive jacket. It is a ceiling nobody pays on the resale
market, and pooling it in drags every estimate upward — inventing margin that
is not there, which is the direction of error that costs money rather than
opportunities.

Sources carry `marketplace_kind`, and retail ones are excluded wherever comps
are gathered. The candidate list in `config/shops.json` is secondhand only:
archive dealers, Japanese secondhand chains, and one-person resellers — the
places a piece can be bought under its resale value.

## Adding automated sources

Everything below is optional and independent. The app is fully usable with none
of it.

| What | Set | Then |
|---|---|---|
| Shopify shops | `PROBE_CONTACT` | `npm run add-source -- --domain shop.example --currency JPY` |
| Yahoo! Shopping | `YAHOO_APP_ID` | `{"adapter":"yahoo_shopping","currency":"JPY","query":"コムデギャルソン"}` |
| Rakuten Ichiba | `RAKUTEN_APP_ID` | `{"adapter":"rakuten","currency":"JPY","keyword":"…"}` |
| eBay Browse | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | `{"adapter":"ebay","query":"…","marketplaceId":"EBAY_GB"}` |
| Discord alerts | — | set `webhook_url` on a row in `alert_rules` and switch `channel` from `none` to `discord` |
| Attention signals | `PROBE_CONTACT` | `npm run heat` |

```bash
npm run poll     # fetch from feed sources
npm run alert    # score and notify
npm run heat     # refresh attention signals
```

Before adding a shop, check it:

```bash
PROBE_CONTACT=you@example.com npm run probe-shops
```

The probe reads robots.txt first, never requests a disallowed path, fails closed
on an unreadable robots.txt, backs off on 429, and never contacts a shop marked
`declined`.

Then add one:

```bash
npm run add-source -- --domain shop.example --currency JPY --dry-run
```

It re-checks robots.txt live rather than trusting the probe, confirms the feed
parses, and prints a sample of the prices it would ingest so a wrong currency is
visible as a number rather than discovered as a 150x error later. Drop
`--dry-run` to write the row. Currency is required and never inferred from the
domain.

A source with no route to an exit venue produces listings that appear in the
grid but score nothing — `add-source` says so when that is the case.

## Deploying

Vercel plus a hosted Postgres is the intended shape.

1. Push the repo and import it into Vercel.
2. Set `DATABASE_URL`, `BASE_CURRENCY`, `APP_PASSWORD` and `CRON_SECRET` (the
   last two any long random string) in the project's environment variables,
   plus whichever API keys you want.
3. Run `npm run setup` once against the production database.
4. `vercel.json` already declares the schedules — poll every 15 minutes, alert
   three minutes after each poll, attention signals daily. Each poll refreshes
   exchange rates first, so they cannot silently go stale.

The scheduled endpoints refuse to run without `CRON_SECRET` rather than
defaulting to open: an unauthenticated poll endpoint is a way for a stranger to
make you hammer someone else's shop.

`APP_PASSWORD` is the same idea for the pages themselves. These screens list
what you are about to buy, at what price, and what you believe it is worth —
not a dataset to publish, and publishing it would be silent, since a deployment
without a password looks exactly like one with a password until somebody finds
the URL. Set it and you get one password prompt, remembered for thirty days in
a signed httpOnly cookie.

**Set it unless this is running strictly on localhost and unforwarded.** Not
"set it when you deploy" — that rule leaves a real hole. `next start` binds
0.0.0.0 by default, so on a café wifi anyone on that network can reach the
port, and a Host header saying `localhost` is something they can write
themselves. A tunnel, an `ssh -L`, a VPN address or a container publishing the
port all do the same thing, and none of them look any different from inside the
process.

So the check is the bind, not the header. `npm run dev`, `npm start` and the
launcher bind 127.0.0.1 and pass it on as `APP_BIND`; only a server known to be
listening on loopback serves anything without a password, and an unset
`APP_BIND` counts as unknown rather than safe. Widen the bind and the app
refuses every request until a password exists. The one case nothing in the
process can see is a deliberate forward of the loopback port — which is why the
rule above is worded the way it is.

Guessing at the password is throttled in the database rather than in process
memory: attempts against one counter are serialised by a row lock, each failure
doubles the delay to a cap of eight seconds, and ten failures shut the door for
fifteen minutes. The delay is paid before the password is compared, so how long
a reply takes says nothing about how close the guess was. Ten parallel requests
get the same treatment as ten sequential ones — which is the whole reason it is
a counter under a lock and not a `setTimeout`.

Which counter an attempt lands in is decided the same way the loopback question
is: never from a header alone. Bound to loopback there is one guesser and one
counter. Otherwise every attempt shares a single counter — unless
`APP_TRUST_PROXY=1` says the thing in front overwrites `x-forwarded-for` rather
than appending to whatever a client sent, which is the only case where a
per-client count means anything. Set it wrongly and a guesser puts a fresh fake
address on each request and never reaches the lockout; left unset, the worst
case is that someone else's guessing delays you too.

## Constraints this codebase enforces

Not conventions to be tidied away later. Several are database constraints, so
future code cannot violate them.

- **No automated collection from The RealReal, Vestiaire Collective or Grailed.**
  Their terms prohibit it. `sources.automation_allowed` is false for all three
  with the reason recorded, and a check constraint stops a manual-tier source
  being marked automatable.
- **No access-control evasion anywhere.** No proxy rotation, fingerprint
  spoofing, CAPTCHA solving or bot-protection bypass, including via a vendor. A
  source reachable only that way belongs in the manual tier.
- **No automated purchasing.** The dashboard records that *you* bought
  something. No code path completes a transaction.
- **A disappearance is never a sale.** `listing_status` has no value meaning
  "sold" other than `sold_confirmed`, tied by constraint to
  `evidence = 'confirmed_sale'`. An inferred sale is not representable.
- **A failed, partial or suspiciously shrunken poll changes nothing.** Verified
  by integration tests against a real database.
- **Comps are never pooled across sub-line or condition tier**, and resale value
  comes only from venues you sell on.
- **One garment is one item, enforced by the database.** A unique index on
  `items.identity_key` means two code paths cannot race and split a garment's
  comps between two items — which would halve every comp set without raising an
  error.
- **An unstated condition is valued against the cheapest tier, never the
  dearest.** A feed states price and title, almost never condition. Assuming
  mint on a piece that proves thrashed costs money; assuming the worst on one
  that proves mint costs an opportunity.
- **FX travels with its rate.** `price_base` and `fx_rate_at_snapshot` are
  all-or-nothing, so a historical price can never be reconverted at today's rate.
- **Heat never enters the arbitrage score.** Profit is measurable; heat is
  inference from attention. Mixing them would corrupt the number that matters.

## Screens

| Route | Purpose |
|---|---|
| `/add` | Fast manual entry, URL prefill, bulk paste. The primary surface. |
| `/` | Photo-forward grid, filterable, sortable by profit, spread, discount, confidence or flagged. |
| `/opportunities` | Ranked candidates with the full chain: buy → landed → resale → net. |
| `/items` | Canonical items, with exit-comp counts showing what is scoreable. |
| `/item/[id]` | One item: score working, comps split by exit vs acquisition, price history. |
| `/heat` | Cultural-attention watchlist, per item and per sub-line. |
| `/verify` | Re-check queue, plus on-demand re-verification. |
| `/unresolved` | Manual matching, with reverse-image search. |
| `/sources` | Sources, their roles, routes and cost stacks, poll health. |
| `/alerts` | Rules, delivery history and measured latency. |

## Brands

A curated roster of ~47 houses and ~107 sub-lines — narrow on purpose, because
that is what makes matching tractable and the feed signal-dense.

Sub-lines are modelled explicitly wherever they are separate markets: CDG's
family, Yohji's dozen lines, 11 by Boris Bidjan Saberi against the mainline,
DRKSHDW against Rick Owens, HOMME PLISSÉ against the Issey archive. Diffusion
lines that would flood the feed (CDG Play, Y-3, Rick Owens x adidas) resolve but
are excluded from monitoring, so they are recognised and filtered rather than
silently pooled.

Japanese aliases are first-class: the Japan route is only worth running if
`ヨウジヤマモトプールオム` matches.

Add a brand in `src/lib/brands/` — a file for houses with real line structure,
or a few lines in `artisanal.mjs` / `japanese.mjs` for those without.

## Layout

```
config/            shop candidates for the probe
db/migrations/     SQL, portable to Supabase
scripts/           migrate, seed, poll, alert, heat, probe-shops, dev-fixture
src/lib/           domain logic, framework-free and unit-tested
  brands/          the curated roster
  adapters/        one per source, all on a shared contract
  resolve.mjs      brand and sub-line resolution
  scoring.mjs      arbitrage, on routes
  priceHistory.mjs comps by condition tier, evidence weighting
  heat.mjs         cultural attention, kept away from scoring
  ingest.mjs       the rules that stop a bad poll rewriting history
src/app/           Next.js App Router pages, server actions and cron endpoints
```

Domain logic lives in plain `.mjs` so it is testable with `node --test` and
usable from the scripts without dragging in the framework.

## Documents

- `docs/phase-0-research.md` — source-by-source verdicts
- `docs/phase-*-handoff.md` — what works, what is stubbed, what was assumed
- `docs/design-notes.md` — the visual language and where usability won
