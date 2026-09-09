# Live verification

Generated 2026-09-04T20:17:52.208Z by `npm run verify:live`.

Secrets are redacted. Safe to commit.

| Check | Result | Detail | ms |
|---|---|---|---|
| exchange rates | pass | 4 rates into EUR, ECB fixing 2026-09-03 (1d old) | 77 |
| wikipedia pageviews | fail | pageviews returned HTTP 403 | 70 |
| yahoo shopping | skip | YAHOO_APP_ID not set | — |
| rakuten ichiba | skip | RAKUTEN_APP_ID not set | — |
| ebay browse | skip | EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set | — |
| discord webhook | skip | DISCORD_WEBHOOK_URL not set | — |

## Samples

These are the real payload fields as the adapters parsed them. If a field is
null or missing where it should not be, the adapter needs correcting against
the real API rather than the fixture.

### exchange rates

```json
[
  {
    "pair": "JPY->EUR",
    "rate": 0.00579609
  },
  {
    "pair": "USD->EUR",
    "rate": 0.858959
  },
  {
    "pair": "GBP->EUR",
    "rate": 1.1722
  },
  {
    "pair": "CHF->EUR",
    "rate": 1.06564
  }
]
```

## Raw response shapes

Field NAMES only, from one real record per endpoint — no values, so nothing
sensitive travels. If a parsed sample above shows null where it should not,
compare against the shape here: the adapter is probably reading a field the API
names differently.

```json
{
  "fx response": {
    "amount": "number",
    "base": "string",
    "date": "string",
    "rates": {
      "JPY": "number",
      "USD": "number",
      "GBP": "number",
      "CHF": "number"
    }
  }
}
```
