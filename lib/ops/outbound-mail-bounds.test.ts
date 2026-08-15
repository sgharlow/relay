/**
 * Every way an authenticated caller can make Relay send mail is bounded.
 *
 * 🔴 THE FINDING, 2026-08-13. Relay sends email from a domain with real
 * reputation, on a Resend account SHARED with another project. Signup is
 * self-serve and free. And the two routes that put an address into that path
 * were the two with no bound of any kind: `POST /api/verifiers` had no
 * entitlement cap (its sibling `/api/recipients` had one from the day the tier
 * existed) and `POST /api/invitations` had no rate limit and no daily ceiling.
 * `BETA_INVITE_CHANNEL='owner'` did not cover it, because that flag governs
 * create-time only — the invitations route takes its own `deliveryChannel` and
 * defaults it to `email`.
 *
 * WHY A CROSS-CUTTING TEST RATHER THAN THREE LOCAL ONES. Every individual piece
 * was already "correct" in isolation; what was missing was the property that
 * holds across them. lib/ops/api-reachability.ts exists for exactly this reason
 * one layer up, and its header names the class this belongs to: "a route that IS
 * called but missing a guard its sibling has."
 *
 * It reads SOURCE rather than exercising handlers, deliberately. A behavioural
 * test proves the path it happens to walk; this fails when somebody adds a
 * fourth route that sends mail and forgets, which is the thing that will
 * actually happen.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');
/** Comments out — a note ABOUT a cap must never satisfy a check FOR one. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('naming a person is capped on both sides of the circle', () => {
  it('the free tier bounds verifiers as well as recipients', () => {
    const src = code('lib/billing/entitlements.ts');
    expect(src).toContain('verifiers:');
    expect(src).toContain('assertWithinVerifierCap');
  });

  it.each([
    ['src/app/api/recipients/route.ts', 'assertWithinRecipientCap'],
    ['src/app/api/verifiers/route.ts', 'assertWithinVerifierCap'],
  ])('%s enforces its cap', (route, guard) => {
    expect(code(route)).toContain(guard);
  });

  it('both routes answer the cap with a status a client can act on', () => {
    for (const route of ['src/app/api/recipients/route.ts', 'src/app/api/verifiers/route.ts']) {
      const src = code(route);
      expect(src).toContain('EntitlementError');
      expect(src, `${route} must answer 402, not 500`).toContain('402');
    }
  });
});

describe('sending an invitation is bounded in both dimensions', () => {
  /*
    THE DURABLE CEILING LIVES IN inviteAndNotify, not in the route, because three
    callers reach the mail send: the invitations route and
    inviteOnCreateBestEffort from each of the two people routes. A guard in one
    route would bound one third of the surface and read as though it bound all of
    it.
  */
  it('the shared send path reserves budget before it sends', () => {
    const src = code('lib/people/invite.ts');
    expect(src).toContain('reserveInviteEmail');

    const reserveAt = src.indexOf('reserveInviteEmail');
    const sendAt = src.indexOf('notifyInvitation({');
    expect(reserveAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(-1);
    expect(reserveAt, 'the meter must tick before the money leaves').toBeLessThan(sendAt);
  });

  it('the invitations route also carries a burst limit', () => {
    const src = code('src/app/api/invitations/route.ts');
    expect(src).toContain('rateLimit(');
    expect(src, 'keyed on the account, not the IP — the caller is authenticated').toContain(
      'auth.ownerId',
    );
    expect(src).toContain('429');
  });

  /*
    The owner-delivered arm transmits nothing at all, so metering it would
    throttle the arm this architecture prefers in order to bound a cost it does
    not incur. Asserted so a later "simplification" cannot quietly meter both.
  */
  it('does not spend budget on the arm that sends nothing', () => {
    const src = code('lib/people/invite.ts');
    expect(src).toMatch(/deliveryChannel === 'email'[\s\S]{0,120}reserveInviteEmail/);
  });
});

/*
  THE OTHER HALF OF THE SAME PROPERTY, added 2026-08-14. Everything above bounds
  what an AUTHENTICATED CALLER can make Relay send. Nothing bounded what an
  UNATTENDED JOB can send — and the cron is the more dangerous sender, because
  nobody is watching and there is no owner to stop it.

  THE RULE, derived by reading production rather than the code. `demo@relay.test`
  is a live seeded account whose OWNER address sits in a reserved domain that can
  never receive mail; `email_delivery_events` already holds 18 rows for it, every
  one a delivery failure. Mail to it hard-bounces on a Resend account SHARED with
  report-bridge, so the reputation cost lands on a different project — and sender
  reputation is precisely the surviving explanation for the Outlook junk-filing
  this product has been chasing since 2026-08-09. An unattended job that quietly
  burns it is attacking our own deliverability.

  WHERE THE GUARD BELONGS, and where it deliberately does NOT:

    ✅ unattended ORIGINATION — `runHeartbeatSweep` arming a trigger nobody asked
       for. Guarded since 2026-08-13.
    ✅ unattended OWNER-DIRECTED mail — `sweepSilentVerifiers` writes to
       `users.email`, which for the demo account IS the reserved address.
       Guarded 2026-08-14, after this test's rule was written.
    ⛔ `resolveElapsedGrace` and `escalateLapsedRequests` — CHECKED AND
       CORRECTLY UNGUARDED. Both mail CONTACTS, not the owner, and the seed's
       contacts were deliberately made deliverable (lib/seed/demo-data.ts); the
       live table shows them delivering 14/14. A demo can only reach those states
       via /api/demo/simulate, which is explicit and driven by a person who meant
       it, so completing it is the intended behaviour rather than a stray send.

  So the test is narrow on purpose: it pins the two paths that must be guarded
  without forcing the guard onto the two that must not be.
*/
describe('an unattended job cannot mail a seeded account at its reserved address', () => {
  it.each([
    ['lib/release/heartbeat.ts', 'arms triggers nobody asked for'],
    ['lib/release/silence-sweep.ts', 'writes to users.email'],
  ])('%s excludes demo accounts — it %s', (path) => {
    expect(code(path)).toContain('is_demo_account');
  });

  /*
    A JOIN, not a post-hoc filter. A row that must never be mailed should never
    be fetched, so no later edit can reach past the guard by iterating the list
    it was handed. Structural safety over convention.
  */
  it('the silence sweep filters in SQL rather than in JavaScript', () => {
    const src = code('lib/release/silence-sweep.ts');
    expect(src).toMatch(/JOIN\s+users[\s\S]{0,80}is_demo_account\s*=\s*false/);
  });
});

describe('what an attacker would put in the message is bounded too', () => {
  it('a contact name is cleaned by the one shared definition', () => {
    for (const p of ['lib/people/recipients.ts', 'lib/people/verifiers.ts']) {
      expect(code(p), `${p} must not accept a raw name`).toContain('cleanPersonName');
    }
  });

  /*
    🔴 THE OWNER'S DISPLAY NAME IS THE SUBJECT LINE. `.trim()` strips newlines
    from the ends and keeps every one in the middle, and both doors onto this
    field used it. Collapsing is the fix, and both doors must apply it or the
    guard holds only for whichever one was tested.
  */
  it.each(['src/app/api/account/route.ts', 'lib/auth/signup.ts'])(
    '%s collapses whitespace in the display name rather than only trimming it',
    (p) => {
      expect(code(p)).toMatch(/replace\(\/\\s\+\/g, ' '\)/);
    },
  );
});
