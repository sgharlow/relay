/**
 * The invitation surface must not tell people to look in an email that was
 * never sent.
 *
 * 🔴 THE DEFECT THIS WAS WRITTEN FOR. `/claim` said, three lines apart:
 *
 *     "Type the code they gave you — they may have read it out, texted it,
 *      or written it down."
 *     <label> Code from your email </label>
 *
 * The paragraph is right and the label contradicted it. Worse, the label was
 * wrong for the arm the product DEFAULTS to: `BETA_INVITE_CHANNEL='owner'`, and
 * `docs/first-invitations.md` states it plainly — "the owner-delivered arm sends
 * no email at all." Somebody told their code over the phone reads "Code from
 * your email", concludes they have missed a message, and stops.
 *
 * WHY THAT IS EXPENSIVE RATHER THAN UNTIDY. This sits on claim conversion, which
 * is the Phase 0 metric — and two SHIPPED security decisions rest on that number:
 * principle 1 of the standby architecture is conditional on claim conversion, and
 * adaptive minting assumes verifiers actually reach `confirmed`. A label that
 * turns invitees away corrupts the measurement those rest on, and it does it
 * silently, because a person who gives up sends no signal.
 *
 * ⚠️ THIS DELIBERATELY DOES NOT POLICE `/access` OR `/verify`. Their codes really
 * are emailed — a confirmed verifier with no passkey and no authenticator is sent
 * a single-use code, which is the adaptive-minting design. "Code from your email"
 * is CORRECT there, and a blanket find-and-replace would have made two accurate
 * surfaces inaccurate. The rule is about the INVITATION path, where delivery is
 * the owner's choice and the product cannot know which one they picked.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CLAIM = 'src/app/(access)/claim/ClaimClient.tsx';
/** Surfaces where the code genuinely arrives by email, and may say so. */
const EMAIL_DELIVERED = ['src/app/(access)/access/AccessClient.tsx', 'src/app/(verify)/verify/VerifyClient.tsx'];

describe('the invitation surface is delivery-arm neutral', () => {
  it('never tells an invitee the code came from their email', () => {
    /*
      The owner arm sends nothing. The email arm does. The page cannot know
      which the owner chose, so it must not assert either.
    */
    /*
      COMMENTS ARE STRIPPED FIRST, and that is not a loophole — it is the same
      reasoning `ad-copy.test.ts` records: a check that cannot tell an example
      from a use will be silenced, and then it checks nothing. The comment beside
      the fixed label has to be able to QUOTE the wrong wording in order to
      explain what was wrong with it. This caught exactly that on its first run.
    */
    const src = readFileSync(CLAIM, 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const claims = [/from your email/i, /in your email/i, /we (?:sent|emailed) you/i, /check your (?:email|inbox)/i];
    const found = claims.filter((re) => re.test(src)).map(String);
    expect(
      found,
      `${CLAIM} asserts an email delivery the owner-delivered arm never makes: ${found.join(', ')}`,
    ).toEqual([]);
  });

  it('still says where the code might have come from — neutral, not silent', () => {
    // Removing the label's claim must not leave a bare box with no explanation.
    // The body copy already does this job correctly; this pins that it stays.
    const src = readFileSync(CLAIM, 'utf8');
    expect(src, 'the claim page should still explain how the code may have reached them').toMatch(
      /read it out|texted it|written it down/i,
    );
  });

  it('leaves the genuinely-emailed surfaces alone', () => {
    /*
      Guards against the over-correction. /access and /verify send a single-use
      code by email under adaptive minting, so naming email there is accurate and
      helpful. If a future edit strips it from them too, this fails.
    */
    for (const file of EMAIL_DELIVERED) {
      expect(readFileSync(file, 'utf8'), `${file} should still reference the email it really sends`).toMatch(
        /email/i,
      );
    }
  });
});
