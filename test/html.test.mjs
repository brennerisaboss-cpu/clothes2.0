import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml, decodeEntities } from '../src/lib/html.mjs';
import { walkParsedHtml } from '../src/lib/pastedHtml.mjs';

// This exists so the walk that reads a copied page can also read an alert
// email, on the server, where there is no DOM. It is not a conforming HTML
// parser; it is one that survives what email and listing markup actually
// contains.

test('the tree it builds is the one walkParsedHtml reads', () => {
  const { lines, links } = walkParsedHtml(
    parseHtml(`
      <div class="card">
        <a href="https://shop.invalid/products/1"><img src="https://cdn.invalid/1.jpg"></a>
        <div>Comme des Garçons Homme Plus</div>
        <div>AD2002 wool jacket</div>
        <div>$1,150.00</div>
      </div>`),
  );
  assert.deepEqual(lines, [
    'Comme des Garçons Homme Plus', 'AD2002 wool jacket', '$1,150.00',
  ]);
  assert.equal(links.length, 3);
  assert.equal(links[0][1], 'https://shop.invalid/products/1');
  assert.equal(links[0][2], 'https://cdn.invalid/1.jpg');
});

test('attributes are read in every quoting style mail clients emit', () => {
  const root = parseHtml(`<a href="https://a.invalid/1" id=plain data-x='single'>x</a>`);
  const a = root.childNodes[0];
  assert.equal(a.getAttribute('href'), 'https://a.invalid/1');
  assert.equal(a.getAttribute('id'), 'plain');
  assert.equal(a.getAttribute('data-x'), 'single');
  assert.equal(a.getAttribute('missing'), null);
});

test('unclosed <p> and <td> do not nest the whole message inside the first one', () => {
  // Mail HTML does this constantly. Nested, every later line would sit inside
  // the first cell and inherit its link.
  const root = parseHtml('<table><tr><td>one<td>two<tr><td>three</table>');
  const cells = [];
  const visit = (n) => {
    if (n.nodeName === 'TD') cells.push(n.textContent.trim());
    for (const c of n.childNodes) visit(c);
  };
  visit(root);
  assert.deepEqual(cells, ['one', 'two', 'three']);
});

test('a stray closing tag does not unwind the document', () => {
  const { lines } = walkParsedHtml(parseHtml('<div><div>first</div></section><div>second</div></div>'));
  assert.deepEqual(lines, ['first', 'second']);
});

test('script and style contents are text, not markup', () => {
  const { lines } = walkParsedHtml(
    parseHtml('<style>.a{content:"<div>"}</style><script>if (a<b) {}</script><div>Guidi</div>'),
  );
  assert.deepEqual(lines, ['Guidi']);
});

test('a comment cannot smuggle in a card', () => {
  const { lines, links } = walkParsedHtml(
    parseHtml('<!-- <a href="https://evil.invalid/x">Ghost</a> --><div>Real</div>'),
  );
  assert.deepEqual(lines, ['Real']);
  assert.equal(links.length, 0);
});

test('void and self-closing elements do not swallow what follows', () => {
  const { lines } = walkParsedHtml(
    parseHtml('<div><img src="x.jpg"><br><span>after</span></div><div>next</div>'),
  );
  assert.deepEqual(lines, ['after', 'next']);
});

test('entities are decoded, and an escaped ampersand stays one character', () => {
  assert.equal(decodeEntities('wool &amp; silk'), 'wool & silk');
  assert.equal(decodeEntities('Gar&#231;ons'), 'Garçons');
  assert.equal(decodeEntities('Yamamoto&#8217;s'), 'Yamamoto’s');
  // The one that matters: a doubly-escaped string must not become markup.
  assert.equal(decodeEntities('&amp;lt;3'), '&lt;3');
});

test('malformed input yields what it can rather than throwing', () => {
  for (const bad of ['', '<', '<div', '<<>>', '</div>', '<div><a href=>x</a>', null, undefined]) {
    assert.doesNotThrow(() => parseHtml(bad));
  }
  assert.equal(parseHtml('<div>kept').childNodes[0].textContent, 'kept');
});
