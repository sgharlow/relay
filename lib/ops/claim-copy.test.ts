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

describe('the claim error state is not a dead end', () => {
  /*
    🔴 IT WAS ONE UNTIL 2026-08-16, on the path where a dead end costs most.
    A person who mistyped one character of a code shaped like 4KMPQ-7XR2W got a
    message, no retry control, no link out, and the browser back button — which
    they had to think of. They give up SILENTLY: an abandoner sends no signal, so
    the failure is indistinguishable from nobody wanting it.

    Hard-priority ladder item 4 in the sprint rules — "a user journey that dead
    -ends" — which is why it jumped a higher-scored copy item.
  */
  const src = () => readFileSync(CLAIM, 'utf8');

  it('offers a way back to the code form', () => {
    const s = src();
    expect(s, 'the error branch needs a control that clears the token').toMatch(/setToken\(null\)/);
    expect(s, 'and it has to be labelled for a person, not a developer').toMatch(/Try the code again/i);
  });

  it('gives a human to contact, as a link rather than prose', () => {
    // "or ask us." was plain text with nothing to click.
    expect(src()).toMatch(/CONTACT_MAILTO/);
  });

  it('does not call it a link — most people arriving here typed a code', () => {
    // The emailed invitation is deliberately bare and carries no credential, so
    // "we couldn't open that link" described something they never used.
    const withoutComments = src().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toMatch(/couldn&rsquo;t open that link/i);
  });
});

describe('the claim fires once, and success means a session', () => {
  /*
    🔴 TWO WAYS THIS PAGE STRANDED A CLAIMANT, found 2026-08-17 by
    screenshotting it rather than walking its assertions.

    ONE: React StrictMode double-invokes the claim effect, the racing pair
    desynchronised NextAuth's CSRF double-submit, and the browser navigated on
    the refused attempt while the aborted one spent the single-use code
    server-side. The claimant reached /standby signed out holding a code that
    now answers "already been used". Development-only in origin, but the ref
    that fixes it is correctness anywhere an effect can run twice.

    TWO: NextAuth answers a CSRF-refused credentials callback with a redirect
    to `signin?csrf=true` — no `error` search-param, so `signIn()` reports
    `ok: true` for a claim that minted NOTHING, and the 2026-08-12 "must not
    read as success" guard passes it. Only the session endpoint can tell a
    minted session from a refused one, so the client must ask it before
    navigating. Production single-fires today; this pins the behaviour that
    keeps a transient CSRF flake from silently reporting success.
  */
  const CLAIM_SRC = 'src/app/(access)/claim/ClaimClient.tsx';
  const src = () =>
    readFileSync(CLAIM_SRC, 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

  it('guards the auto-claim behind a ref so an effect re-run cannot double-spend', () => {
    const s = src();
    expect(s, 'the in-flight ref is gone — StrictMode will double-fire signIn again').toMatch(
      /claimStarted\.current\s*===\s*token\)\s*return/,
    );
  });

  it('verifies a session exists before navigating to /standby', () => {
    const s = src();
    const navigatesAt = s.indexOf("window.location.href = '/standby'");
    const checksAt = s.indexOf("fetch('/api/auth/session'");
    expect(checksAt, 'nothing consults /api/auth/session — signIn ok:true is not a session').toBeGreaterThan(-1);
    expect(
      navigatesAt,
      'the /standby navigation must come AFTER the session check, or a refused claim reads as success',
    ).toBeGreaterThan(checksAt);
  });

  it('a failed session check releases the ref, so the offered retry is real', () => {
    expect(src()).toMatch(/claimStarted\.current = null/);
  });
});
