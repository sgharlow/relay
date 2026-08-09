/** @type {import('next').NextConfig} */

/**
 * The deployment's original vercel.app hostname, which stayed live and fully
 * functional after the custom domain landed — including a working owner sign-in.
 *
 * That is worse than an untidy leftover. Relay's own emails were once found
 * pointing at this host, and the fix was written up as a security matter: a raw
 * vercel.app address carrying a token in the query string, arriving during an
 * emergency, is indistinguishable from phishing. Leaving a second place where
 * credentials are genuinely accepted teaches exactly the habit the product
 * needs people not to have.
 *
 * Only this exact host redirects. Preview deployments get their own generated
 * hostnames and must keep working, or every PR becomes unreviewable.
 */
const LEGACY_HOST = 'relay-three-henna.vercel.app';

const nextConfig = {
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: LEGACY_HOST }],
        destination: `https://relaystandby.com/:path*`,
        // Permanent: search engines and any inbox still holding an old link
        // should learn the real home, not keep resolving to a mirror.
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
