/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { allowedOrigins: ['*'] } },
  // /home renders the same content as /my-pickups. The header's Home
  // button uses /home so the URL bar matches the label; old /my-pickups
  // links (emails, manifest, callbacks) keep working unchanged.
  async rewrites() {
    return [{ source: '/home', destination: '/my-pickups' }];
  },
  // Aggressive cache headers for static images we know never change once
  // committed. The kid photos + icons make up ~90 KB per cold visit; with
  // immutable caching the browser fetches them exactly once forever and
  // every subsequent navigation skips the network entirely for them.
  async headers() {
    return [
      {
        source: '/kids/:file*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/icon.png',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/apple-icon.png',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/icon-:size.png',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
