/** @type {import('next').NextConfig} */
export default {
  // Source image URLs are stored and rendered directly rather than re-hosted,
  // so there is no image optimiser config to maintain per shop.
  reactStrictMode: true,

  experimental: {
    serverActions: {
      // A pasted page arrives with its links: for a 96-item search page that
      // is about 60KB, and an infinite-scroll page you have scrolled for a
      // while is several times that. The 1MB default would start refusing the
      // biggest pastes — the ones most worth pasting — and the failure would
      // read as "parse did nothing" rather than as a limit. Nothing here is
      // exposed to the network by default, so the usual reason for the cap
      // does not apply.
      bodySizeLimit: '8mb',
    },
  },
};
