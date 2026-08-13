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
  /**
   * 🔴 THE USER'S GUIDE WAS WRITTEN AND NEVER SHIPPED, found by the pre-release
   * audit on 2026-08-13. Forty-two sections covering setup, the day it matters
   * and what to do when something goes wrong — sitting in `docs/`, with no
   * public directory, no route and no link. A test
   * (lib/billing/beta-flag.test.ts) was already guarding a promise made in §2.7
   * of a document no user could open.
   *
   * The file now lives at `public/guide/index.html` and is the ONLY copy: the
   * served artifact and the one the test reads are the same bytes, so the guard
   * cannot start watching a stale duplicate.
   *
   * Static assets under `public/` are served at their literal path, so
   * `/guide` alone would 404 — Next does not resolve a directory to its
   * index.html. This rewrite makes the short URL work, which matters because
   * `/guide` is what goes in an invitation email and on the help page.
   */
  async rewrites() {
    return [{ source: '/guide', destination: '/guide/index.html' }];
  },

  async redirects() {
    return [
      {
        // "Recipients & Verifiers" and "Your circle" were two nav entries for
        // one idea, which asked an owner to know an internal distinction in
        // order to find anyone. /circle is now People and does both jobs.
        // Permanent, so bookmarks and any older emailed link move with it.
        source: '/recipients',
        destination: '/circle',
        permanent: true,
      },
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
