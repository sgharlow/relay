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

/**
 * Response headers, applied to every route.
 *
 * 🔴 THERE WERE NONE AT ALL until 2026-08-13 — no headers() here, no
 * middleware.ts, nothing in vercel.json. For a product whose security model is
 * "plaintext only ever exists in the browser", the headers that constrain what
 * a browser will do with that page are not decoration; they are the second half
 * of the design.
 *
 * DELIBERATELY THE FOUR THAT CANNOT BREAK A PAGE. Content-Security-Policy is
 * the one that matters most and it is NOT here, because an enforcing policy
 * needs nonces for Next's inline bootstrap scripts, which needs a Node-runtime
 * middleware on the path of every request — the change lib/http/owner-route.ts
 * already declined to make for passive liveness. It ships next, report-only
 * first, once a real beta has said what it actually violates. Shipping these
 * four now buys most of the clickjacking and downgrade protection at no risk of
 * blanking a screen for somebody mid-emergency.
 */
const SECURITY_HEADERS = [
  /*
    One year, no preload. Long enough to be meaningful, and deliberately NOT
    submitted to the preload list: preload is close to irreversible, and a
    product this young should not hand a browser a promise it cannot take back.
  */
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },

  /*
    The app frames nothing and is embedded nowhere. DENY rather than
    SAMEORIGIN because stand-down, cancel and release are one-click controls
    whose whole risk profile is somebody clicking them without meaning to —
    which is what clickjacking is. frame-ancestors 'none' joins this in S2b;
    both are kept because older browsers honour only the header.
  */
  { key: 'X-Frame-Options', value: 'DENY' },

  { key: 'X-Content-Type-Options', value: 'nosniff' },

  /*
    Matters more here than on most sites: the unclaimed-contact fallback still
    puts ?token= in a URL, and the default policy would leak that whole URL to
    any off-site link a recipient follows from an access screen.
  */
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  /*
    ONLY the features nothing in this product uses. WebAuthn is gated by
    publickey-credentials-get / -create, whose default allowlist is already
    'self' — naming them here to be thorough is how a passkey sign-in gets
    broken by a header nobody suspects. Omission is the safer instruction.
  */
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },

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
