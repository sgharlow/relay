/**
 * The front door must not promise an email the default arm never sends.
 *
 * 🔴 THE SAME DEFECT `/claim` WAS CORRECTED FOR, ONE SCREEN EARLIER. On
 * 2026-08-16 the claim page's "Code from your email" label was replaced because
 * `BETA_INVITE_CHANNEL = 'owner'` (lib/people/invite.ts) — the arm the product
 * defaults to — "sends nothing at all and hands the owner a code to read out".
 * `lib/ops/claim-copy.test.ts` was written to hold that shut, and its file list
 * is one file: ClaimClient.tsx. The homepage went on saying
 *
 *     "If someone has asked you to be a recipient or a trusted contact, you will
 *      have an email with a code in it."
 *
 * to the same person, before they ever reach /claim. Somebody who was read their
 * code down the phone is told on the front page to go and find a message that
 * was never sent, concludes they have missed it, and stops — and they stop
 * SILENTLY, which is the expensive part: claim conversion is the Phase 0 metric
 * and an abandoner is indistinguishable from nobody wanting it.
 *
 * ⚠️ THIS POLICES THE INVITATION PARAGRAPH ONLY. /access and /verify really do
 * email a single-use code under adaptive minting, and claim-copy.test.ts keeps
 * them saying so. The rule is about the path where DELIVERY IS THE OWNER'S
 * CHOICE and the product cannot know which one they made.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { BETA_INVITE_CHANNEL } from '../../lib/people/invite';

const HOME = 'src/app/page.tsx';

function copy(): string {
  /*
    Comments stripped, as claim-copy.test.ts does and for the same reason: the
    note beside a fixed sentence has to be able to quote the wrong one.

    ⚠️ WHITESPACE COLLAPSED, and that is load-bearing. The first version of this
    file did not, and every phrase assertion PASSED against the defect it was
    written for — Prettier had wrapped the sentence as "…you will have an email\n
    with a code in it", so /email with a code/ matched nothing. A guard reading
    JSX source has to read it the way the browser renders it, or the next
    re-wrap silently disarms it.
  */
  return readFileSync(HOME, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ');
}

describe('the homepage invitation copy is delivery-arm neutral', () => {
  it('never tells a named person their code arrived by email', () => {
    const claims = [
      /email with a code/i,
      /from your email/i,
      /in your email/i,
      /we (?:sent|emailed) you/i,
      /check your (?:email|inbox)/i,
    ];
    const found = claims.filter((re) => re.test(copy())).map(String);
    expect(
      found,
      `${HOME} asserts an email delivery the owner-delivered arm never makes: ${found.join(', ')}`,
    ).toEqual([]);
  });

  it('still says where the code might have come from — neutral, not silent', () => {
    // Deleting the claim must not leave "enter a code" with no account of how a
    // code reaches anybody. The claim page's own neutral sentence is the model.
    expect(copy(), `${HOME} should still explain how the code may have reached them`).toMatch(
      /read it out|texted it|written it down|gave you/i,
    );
  });

  it('is pinned to the arm actually configured, not to a memory of it', () => {
    /*
      If the owner arm is ever flipped back to 'email' (Phase B of the 2026-08-13
      plan, once deliverability is proven), naming email here becomes true again
      and this guard should be revisited deliberately rather than inherited. It
      fails loudly at that moment instead of silently permitting stale copy.
    */
    expect(
      BETA_INVITE_CHANNEL,
      'BETA_INVITE_CHANNEL has changed — revisit the homepage invitation copy and this guard',
    ).toBe('owner');
  });
});
