/**
 * Neither emergency surface may dead-end.
 *
 * 🔴 /claim WAS FIXED ON 2026-08-16 AND /verify WAS NOT, because the sprint that
 * found the first one was aimed at "what will the first beta invitee hit" and a
 * verifier is not an invitee. The identical defect sat on the other surface for
 * another day. This file covers BOTH, so the next one cannot be fixed alone.
 *
 * ⚠️ THE VERIFIER'S DEAD END IS THE MORE EXPENSIVE OF THE TWO. A recipient who
 * gives up has failed to open their own access. A verifier who gives up has
 * failed to answer the question that opens it for EVERYBODY — quorum never
 * reaches its threshold, the release never advances, and the family waits on
 * somebody sitting in front of a screen with nothing to press. And they give up
 * silently: an abandoner sends no signal, so it is indistinguishable from a
 * verifier who chose not to answer.
 *
 * Feature: relay-h0-mvp
 * Requirements: J7
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SURFACES = [
  { name: 'claim', file: 'src/app/(access)/claim/ClaimClient.tsx' },
  { name: 'verify', file: 'src/app/(verify)/verify/VerifyClient.tsx' },
] as const;

function code(file: string): string {
  // Comments stripped — both files quote the defect in order to explain it.
  return readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('every emergency surface offers a way forward when something fails', () => {
  it.each(SURFACES)('$name has a control that clears the failure', ({ file }) => {
    const src = code(file);
    expect(src, `${file}'s error state needs a control, not just a sentence`).toMatch(
      /<button[\s\S]{0,400}?onClick=\{\(\) => \{[\s\S]{0,300}?set(Error|State|Token)\(/,
    );
  });

  it.each(SURFACES)('$name offers a human to contact, as a link', ({ file }) => {
    /*
      Prose saying "ask us" with nothing to click is not a way out.

      ⚠️ MATCHES THE USE, NOT THE IMPORT, and the planted-defect check is why.
      The first version looked for `CONTACT_MAILTO` anywhere in the file — so
      when the whole error block was reverted to its dead-end original, the
      leftover import line kept this passing. It survived the exact bug it was
      written for.
    */
    expect(code(file), `${file} should render the contact address as a link`).toMatch(
      /href=\{CONTACT_MAILTO\}/,
    );
  });

  it.each(SURFACES)('$name does not blame a link the person probably never used', ({ file }) => {
    /*
      Emailed links are deliberately bare and carry no credential, so most people
      arriving in an error state typed a code. "We couldn't open that link"
      describes something they never touched, and sends them looking for it.
    */
    expect(code(file)).not.toMatch(/couldn(&rsquo;|’|')t open that link/i);
  });

  it('the verifier keeps their context when it was the ANSWER that failed', () => {
    /*
      The case that is easy to miss. `decide()` sets an error too — and clearing
      the token there would throw away the question they were part-way through
      answering, turning a retryable hiccup into a lost decision.

      `ctx` is the discriminator: present means the context survived, so only the
      error is cleared.
    */
    const src = code(SURFACES[1].file);
    expect(src, 'the verify error state must distinguish a failed load from a failed answer').toMatch(
      /const answering = Boolean\(ctx\)/,
    );
    expect(src, 'and must not clear the token while they are mid-answer').toMatch(
      /if \(!answering\) setToken\(null\)/,
    );
  });

  it('the verifier is told that nobody can see they are stuck', () => {
    // The fact that makes the difference between abandoning and asking for help:
    // a verifier assumes the system knows. It does not.
    expect(code(SURFACES[1].file)).toMatch(/cannot see that you are stuck/i);
  });
});
