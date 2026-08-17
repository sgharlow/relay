/**
 * A field that is NOT encrypted, on a page that promises encryption, must say so.
 *
 * `backup_note` was wired on 2026-08-17 so that the vault's own gap advice could
 * finally be acted on. It is the only owner-entered field on the add-item form
 * that is stored in clear: it lives in `METADATA_COLUMNS`, and
 * `lib/ai/metadata-query.ts` hands it to the AI agents. That is deliberate — the
 * note is what tells a recipient which account this is and how to find the
 * original, and neither `detectGaps` nor an agent could read it otherwise.
 *
 * 🔴 THE HAZARD THAT MAKES THIS A TEST RATHER THAN A COMMENT. The page is headed
 * "The secret is encrypted in your browser before it is sent." Directly beneath
 * that sits a second multi-line box. Without a warning attached to it, a
 * reasonable person types a password into the second box — and a plaintext
 * secret on a server path is the ONE thing this architecture exists to prevent
 * (CLAUDE.md: "Never add a server path that handles plaintext secrets").
 *
 * The product cannot stop them: it cannot read the note to check, precisely
 * because not reading secrets is the point. So the only available control is
 * telling them, at the moment they are typing, and keeping that sentence there.
 *
 * WHY THIS IS A SOURCE ASSERTION. `src/app/**` is excluded from the unit suite
 * and tested structurally — the same shape as `claim-copy.test.ts`,
 * `scrollable-regions.test.ts` and `fetch-routes-exist.test.ts`. Rendering the
 * page needs an owner session, which needs an account, which on this repo means
 * writing to production.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FORM = 'src/app/(owner)/vault/new/NewVaultItemClient.tsx';

/** Comments stripped: the explanation beside the copy must be free to quote it. */
function markup(): string {
  return readFileSync(FORM, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('the un-encrypted note field warns that it is un-encrypted', () => {
  it('says "Not encrypted" in the visible copy, not only in a comment', () => {
    expect(
      markup(),
      `${FORM} collects backup_note, which is stored and transmitted in clear. ` +
        'The page promises encryption two paragraphs above it. Without this warning ' +
        'people put passwords in it.',
    ).toMatch(/Not encrypted/i);
  });

  it('tells the person what to do instead, not merely what is true', () => {
    // "Not encrypted" alone is a fact about the system. It has to also carry the
    // instruction, or it reads as small print rather than as a rule.
    const src = markup();
    expect(src, 'the warning must forbid passwords and codes explicitly').toMatch(
      /never put a password or a code here/i,
    );
  });

  it('the warning and the field it guards cannot be separated', () => {
    /*
      The failure this prevents is not deletion of the whole block — it is
      someone tidying the helper text away while the textarea stays. Both must be
      present together, so removing either fails.
    */
    const src = markup();
    const hasField = /backup_note/.test(src);
    const hasWarning = /Not encrypted/i.test(src);
    expect(
      hasField === hasWarning,
      hasField
        ? `${FORM} still collects backup_note but the "Not encrypted" warning is gone`
        : `${FORM} no longer collects backup_note — remove this guard in the same change`,
    ).toBe(true);
  });

  it('the secret field still claims encryption, because it genuinely has it', () => {
    /*
      The other direction, and the reason the warning means anything: if the
      encrypted field ever stopped saying so, "Not encrypted" on the note would
      no longer distinguish the two and the contrast that carries the meaning
      would be lost.
    */
    expect(markup(), 'the add-item page should still state that the secret is encrypted').toMatch(
      /encrypted in your browser/i,
    );
  });
});
