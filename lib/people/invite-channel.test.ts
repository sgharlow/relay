/**
 * Which arm a newly-created person is invited through.
 *
 * Ratified by Steve 2026-08-13: 'owner' for beta. The email arm rides a channel
 * this project has MEASURED as unreliable — Outlook SCL 5, and Resend
 * suppression that returns 200 while nothing arrives — and an invitation that
 * silently fails looks, from the owner's side, exactly like one that was
 * ignored.
 *
 * This is a one-line setting with a large consequence, so it gets the same
 * treatment as TIER_LIMITS.free.canRelease: a test that makes flipping it
 * deliberate. Creating a person now sends NOTHING, which is safe only because
 * the circle screen marks them "give them their code" and readiness refuses to
 * go green until somebody is confirmed. If the channel goes back to email, that
 * reasoning changes and the guidance in docs/first-invitations.md should be
 * re-read rather than assumed.
 *
 * Feature: relay-standby
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BETA_INVITE_CHANNEL } from './invite';

describe('the beta invitation channel', () => {
  it('is owner-delivered, so creating a person sends no email', () => {
    expect(BETA_INVITE_CHANNEL).toBe('owner');
  });

  /*
    The owner arm only works because the product tells the owner they now have
    something to hand over. If these two disappear, the invitation becomes a
    silent no-op and a circle never gets claimed.
  */
  it('the circle screen still tells the owner to deliver the code', () => {
    const src = readFileSync('src/app/(owner)/circle/PeopleSections.tsx', 'utf8');
    expect(src).toMatch(/give them their code/i);
  });

  it('readiness still refuses to go green on an unconfirmed circle', () => {
    const src = readFileSync('lib/vault/readiness.ts', 'utf8');
    expect(src).toMatch(/confirmed/i);
  });

  /*
    If this flips back to 'email', deliverability has to have been proven first
    — that is Phase B of the 2026-08-13 plan. The note lives with the constant.
  */
  it('the reason and the flip-back condition are recorded with the constant', () => {
    const src = readFileSync('lib/people/invite.ts', 'utf8');
    expect(src).toMatch(/FLIP BACK TO 'email'/);
    expect(src).toMatch(/Outlook SCL 5/);
  });
});
