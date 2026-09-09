import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksFromEmail, looksLikeAlert } from '../src/lib/alertEmail.mjs';

// An alert email is the one route into Grailed, Vestiaire and The RealReal that
// runs unattended: they send it themselves, on their own schedule, through the
// channel they built for it. Nothing here fetches anything.
//
// The measured failure this replaces: cutting an email at prices, the way a
// copied page is cut, turned a two-listing message into eight fragments with
// the prices detached from the titles.

/** A table-based alert, which is what all three of them send. */
const GRAILED = `
<html><body>
  <p>New listings matching “Comme des Garcons Homme Plus”</p>
  <table>
    <tr>
      <td><a href="https://www.grailed.com/listings/111-cdg-hp-ad2002-wool-jacket">
        <img src="https://cdn.grailed.invalid/111.jpg"></a></td>
      <td><a href="https://www.grailed.com/listings/111-cdg-hp-ad2002-wool-jacket">
        <div>Comme des Garcons Homme Plus</div>
        <div>AD2002 wool tailored jacket</div>
        <div>$850</div>
        <div>Size 46</div></a></td>
    </tr>
    <tr>
      <td><a href="https://www.grailed.com/listings/222-guidi-992">
        <img src="https://cdn.grailed.invalid/222.jpg"></a></td>
      <td><a href="https://www.grailed.com/listings/222-guidi-992">
        <div>Guidi</div>
        <div>992 horse leather derby</div>
        <div>$700</div>
        <div>Size 42</div></a></td>
    </tr>
  </table>
  <p><a href="https://www.grailed.com/unsubscribe?u=9">Unsubscribe</a> ·
     <a href="https://www.grailed.com/settings/alerts">Manage alerts</a></p>
</body></html>`;

test('an alert email yields one record per listing, not one per line', () => {
  const { blocks, note } = blocksFromEmail(GRAILED);
  assert.equal(blocks.length, 2, note);

  const [jacket, boot] = blocks;
  assert.equal(jacket.title, 'Comme des Garcons Homme Plus AD2002 wool tailored jacket');
  assert.match(jacket.price, /850/);
  assert.equal(jacket.size, '46');
  assert.equal(jacket.url, 'https://www.grailed.com/listings/111-cdg-hp-ad2002-wool-jacket');
  assert.equal(jacket.image, 'https://cdn.grailed.invalid/111.jpg');

  assert.equal(boot.title, 'Guidi 992 horse leather derby');
  assert.match(boot.price, /700/);
});

test('the picture link and the title link are one listing, not two', () => {
  // Every one of these emails links the same piece twice.
  const { blocks } = blocksFromEmail(GRAILED);
  const urls = blocks.map((b) => b.url);
  assert.equal(new Set(urls).size, urls.length);
});

test('the footer is not a listing', () => {
  const { blocks } = blocksFromEmail(GRAILED);
  assert.ok(!blocks.some((b) => /unsubscribe|manage/i.test(b.url ?? '')));
  assert.ok(!blocks.some((b) => /Unsubscribe/i.test(b.title ?? '')));
});

test('the greeting does not get glued to the first listing', () => {
  // The failure that price-cutting produced: everything before the first price
  // belongs to the first record, so the header line became part of its title.
  const { blocks } = blocksFromEmail(GRAILED);
  assert.ok(!/New listings matching/.test(blocks[0].title));
});

test('a struck-through original is kept apart from what you would pay', () => {
  const html = `
    <a href="https://www.vestiairecollective.com/x-12345678.shtml">
      <div>Comme des Garçons</div><div>Wool jacket</div>
      <div>€980.00</div><div>€1,400.00</div><div>M</div>
    </a>`;
  const [block] = blocksFromEmail(html).blocks;
  assert.match(block.price, /980/);
  assert.match(block.wasPrice, /1,400/);
  assert.equal(block.size, 'M');
});

test('a listing whose link carries no price is not invented', () => {
  const html = `<a href="https://www.grailed.com/listings/1-x"><div>Just a link</div></a>`;
  assert.deepEqual(blocksFromEmail(html).blocks, []);
  assert.equal(looksLikeAlert(html), false);
});

test('a newsletter or receipt reads as nothing rather than as listings', () => {
  const html = `
    <p>Your order has shipped.</p>
    <p><a href="https://www.therealreal.com/orders/55">Track your order</a></p>
    <p>Total paid: $1,150.00</p>`;
  const { blocks } = blocksFromEmail(html);
  // The one link is an order page, not a listing, and the price belongs to no
  // link at all — so nothing is recorded.
  assert.equal(blocks.length, 0);
});

test('an email in a language the parser does not read still parses', () => {
  // Nothing here matches on English words; the structure is the whole signal.
  const html = `
    <a href="https://www.vestiairecollective.com/p-987654.shtml">
      <img src="https://cdn.invalid/987654.jpg">
      <div>ヨウジヤマモト</div><div>ウール コート</div><div>¥128,000</div><div>3</div>
    </a>`;
  const [block] = blocksFromEmail(html).blocks;
  assert.match(block.title, /ヨウジヤマモト/);
  assert.match(block.price, /128,000/);
  assert.equal(block.size, '3');
});

test('malformed mail HTML does not throw', () => {
  for (const bad of ['', null, undefined, '<a href=', '<td>x<td>y']) {
    assert.doesNotThrow(() => blocksFromEmail(bad));
  }
});

// --- through to drafts -------------------------------------------------------

test('an alert email becomes drafts, filed under the venue that sent it', async () => {
  const { parseAlertEmail } = await import('../src/lib/bulkPaste.mjs');
  const sources = [{ id: 'grailed', base_url: 'https://www.grailed.com' }];
  const { drafts } = parseAlertEmail(GRAILED, sources);

  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].sourceId, 'grailed');
  assert.equal(drafts[0].price, 850);
  assert.equal(drafts[0].currency, 'USD');
  assert.equal(drafts[0].sizeRaw, '46');
  assert.equal(drafts[0].url, 'https://www.grailed.com/listings/111-cdg-hp-ad2002-wool-jacket');
  assert.equal(drafts[0].imageUrl, 'https://cdn.grailed.invalid/111.jpg');
  // Which matters more than it looks: Grailed is where you SELL, so a row filed
  // under the catch-all venue could never serve as a comp.
  assert.equal(drafts[1].sourceId, 'grailed');
});

test('a piece from a brand you do not follow is flagged, not silently kept', async () => {
  const { parseAlertEmail } = await import('../src/lib/bulkPaste.mjs');
  const html = `
    <a href="https://www.grailed.com/listings/999-supreme-tee">
      <div>Supreme</div><div>Box logo tee</div><div>$300</div>
    </a>`;
  const [draft] = parseAlertEmail(html, []).drafts;
  assert.equal(draft.needsManualResolution, true);
  assert.ok(draft.warnings.some((w) => /brand not recognised/.test(w)));
});
