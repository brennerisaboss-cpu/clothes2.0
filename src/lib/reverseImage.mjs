// Reverse image search links.
//
// The brief's cheap matching layer: rather than an automated matcher, put the
// listing's own photo in front of a search engine and let a human decide. For
// Comme des Garçons this doubles as counterfeit screening, which matters more
// than match throughput.
//
// These are plain URLs you click. Nothing is fetched, submitted or automated
// here — the link opens in your browser under your own session.

const ENGINES = [
  {
    id: 'google',
    label: 'Google Lens',
    build: (url) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'yandex',
    label: 'Yandex',
    // Consistently the strongest of the three on garments and prints.
    build: (url) => `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(url)}`,
  },
  {
    id: 'tineye',
    label: 'TinEye',
    // Exact-match oriented: good for spotting the same photo reused across
    // listings, which is how relists and stolen photos show up.
    build: (url) => `https://tineye.com/search?url=${encodeURIComponent(url)}`,
  },
];

/**
 * @returns {{ id: string, label: string, href: string }[]} empty when there is
 * no usable image, so callers render nothing rather than a dead link.
 */
export function reverseImageLinks(imageUrl) {
  if (!imageUrl) return [];
  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return [];
  }
  // Engines cannot fetch a data: or blob: URI, and a relative path is not
  // addressable from outside this app.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];

  return ENGINES.map((e) => ({ id: e.id, label: e.label, href: e.build(parsed.toString()) }));
}
