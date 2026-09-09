// Every adapter, in one place.
//
// There were two registries — one in `scripts/poll.mjs`, one in the cron
// endpoint — and they had drifted. The CLI knew seven adapters and the endpoint
// knew four, so a WooCommerce shop or a merchant feed worked perfectly when
// polled by hand and answered "no adapter configured" on every scheduled run.
// That is the worst shape a discrepancy can take: it works while you are
// watching and stops when you are not, and the source's own page reports a
// failure that names nothing wrong with the source.
//
// One registry, imported by both. A new adapter is now reachable from
// everywhere the moment it is added here, which is also the only place it has
// to be added.

import * as shopify from './shopify.mjs';
import * as woocommerce from './woocommerce.mjs';
import * as yahooShopping from './yahooShopping.mjs';
import * as rakuten from './rakuten.mjs';
import * as ebay from './ebay.mjs';
import * as ebayInsights from './ebayInsights.mjs';
import * as merchantFeed from './merchantFeed.mjs';
import * as page from './page.mjs';

export const ADAPTERS = {
  shopify,
  woocommerce,
  yahoo_shopping: yahooShopping,
  rakuten,
  // Active asks. eBay's Browse API cannot report a sale and says so on every
  // listing it returns.
  ebay,
  // Completed sales. The first adapter to report `confirmed_sale`, not the only
  // one permitted to: any source that STATES an outcome rather than inferring
  // one may, and the contract is written for that rather than for eBay.
  ebay_insights: ebayInsights,
  merchant_feed: merchantFeed,
  // The shop with no feed and no key. Reads the results page itself, the way
  // copying it reads it, and always reports the catalogue as incomplete — so
  // it can add and re-price, and can never conclude anything is gone.
  page,
};

/**
 * The adapter a source is configured for.
 *
 * Shopify is the default because it was the first and existing rows predate the
 * key; an unrecognised name returns null rather than falling back to it, since
 * polling a WooCommerce shop with the Shopify adapter would fetch a 404 and
 * report the shop as broken.
 */
export function adapterFor(config) {
  return ADAPTERS[config?.adapter ?? 'shopify'] ?? null;
}
