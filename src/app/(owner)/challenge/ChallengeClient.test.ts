/**
 * The owner and the requester must be told the same thing about the same event.
 *
 * 🔴 ONE SURFACE GOT THE CORRECTION AND THE OTHER DID NOT. `notifyRequesterOfOutcome`
 * carries a long note explaining why "Access is opening now" was wrong and what
 * replaced it: approving takes the release to GRACE, and only `resolveElapsedGrace`
 * — which runs on the hourly heartbeat — moves GRACE to RELEASED. "Even for a
 * reversible trigger, whose grace window is zero, 'now' means 'at the next sweep',
 * up to an hour away. Someone refreshing a page during an emergency because we
 * told them it was already open is a cruel way to be inaccurate."
 *
 * The requester's email was rewritten to "Access is not open yet — there is a
 * short wait". The OWNER's screen still read:
 *
 *     "Access is opening"
 *     "They will be able to reach what you designated."
 *
 * So the two people in the conversation were told different things about the same
 * moment. The owner is the one likely to phone and say "it's open, go and look" —
 * and then the family member reads an email saying it is not, or opens /access and
 * sees nothing, and now the product looks broken to both of them at once.
 *
 * ⚠️ THE TIMING ITSELF IS NOT FIXED HERE, and that is a recorded decision rather
 * than an omission. notifications.ts: "NOT FIXED BY FORCING A RELEASE HERE.
 * resolveElapsedGrace is a global sweep with no owner filter: calling it from this
 * route would transition other owners' releases and send their mail inside one
 * requester's HTTP request." An owner-scoped resolve is the real fix and belongs
 * with the release machine, not in a client component.
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R5, J6-R10
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SCREEN = 'src/app/(owner)/challenge/ChallengeClient.tsx';

const copy = () =>
  readFileSync(SCREEN, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');

describe('the approval confirmation matches what actually happens', () => {
  it('does not tell the owner access is opening right now', () => {
    /*
      Present-continuous reads as "in the next few seconds". It is a wait of up
      to an hour, and the owner is the person most likely to relay the news.
    */
    expect(copy(), `${SCREEN} promises an immediacy the release machine does not deliver`).not.toMatch(
      /Access is opening(?!\s+(?:shortly|soon))/i,
    );
  });

  it('says there is a wait, in the same voice the requester is told', () => {
    expect(copy(), 'the owner should be told about the wait too').toMatch(
      /short wait|not open yet|shortly|a few minutes|within the hour/i,
    );
  });

  it('still says it can be closed again, which is the reassurance that matters', () => {
    // The reversibility promise is the reason an owner is willing to say yes.
    expect(copy()).toMatch(/close it again|can be undone|stand it down/i);
  });

  it('keeps the denial answer unambiguous — nothing opened, nobody contacted', () => {
    const c = copy();
    expect(c).toMatch(/Nothing was opened/i);
    expect(c).toMatch(/Nobody else was contacted/i);
  });
});
