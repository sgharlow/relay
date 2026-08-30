/**
 * Which HTTP handlers establish who is calling them.
 *
 * THE GAP THIS FILLS IS ONE THE CODEBASE ALREADY NAMED. `api-reachability.ts`
 * lists what it cannot catch, and the second entry is "a route that IS called
 * but missing a guard its sibling has (the import cap)". `body-limit.ts` closed
 * that for request bodies and `step-up-guard.ts` for elevation. Authentication —
 * the guard every one of those presupposes — had no such check at all. Seventy-
 * five handlers, and a seventy-sixth added without a session read would have
 * been invisible to CI, to the reachability sweep, and to review.
 *
 * NOTHING WAS BROKEN WHEN THIS WAS WRITTEN (2026-08-15). Every route resolved to
 * either an authenticator or a deliberate public entry below, including the one
 * that looked alarming — `/api/vault/items` authenticates through `resolveActor`,
 * which reads `getOwnerSession` and returns its 401. The value here is not a
 * defect found; it is that the property is now asserted instead of assumed.
 *
 * WHAT COUNTS AS AUTHENTICATING. Three shapes, all legitimate:
 *   - a SESSION read (`requireOwner`, `getOwnerSession`, `resolveActor`);
 *   - a SCOPED TOKEN verified (`verifyRecipientToken`, `verifyVerifierToken`);
 *   - a SHARED SECRET or signature checked (`timingSafeEquals` for the cron,
 *     `constructEvent` for Stripe, the Svix verifier for Resend).
 *
 * A CREDENTIAL IN THE REQUEST IS NOT THE SAME AS BEING PUBLIC, and the entries
 * below say which they are. `/api/access/code` takes an emailed code and calls
 * `redeemRecipientCode` — that IS authentication, it simply arrives in the body
 * rather than a cookie. Collapsing the two into one word would make the public
 * list read as longer and less considered than it is.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody trusts it further than it goes:
 *  - authentication on the wrong branch, or after the work it should gate.
 *    Placement is judgement and belongs in review.
 *  - AUTHORIZATION. Knowing who someone is says nothing about whether this row
 *    is theirs; that is `lib/db/integrity.ts`'s job and it is not tested here.
 *  - a handler defined outside `src/app/api`.
 *
 * Textual and conservative, like its siblings: it errs toward calling something
 * authenticated, so its failure mode is a missed alarm rather than a false one
 * that teaches people to ignore the check.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments, routePathOf } from './body-limit';

const BACKSLASH = String.fromCharCode(92);

/** Calls that establish a principal. See the header for the three shapes. */
export const AUTHENTICATORS = [
  // Session
  'requireOwner',
  'getOwnerSession',
  'resolveActor',
  // Scoped token
  'verifyRecipientToken',
  'verifyVerifierToken',
  // Shared secret / signature
  'timingSafeEquals',
  'constructEvent',
  'verifySvixSignature',
  // A single-use code redeemed from the request. Authentication that arrives in
  // the body instead of a cookie is still authentication.
  'redeemRecipientCode',
  'redeemVerifierCode',
  'redeemBreakGlass',
] as const;

/**
 * Handlers that deliberately do not authenticate, and why.
 *
 * Every entry argues for itself. This is not somewhere to park a route because
 * wiring auth is inconvenient — that is exactly how sixteen unbounded body
 * reads accumulated in this codebase in 2026-08.
 */
