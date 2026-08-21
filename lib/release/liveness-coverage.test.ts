/**
 * Which owner actions count as being alive.
 *
 * 🔴 THE MANUAL PROMISED MORE THAN THE PRODUCT DID. "Any deliberate action in
 * the product counts as checking in, so ordinary use keeps it quiet — you are
 * not being asked to remember a chore." Eight routes recorded liveness, and the
 * ones an owner actually uses most did not: adding a vault item, importing a
 * password-manager export, answering a helper's proposal, changing the account.
 *
 * The consequence was the failure the manual itself names as the dangerous one —
 * not "it opened too late" but "it opened when nothing was wrong". An owner
 * filling their vault every week for a month, who never happened to open the
 * People or Rules screen, was swept into a PENDING release and had their
 * verifiers emailed to ask whether they were dead.
 *
 * This asserts the wiring, because the coverage is opt-in per route: the
 * structural fix is Node-runtime middleware over /api/*, deliberately not taken
 * (it changes the path of every request and this data layer needs `pg`). Opt-in
 * coverage without a test is a list that silently stops being true.
 *
 * Feature: relay-standby
 * Requirements: 4.2
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** Routes where a WRITE means a person is present and operating. */
const MUST_RECORD = [
  'src/app/api/vault/items/route.ts',
  'src/app/api/vault/items/[id]/route.ts',
  'src/app/api/import/route.ts',
  'src/app/api/account/route.ts',
  'src/app/api/approvals/[id]/route.ts',
  'src/app/api/delegations/route.ts',
  'src/app/api/rules/route.ts',
  'src/app/api/recipients/route.ts',
  'src/app/api/verifiers/route.ts',
  'src/app/api/policies/route.ts',
  /*
    Added 2026-08-21. Not "a write, therefore liveness" like the rest of this
    list — this one is load-bearing. A release the cron armed sits on an ARMED
    row the moment it is stood down, and the sweep re-reads ARMED rows against
    `last_active_at`. Without the stamp the same owner is re-armed and every
    verifier re-asked at the top of every hour, forever, because standing down
    was not evidence that the person who stood it down exists.
  */
  'src/app/api/triggers/[id]/stand-down/route.ts',
];

describe('liveness coverage', () => {
  for (const route of MUST_RECORD) {
    it(`${route} records a deliberate write`, () => {
      const src = readFileSync(route, 'utf8');
      const wired =
        /requireOwner\(\s*(?:req|_?req)\s*\)/.test(src) || /recordDeliberateActivity\(/.test(src);
      expect(wired).toBe(true);
    });
  }

  /*
    §3.7 RULE 8. A helper tidying somebody's vault must not mark that somebody
    alive — the scenario the switch exists for is the owner in hospital while a
    relative keeps things running. The delegate-capable route must therefore pass
    `actingForOwnerId`, which discards the write when the two differ, rather than
    stamping whatever owner the request happened to target.
  */
  it('the delegate-capable vault route cannot extend the OWNER liveness', () => {
    const src = readFileSync('src/app/api/vault/items/route.ts', 'utf8');
    expect(src).toContain('actingForOwnerId');
    expect(src).toMatch(/userId:\s*actor\.actingUserId/);
  });

  /*
    A helper PROPOSING is acting for somebody else in both directions: it is not
    the owner's liveness, and it is not evidence about the helper's own vault
    either. This route must stay silent.
  */
  it('the proposal route records nothing', () => {
    const src = readFileSync('src/app/api/approvals/route.ts', 'utf8');
    expect(src).not.toMatch(/requireOwner\(\s*req\s*\)/);
    expect(src).not.toContain('recordDeliberateActivity(');
  });
});
