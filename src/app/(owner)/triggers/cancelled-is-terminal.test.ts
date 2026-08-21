/**
 * The CANCELLED card must not promise a way back that does not exist.
 *
 * 🔴 IT DID, until 2026-08-21: "Retired. This trigger cannot be re-armed —
 * recreate the access rule to grant this recipient emergency access again."
 *
 * Every clause after the dash was false, and an owner following it would have
 * believed they had restored emergency access when they had not:
 *
 *   - `release_state` is ONE row per (owner, trigger_type), not one per rule.
 *     Creating a rule calls `ensureReleaseState`, which returns the EXISTING row
 *     whatever its state (provisioning.ts) — so the new rule binds straight back
 *     to the cancelled row.
 *   - PERMITTED_TRANSITIONS has no edge out of `cancelled`, `standDownTrigger`
 *     refuses it, `processCheckin` does not select it, and the heartbeat sweep
 *     only reads ARMED rows. Nothing anywhere moves a cancelled row.
 *   - So `/initiate` answers 409 for that trigger type forever, and it is not
 *     "this recipient" that is affected — it is every recipient whose rule uses
 *     that trigger.
 *
 * the J9 state-machine note in docs/user-journeys.md ("CANCELLED is terminal")
 * specifies the other resolution (re-arming provisions
 * a NEW release_state row). Nothing implements it. Until something does, the
 * screen says what the product actually does. This test is the guard, because
 * the copy and the state machine live in different files and drifted apart once
 * already.
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R12, the J9 state-machine note in docs/user-journeys.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PERMITTED_TRANSITIONS } from '../../../../lib/release/state-machine';

const CARD = 'src/app/(owner)/triggers/TriggersPageClient.tsx';

/** Comments stripped — the file quotes the old copy in order to explain it. */
function copy(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('cancelled is terminal, and the screen says so', () => {
  it('the state machine really has no way out of cancelled', () => {
    // The premise the copy rests on. If someone adds the edge, this fails first
    // and the copy becomes the thing to change, in that order.
    expect(PERMITTED_TRANSITIONS.filter((t) => t.from === 'cancelled')).toEqual([]);
  });

  it('the CANCELLED card does not tell the owner to recreate the access rule', () => {
    expect(copy(CARD)).not.toMatch(/recreate the access rule/i);
  });

  it('the CANCELLED card says the retirement is permanent', () => {
    expect(copy(CARD)).toMatch(/Retired for good/);
  });

  /*
    The scope was wrong as well as the remedy. Cancelling retires the TRIGGER
    TYPE for that owner — every rule that uses it — and the old sentence said
    "this recipient", which reads as one rule out of several.
  */
  it('the confirmation before cancelling names what it actually retires', () => {
    const src = copy(CARD);
    expect(src).toMatch(/every access rule that uses it/i);
    expect(src).not.toMatch(/To stop a false alarm and keep the rule/);
  });
});
