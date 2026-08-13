/**
 * The one line whose flip breaks a promise in the user manual.
 *
 * `TIER_LIMITS.free.canRelease` is `true` "during beta", with a comment reading
 * FLIP TO false WHEN BETA ENDS. On the day it flips, a free or lapsed account
 * can no longer release — which is the product's entire job — and the manual
 * still says, in §2.7:
 *
 *   "Subscription. Cancel any time. Nothing in your vault is deleted when a
 *    subscription ends — the free limits apply only to adding more."
 *
 * That sentence is true today and becomes false the moment the flag moves. This
 * is not a test that the flag must never change. It is a test that the flag and
 * the promise have to move TOGETHER: flipping it turns this red, and the way to
 * turn it green is to go and correct what the product tells people. A one-line
 * change with a silent multi-page consequence is exactly the shape this
 * codebase keeps producing.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TIER_LIMITS } from './entitlements';

const MANUAL = 'docs/user-manual.html';
const CLAIM = 'the free limits apply only to adding more';

describe('the beta release flag and what the manual promises', () => {
  it('a free account can still release, or the manual no longer says it can', () => {
    const manual = readFileSync(MANUAL, 'utf8');
    const claimsFreeCanRelease = manual.includes(CLAIM);

    if (TIER_LIMITS.free.canRelease) {
      expect(
        claimsFreeCanRelease,
        'The free tier CAN release, so the manual is free to say the limits only ' +
          'affect adding. Nothing to do — this branch documents the current state.',
      ).toBe(true);
      return;
    }

    expect(
      claimsFreeCanRelease,
      'canRelease has been flipped to false, so a lapsed subscription now stops ' +
        'releases entirely. §2.7 of docs/user-manual.html still tells owners that ' +
        'the free limits "apply only to adding more", which is now untrue and is ' +
        'the single most consequential thing the product could be wrong about. ' +
        'Correct the manual (and the /account copy) in the same change as the flag.',
    ).toBe(false);
  });

  /*
    A guard is worthless if the sentence it watches can be reworded out from
    under it. If this fails, the manual was edited and the check above quietly
    stopped watching anything.
  */
  it('the sentence this guard watches still exists to be watched', () => {
    const manual = readFileSync(MANUAL, 'utf8');
    const stillDiscussesIt = /subscription/i.test(manual) && /free/i.test(manual);
    expect(
      stillDiscussesIt,
      'The manual no longer discusses subscriptions or the free tier. Re-point ' +
        'CLAIM in this test at whatever replaced it, or delete the guard on purpose.',
    ).toBe(true);
  });
});
