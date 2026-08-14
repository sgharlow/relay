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

  /*
    CONTENT-SECURITY-POLICY, ENFORCING — but only the directives that cannot
    blank a page.

    🔴 SHIPPING EVERYTHING REPORT-ONLY WAS COSTING PROTECTION THAT WAS FREE,
    found by the 2026-08-13 release audit. The argument below for report-only is
    entirely correct about `script-src`, and entirely irrelevant to the four
    directives here — none of which has anything to do with Next's inline
    bootstrap, and none of which can stop a page rendering:

      base-uri       a <base> tag injected into a page can silently repoint
                     every relative URL on it. Nothing in this product emits
                     one, so 'self' costs nothing and closes the whole class.
      object-src     no <object>/<embed> anywhere; 'none' is free.
      frame-ancestors  already enforced by X-Frame-Options: DENY above, which
                     has been live and breaking nothing. This is the same
                     instruction in the form newer browsers read.
      form-action    every form in the app is an onSubmit handler with no
                     `action` attribute, verified before enforcing; Stripe
                     checkout is a redirect, not a cross-origin POST.

    WHAT IS DELIBERATELY ABSENT: default-src, script-src, style-src, img-src,
    connect-src and font-src. An omitted directive is not enforced at all, so
    this header restricts scripts and network access exactly as much as no
    header does — which is the point. Those stay in the report-only policy
    below until real traffic says what they would break.

    A test pins the split in both directions: this header must exist, and it
    must never grow a directive that can blank a screen.
  */
  {
    key: 'Content-Security-Policy',
    value: [
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
  },

  /*
    CONTENT-SECURITY-POLICY, IN REPORT-ONLY MODE — the second half of the
    client-side-encryption design, arriving carefully.

    This product decrypts vault plaintext IN THE BROWSER. CSP is the control
    that decides what an injected script may do with what is sitting in that
    page's memory, so it matters here more than on almost any other site. It is
    also the header most able to blank a screen for somebody mid-emergency,
    which is why this ships REPORT-ONLY: the browser evaluates the policy,
    reports what it would have blocked to /api/csp-report, and renders the page
    regardless. Report-only cannot break a page by construction.

    'unsafe-inline' and 'unsafe-eval' in script-src are what make this
    report-only rather than enforcing. Next's bootstrap emits inline scripts, so
    an enforcing policy needs per-request nonces, which needs Node-runtime
    middleware on the path of every request — the change owner-route.ts already
    declined to make for passive liveness. Enforcing with those two directives
    still present would buy very little; enforcing without them, today, would
    break the app. So the honest sequence is: observe real traffic, remove what
    nothing needs, then take the middleware decision on evidence.

    frame-ancestors IS meaningful even here — it duplicates X-Frame-Options
    above, which is deliberate: the header is what older browsers honour, and
    this is what newer ones do.
  */
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Stripe checkout is a REDIRECT, not an embed, so no frame-src for it.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // data: covers the locally-generated TOTP enrolment QR, which is encoded
      // in-process precisely so the secret never reaches a third party.
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://vitals.vercel-insights.com",
      'report-uri /api/csp-report',
      'report-to csp',
    ].join('; '),
  },

  /*
    The modern half of reporting. `report-uri` is deprecated but still the only
    thing several browsers implement; `report-to` needs this companion header to
    name the group. Both ship, because collecting from only some browsers looks
    identical to a clean policy.
  */
  { key: 'Reporting-Endpoints', value: 'csp="/api/csp-report"' },
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
    return [
      { source: '/guide', destination: '/guide/index.html' },
      /*
        Browsers probe /favicon.ico by convention even when the document links an
        icon, and Next's app-router convention file is `icon.svg` — so every page
        load was producing a 404. Harmless in itself; the cost is that a log full
        of routine 404s is a log in which a real one is invisible, and this is the
        product whose incident path was built because failures were going unseen.

        A rewrite rather than a committed .ico: one icon, one source of truth. If
        it is ever redrawn, there is no second file to forget.
      */
      { source: '/favicon.ico', destination: '/icon.svg' },
    ];
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
