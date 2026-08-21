/**
 * The recipient's own dashboard may not dead-end either.
 *
 * 🔴 THE THIRD EMERGENCY SURFACE. `lib/ops/emergency-paths-have-a-way-back.test.ts`
 * was written on 2026-08-17 after /claim was fixed and /verify was not, and its
 * header says the point out loud: "This file covers BOTH, so the next one cannot
 * be fixed alone." Its `SURFACES` array lists claim and verify. /access — the
 * screen the recipient actually reaches, the one the whole product exists to
 * deliver — was never added, and had exactly the defect the other two were fixed
 * for: an error state that is a sentence with nothing to press.
 *
 * It is reachable without mistyping anything. A code that mints a token fine and
 * then fails at `GET /api/access` (the release was re-armed between the two
 * requests, a rate limit, a 500) lands here with `token` already set, so the
 * `!token && !signedIn` branch that renders the code form is never reached again.
 * No retry, no code form, and — until this file — no address to write to.
 *
 * ⚠️ AND THE CALM CLOSE WAS UNREACHABLE. `onClosed` set `error`, but the
 * code-entry branch was tested BEFORE the error branch, so a recipient whose
 * access had been closed gracefully saw the code form again rather than
 * "everything is fine". The sentence had been written, reviewed and shipped, and
 * had never once rendered. Branch ORDER is the defect; the ordering assertion
 * below is what stops it coming back.
 *
 * Assertions read the source, in the shape of the lib/ops guard, so this stays
 * true of the file rather than of one rendered branch.
 *
 * Feature: relay-h0-mvp
 * Requirements: J8, J9
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ACCESS = 'src/app/(access)/access/AccessClient.tsx';

function code(): string {
  // Comments stripped — this file quotes the defect in order to explain it.
  return readFileSync(ACCESS, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('/access offers a way forward when something fails', () => {
  it('has a control that clears the failure', () => {
    /*
      ⚠️ NOT the generic regex the lib/ops guard uses. This file already had a
      button in its error state — "Someone else you stand by for" — which renders
      ONLY when a multi-owner choice had been made, so the generic assertion
      passed on a screen that dead-ended for everybody else. The retry has to
      clear the token, because a token that is set is precisely what stops the
      code form coming back.
    */
    const src = code();
    const start = src.indexOf('if (error)');
    const block = src.slice(start, src.indexOf('if (!data)', start));
    expect(block, `${ACCESS}'s error state needs a retry, not just a sentence`).toMatch(
      /<button[\s\S]{0,600}?onClick=\{\(\) => \{[\s\S]{0,400}?setToken\(/,
    );
  });

  it('offers a human to contact, as a link', () => {
    /*
      Matches the USE, not the import — the lib/ops guard learned this the hard
      way: a reverted error block kept passing because the import line survived.
    */
    expect(code(), `${ACCESS} should render the contact address as a link`).toMatch(
      /href=\{CONTACT_MAILTO\}/,
    );
  });

  it('does not spell the address out by hand', () => {
    // lib/contact.ts is the one definition. This screen is read under stress and
    // was one of two still hardcoding the string.
    expect(code(), `${ACCESS} must use CONTACT_EMAIL, not a literal address`).not.toMatch(
      /hello@relaystandby\.com/,
    );
  });

  it('renders the graceful close before it offers the code form again', () => {
    /*
      The ordering defect. `if (!token && !signedIn)` returns the code-entry form;
      `onClosed` fires from inside that form and leaves `token` empty, so if the
      closed branch is tested AFTER it, it can never render.
    */
    const src = code();
    const closed = src.indexOf('if (closedNote)');
    // The RENDER branch, not the effect's early return on the same condition —
    // `if (!token && !signedIn) return;` appears first and is a different thing.
    const form = src.indexOf('if (!token && !signedIn) {');
    expect(closed, 'AccessClient should have a closedNote branch').toBeGreaterThan(-1);
    expect(form, 'AccessClient should still have a code-entry branch').toBeGreaterThan(-1);
    expect(
      closed,
      'the closed-gracefully message must be checked BEFORE the code form, or it never renders',
    ).toBeLessThan(form);
  });

  it('does not offer a retry on the calm close, which is not a failure', () => {
    /*
      "Access has been closed — they checked in and are fine" is the good outcome.
      A primary button under it would tell somebody who was just told there is
      nothing to do that there is something to do.
    */
    const src = code();
    const start = src.indexOf('if (closedNote)');
    const block = src.slice(start, src.indexOf('if (!token && signedIn === null)', start));
    expect(block, 'the closed screen should not carry a retry control').not.toMatch(/<button/);
  });
});
