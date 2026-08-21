/**
 * The Triggers screen must not offer a ceremony for a withdrawn capability.
 *
 * 🔴 IT DID, until 2026-08-21, on a branch nobody could reach. `TriggerCard`
 * computed `reversible = rs.trigger_type !== 'estate'` and gave the
 * non-reversible case its own confirmation: "A estate handover cannot be
 * undone", "what you set aside passes to them permanently", "Relay waits three
 * days after they agree before it completes", a type-the-word input, and a
 * button reading "Hand over permanently".
 *
 * Estate was withdrawn PERMANENTLY on 2026-08-14 (`gates.g2-counsel-opinion`
 * declined). Relay confers no legal authority on anyone and offers no
 * inheritance capability. `USER_SELECTABLE_TRIGGER_TYPES` excludes it and
 * `/api/triggers/[type]/initiate` answers 400 — so an owner who somehow reached
 * that screen (a release_state row written before the withdrawal) would have
 * been walked through a three-day permanent-handover ritual, typed the word to
 * confirm it, and received an error.
 *
 * Two defects in one branch: copy describing a withdrawn capability as
 * available, and a control whose only possible outcome is a refusal. CLAUDE.md
 * states the rule outright — copy anywhere in the repo that still offers estate
 * to a user is a defect to fix, not a feature to restore.
 *
 * Feature: relay-h0-mvp
 * Requirements: ROADMAP §6; PROJECT.yaml gates.g2-counsel-opinion (declined)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CARD = 'src/app/(owner)/triggers/TriggersPageClient.tsx';

/** Comments stripped — the file quotes the withdrawn copy to explain its removal. */
function copy(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('the Triggers screen does not offer estate', () => {
  it.each([
    ['a permanent handover', /handover cannot\s+be undone/i],
    ['the three-day completion window', /waits\s*<span[^>]*>three days/i],
    ['a hand-over-permanently control', /Hand over permanently/i],
    ['passing possessions on', /passes to them permanently/i],
  ])('renders no copy describing %s', (_what, pattern) => {
    expect(copy(CARD)).not.toMatch(pattern);
  });

  /*
    The control as well as the words. A confirmation nobody can complete is
    still a control that says the product does this — and `/initiate` would
    answer 400, so the only reachable outcome was an error message.
  */
  it('offers no way to start a non-reversible trigger', () => {
    const src = copy(CARD);
    expect(src).toMatch(/rs\.state === 'armed' && reversible/);
  });

  /*
    A withdrawn trigger type still has to say SOMETHING if a legacy row exists —
    a bare badge and no controls reads as a bug rather than as a decision.
  */
  it('says what happened instead of going silent', () => {
    expect(copy(CARD)).toMatch(/withdrawn/i);
  });
});
