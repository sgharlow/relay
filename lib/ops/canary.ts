/**
 * What "production is working" means, expressed as assertions.
 *
 * WHY THIS EXISTS. It was written when Next 14 gave no global hook for route
 * errors, so anything in-app covered only the handlers someone remembered to
 * wrap — the wrong shape for catching a failure nobody anticipated. And the
 * failure nobody anticipated is the normal case: on 2026-08-08 a validly signed
 * verifier link returned an unhandled 500 in production, behind a fully green
 * suite of a thousand tests, and it was found by a person poking at it by hand.
 *
 * ⚠️ THAT PREMISE IS NO LONGER THE WHOLE STORY, and this header said it was
 * until 2026-08-21. Next 16's `onRequestError` DOES give a global server-error
 * hook, and `lib/ops/error-reporter.ts` is what it calls. The two are
 * complements, not substitutes, and the distinction is the reason this file
 * survives the upgrade: the hook reports errors the application THREW, from
 * inside it. This asserts, from outside and on a schedule, that the refusals
 * still refuse — a boundary that quietly starts saying 200 throws nothing for
 * any hook to catch.
 *
 * These are deliberately assertions about BEHAVIOUR rather than liveness. That
 * a page returns 200 proves close to nothing — every page in this app returned
 * 200 the entire time the verifier link was broken. That a forged token is
 * refused proves the authorization boundary is still standing.
 *
 * THE RULES THIS FILE OBEYS:
 *   - no credentials, so it can run anywhere, including a public CI runner
 *   - no writes, so it can run every fifteen minutes forever without filling
 *     the cluster with canary rows
 *   - every check states its consequence, because a canary that fails with
 *     "check 4 failed" at 3am is a canary that gets muted
 *
 * Feature: relay-h0-mvp (CC9)
 */

export interface CanaryCheck {
  /** Short label, used in output. */
  name: string;
  /** Path appended to the base URL. */
  path: string;
  method?: 'GET' | 'POST';
  /** Sent only for POST checks; never contains anything secret. */
  body?: string;
  contentType?: string;
  expectStatus: number;
  /** Substrings that must all appear in the body. Status alone is weak. */
  expectBodyContains?: string[];
  /** What it means for a human if this fails. Required. */
  meaning: string;
}

export interface CanaryResult {
  ok: boolean;
  detail: string;
}

/**
 * A token that is well-formed but signed with nothing. It cannot verify under
 * any secret, so it is safe to hard-code and safe to make public: it proves the
 * verifier refuses forgeries without the canary ever holding a real key.
 */
const FORGED_VERIFIER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJ2ZXJpZmllcklkIjoiY2FuYXJ5IiwicmVsZWFzZVN0YXRlSWQiOiJjYW5hcnkiLCJpYXQiOjAsImV4cCI6OTk5OTk5OTk5OX0' +
  '.this-signature-is-not-valid-and-never-will-be';

export const CHECKS: CanaryCheck[] = [
  {
    name: 'landing page serves',
    path: '/',
    expectStatus: 200,
    meaning: 'The site is down. Nobody arriving from any channel can reach anything.',
  },
  {
    name: 'caregiver landing serves',
    path: '/caregivers',
    expectStatus: 200,
    expectBodyContains: ['Relay'],
    /*
      🔴 THIS SAID "The page every paid click lands on is down. Ad spend
      continues while the traffic it buys hits nothing." Paid advertising was
      retired on 2026-08-16 (PROJECT.yaml ratified.retire-paid-advertising), so
      the consequence this printed at 3am was about a flight that no longer
      exists — and a check whose stated consequence is untrue is a check that
      gets read once and then muted. That is this file's own rule, four lines
      into its header.
    */
    meaning:
      'The landing page every editorial placement points at is down. Op-eds are the ratified ' +
      'channel and they carry a URL that cannot be corrected once published, so the readers a ' +
      'piece sends arrive at nothing and the g1 demand gate reads their absence as no interest.',
  },
  {
    name: 'signup page offers enrolment',
    path: '/auth/signup',
    expectStatus: 200,
    expectBodyContains: ['Create your vault', 'authenticator'],
    meaning:
      'Nobody can create an account. The funnel measures intent it can no longer convert, so the gate reads as absent demand.',
  },
  {
    name: 'forged verifier token refused',
    path: `/api/verify/${FORGED_VERIFIER_TOKEN}`,
    expectStatus: 403,
    meaning:
      'The verifier authorization boundary is not behaving. A 500 here is the regression fixed on 2026-08-08; anything 2xx would mean forged links are being honoured.',
  },
  {
    name: 'checkout requires a session',
    path: '/api/stripe/checkout',
    method: 'POST',
    expectStatus: 401,
    meaning:
      'Anyone can start a subscription anonymously. Sessions would be created against no owner, and the webhook would have no one to grant.',
  },
  {
    name: 'forged stripe webhook refused',
    path: '/api/stripe/webhook',
    method: 'POST',
    contentType: 'application/json',
    body: '{"type":"checkout.session.completed","data":{"object":{"metadata":{"owner_id":"canary"}}}}',
    expectStatus: 400,
    meaning:
      'Signature verification on the billing webhook is not working. That endpoint grants paid entitlement, so accepting an unsigned payload means anyone can grant themselves a subscription.',
  },
];

/** Judges one response against its check. */
export function evaluateCheck(
  check: CanaryCheck,
  response: { status: number; body: string },
): CanaryResult {
  if (response.status !== check.expectStatus) {
    return {
      ok: false,
      detail: `expected HTTP ${check.expectStatus}, got ${response.status}`,
    };
  }

  for (const needle of check.expectBodyContains ?? []) {
    if (!response.body.includes(needle)) {
      return {
        ok: false,
        detail: `HTTP ${response.status} as expected, but the body is missing ${JSON.stringify(needle)} — the page is rendering its shell without its substance`,
      };
    }
  }

  return { ok: true, detail: `HTTP ${response.status}` };
}