export const PUBLIC_ROUTES: Record<string, string> = {
  '/api/auth/[...nextauth]':
    'NextAuth’s own handler. It IS the sign-in endpoint — every provider in ' +
    'lib/auth/auth-options.ts does its own verification inside `authorize`, and ' +
    'requiring a session to obtain one is a deadlock.',
  '/api/auth/signup':
    'Creating an account is by definition something an unauthenticated person ' +
    'does. It rate-limits and validates rather than authenticates, and it must ' +
    'not reveal whether an address is already registered.',
  '/api/auth/recover':
    'The way back in when the authenticator is gone. It consumes a recovery ' +
    'code, which is the credential — demanding a session first would lock out ' +
    'exactly the person this route exists for.',
  '/api/access/resend':
    'Re-sends an access code to the address already on the recipient row; it ' +
    'takes no credential and returns nothing about whether the address matched. ' +
    'Rate-limited, because an unauthenticated send is a spend of sending ' +
    'reputation.',
  '/api/verify/resend':
    'The verifier half of /api/access/resend, on the same terms and for the ' +
    'same reason: a verifier who lost the email must be able to ask for it ' +
    'again without holding anything.',
  '/api/invitations/[token]/opened':
    'Marks an invitation as opened. The unguessable token in the PATH is the ' +
    'credential, and the handler writes one timestamp and reveals nothing — it ' +
    'is the read-receipt for a message that person was sent.',
  '/api/caregivers/interest':
    'The G1 lead form on a public marketing page. Anonymous by construction; ' +
    'bounded by rate limiting and bot signals rather than by identity.',
  '/api/support':
    'The contact form. Somebody who cannot sign in is precisely the person who ' +
    'most needs to reach a human, so requiring a session would defeat it.',
  '/api/csp-report':
    'A Content-Security-Policy violation report, posted by the BROWSER, which ' +
    'cannot attach credentials. It answers a constant 204 and is rate-limited.',
  '/api/incident':
    'Client-side error reports from a page that may itself be broken. Answers a ' +
    'constant 204 to everything, including its own refusals, so it reveals ' +
    'nothing and cannot be probed.',
  '/api/health/scheduler':
    'The CC9 dead-man’s-switch probe. An external monitor must reach it ' +
    'WITHOUT credentials or the monitoring is as fragile as the thing it ' +
    'watches. It exposes a timestamp, an age and a boolean.',
  '/api/health/delivery-webhook':
    'The same contract for mail-delivery telemetry: aggregate counts and an age, ' +
    'no addresses and no identifiers, reachable by a monitor that holds nothing.',
  '/api/health/reminders':
    'The same contract again, for the check-in reminder ladder: counts, rung ' +
    'names and ages, and deliberately no owner id and no address — the finding ' +
    'is “somebody was not warned”, never “this person was not warned”. A ' +
    'monitor must reach it without credentials or it shares fate with the cron.',
  '/api/webauthn/authenticate/options':
    'Deliberately unauthenticated AND identifier-free — it takes no email, looks ' +
    'nothing up, and returns the same shape to everyone, so there is no account ' +
    'to enumerate. Requiring a session to start a sign-in is a deadlock.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p.split(BACKSLASH).join('/'));
  }
  return out;
}

/** Does this handler file call anything that establishes a principal? */
export function authenticates(source: string): boolean {
  const src = stripComments(source);
  return AUTHENTICATORS.some((a) => new RegExp(`\\b${a}\\s*\\(`).test(src));
}

export interface UnauthenticatedRoute {
  route: string;
  methods: string[];
}

/**
 * Handlers that neither authenticate nor are declared public.
 *
 * A file with no exported HTTP method is skipped rather than reported — it
 * exports config or types, and `api-reachability.ts` is what notices a handler
 * that exists and is never called.
 */
export function findUnauthenticatedRoutes(repoRoot = '.'): UnauthenticatedRoute[] {
  const root = repoRoot.split(BACKSLASH).join('/').replace(/\/$/, '');
  const rel = (p: string) => p.split(BACKSLASH).join('/').replace(root + '/', '');

  const out: UnauthenticatedRoute[] = [];

  for (const abs of walk(join(repoRoot, 'src', 'app', 'api'))) {
    const f = rel(abs);
    if (!/\/route\.ts$/.test(f) || f.includes('.test.')) continue;

    const route = routePathOf(f);
    if (PUBLIC_ROUTES[route]) continue;

    const source = readFileSync(abs, 'utf8');
    const methods = [
      ...stripComments(source).matchAll(
        /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
      ),
    ].map((m) => m[1]);

    if (methods.length === 0) continue;
    if (authenticates(source)) continue;

    out.push({ route, methods });
  }

  return out;
}
