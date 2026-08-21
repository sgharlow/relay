/**
 * Answering a challenge is a sign of life, and it recorded none.
 *
 * 🔴 THE CASE THAT MATTERS MOST IS THE DENIAL. An owner who reads "your daughter
 * is asking for access" and answers "I'm fine — no" has just proved, personally
 * and deliberately, that they are alive and holding their own account. That is
 * the exact fact `last_active_at` exists to hold. This handler called
 * `requireOwner()` with no `req`, so nothing was stamped — and
 * `runHeartbeatSweep` re-reads overdue owners against that column. The person
 * most visibly present in the product stayed, in its eyes, silent.
 *
 * `lib/http/owner-route.ts` says the coverage rule out loud: "Pass `req` to also
 * record passive liveness ([A4]) — writes count, reads do not. ⚠️ COVERAGE IS
 * OPT-IN AND THAT IS A KNOWN LIMIT: a route that does not pass `req` records
 * nothing." docs/user-journeys.md J5-R1 promises liveness derived from
 * authenticated product activity, and the user guide (quoted in
 * lib/release/liveness-coverage.test.ts) promises "any deliberate action in the
 * product counts as checking in".
 *
 * ⚠️ NOT ADDED TO THAT FILE'S `MUST_RECORD` LIST HERE. That enumeration is the
 * portfolio-wide answer and belongs with the release code; this asserts the one
 * route, so the fix is held in place either way.
 *
 * Feature: relay-h0-mvp
 * Requirements: J5-R1, J6-R4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROUTE = 'src/app/api/access-requests/[id]/respond/route.ts';

const src = () =>
  readFileSync(ROUTE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

describe('the owner’s answer counts as checking in', () => {
  it('passes the request to requireOwner, which is what records it', () => {
    expect(
      src(),
      `${ROUTE} calls requireOwner() with no request, so answering a challenge stamps nothing`,
    ).toMatch(/requireOwner\(\s*req\s*\)/);
  });

  it('does not call the bare form anywhere in the handler', () => {
    // Belt and braces: adding a second call site with no `req` would restore the
    // gap while the assertion above still passed.
    expect(src()).not.toMatch(/requireOwner\(\s*\)/);
  });
});
