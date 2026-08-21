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
import { existsSync, readFileSync } from 'node:fs';
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

});

/**
 * 🔴 THE CONTROL IS RETIRED — ruled 2026-08-21.
 *
 * The copy fixes above were the second attempt to make a two-tap button honest
 * about an irreversible act, and the ruling is that no wording makes it worth
 * offering. CANCELLED is terminal — `PERMITTED_TRANSITIONS` has no edge out of
 * it — and cancelling retires the whole trigger TYPE for that owner: every rule
 * on it, every recipient scoped to it, permanently, from a button sitting beside
 * the one people press in a hurry. Stand down already covers the false alarm
 * this was reached for, it is the prominent default, and it re-arms.
 *
 * So the button and `POST /api/triggers/[id]/cancel` are gone. What is NOT gone
 * is the grace → cancelled edge in the state machine: production holds rows that
 * took it, the CANCELLED card still has to render for them, and deleting the
 * edge would make the state machine unable to describe its own history. It is
 * deliberately caller-less, and lib/release/state-machine.ts says so beside it.
 *
 * These tests pin the retirement in the two places it can quietly come back:
 * a control that reaches the endpoint, and the endpoint itself.
 */
describe('the Cancel control is retired', () => {
  it('no control on the triggers screen calls the cancel endpoint', () => {
    /*
      Matched on the call, not on the word "cancel" — this file and the screen
      both discuss cancellation at length, and a test that grepped for the word
      would fail on its own explanation. What must not exist is a fetch.
    */
    expect(copy(CARD)).not.toMatch(/[/]api[/]triggers[/].*[/]cancel/);
  });

  it('the screen offers no button labelled as a permanent cancellation', () => {
    const src = copy(CARD);
    expect(src).not.toMatch(/Cancel permanently/);
    expect(src).not.toMatch(/Retire it for good/);
  });

  it('the route that served it no longer exists', () => {
    // The button is half of it. A handler with no control in front of it is the
    // shape api-reachability.ts exists to catch, and an owner-authenticated
    // endpoint that permanently retires a trigger is not one to leave lying
    // about because removing the button felt like enough.
    expect(existsSync('src/app/api/triggers/[id]/cancel/route.ts')).toBe(false);
  });

  it('but the grace → cancelled edge SURVIVES, with no caller', () => {
    /*
      Deliberate, and the reason it is asserted rather than assumed: rows in
      production are in `cancelled` and got there through this edge. A tidy-up
      that removed it would leave the state machine unable to account for states
      it can still be asked to read.
    */
    expect(
      PERMITTED_TRANSITIONS.some((t) => t.from === 'grace' && t.to === 'cancelled'),
      'the edge was removed — see the note on it in lib/release/state-machine.ts',
    ).toBe(true);
  });

  it('the CANCELLED card still explains itself, because legacy rows still render', () => {
    // Retiring the way IN must not remove the explanation for everyone already
    // there. A bare badge reads as a bug rather than as a decision.
    expect(copy(CARD)).toMatch(/Retired for good/);
  });

  it('stand down is still offered — the false-alarm path this replaced it with', () => {
    // If this ever fails, the screen has no stop control at all, which is a far
    // worse state than the one the ruling was fixing.
    expect(copy(CARD)).toMatch(/[/]api[/]triggers[/].*[/]stand-down/);
  });
});
