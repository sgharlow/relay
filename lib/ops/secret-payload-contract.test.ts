/**
 * One definition of what a vault item's plaintext means.
 *
 * 🔴 THERE WERE TWO, AND THE SECOND WAS REACHING PEOPLE. `ImportPageClient`
 * encrypted `JSON.stringify({ username, password })`; the manual add form
 * encrypted a bare string; and `AccessClient` rendered whatever it decrypted
 * into a `<pre>`. Nobody wrote that down anywhere, nothing enforced it, and the
 * consequence was that a recipient of any imported item — at the worst moment of
 * their life — was shown
 *
 *     {"username":"steve@example.com","password":"hunter2"}
 *
 * The formats diverged because the two ends were written months apart and
 * neither one names the other. This is the check that makes them name it.
 *
 * ⚠️ WHY IT MATTERS MORE HERE THAN FOR AN ORDINARY SHARED TYPE: the server
 * cannot read plaintext, so it can never re-encrypt a row. A format written by
 * mistake is written FOREVER — there is no migration that could ever fix it up.
 * That is the whole reason this is a build-time check rather than a convention.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** The one authoritative definition. */
const CONTRACT = 'lib/crypto/secret-payload.ts';

/** Everything that turns owner input into item plaintext. */
const WRITERS = [
  'src/app/(owner)/vault/new/NewVaultItemClient.tsx',
  'src/app/(owner)/vault/ItemControls.tsx',
  'src/app/(owner)/import/ImportPageClient.tsx',
] as const;

/** Everything that turns item plaintext back into something a person reads. */
const READERS = ['src/app/(access)/access/AccessClient.tsx'] as const;

function code(file: string): string {
  // Comments stripped: every one of these files has to QUOTE the old format in
  // order to explain what was wrong with it. Same reasoning as claim-copy and
  // ad-copy — a check that cannot tell an example from a use gets silenced.
  return readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('every path through item plaintext uses the one contract', () => {
  it.each(WRITERS)('%s encodes through the contract', (file) => {
    expect(
      code(file),
      `${file} builds item plaintext without ${CONTRACT}. A second format written here is ` +
        'written permanently — the server cannot read plaintext, so no migration can normalise it.',
    ).toMatch(/encodeSecretPayload\(/);
  });

  it.each(READERS)('%s decodes through the contract', (file) => {
    expect(
      code(file),
      `${file} renders item plaintext without ${CONTRACT}, which is exactly how recipients ` +
        'ended up being shown raw JSON.',
    ).toMatch(/decodeSecretPayload\(/);
  });

  it('no writer hand-rolls a plaintext object', () => {
    /*
      The specific defect, pinned. `JSON.stringify({ username: …, password: … })`
      is the shape the import used, and it is the natural thing to write again.
      It has to go through the encoder so that the decoder is guaranteed to
      understand it.
    */
    for (const file of WRITERS) {
      expect(
        code(file),
        `${file} appears to build a plaintext object by hand — use encodeSecretPayload`,
      ).not.toMatch(/JSON\.stringify\(\s*\{\s*username/);
    }
  });

  it('the recipient view does not dump the raw decrypted value', () => {
    /*
      The literal regression. `<pre …>{value}</pre>` is what shipped.

      ⚠️ THIS PATTERN WAS WRONG WHEN FIRST WRITTEN, and the planted-defect check
      is what caught it: it matched only the exact historical spelling `{value}`,
      so restoring the dump in its CURRENT shape — `{value.plaintext}`, since the
      state became a discriminated union — sailed straight past. A guard that
      only recognises the bug as it was previously spelled is not a guard.
    */
    const src = code(READERS[0]);
    expect(src, 'the decrypted value must not be rendered straight into an element').not.toMatch(
      /*
        Narrowed to the PLAINTEXT specifically. The first attempt matched any
        `{value.*}` and flagged the error branch, which legitimately renders
        `{value.message}` — a guard that fires on correct code gets deleted, and
        then it guards nothing.
      */
      /<(pre|code|p|div|span)[^>]*>\s*\{\s*value(\.plaintext)?\s*\}/,
    );
  });

  it('the contract still exports what these files depend on', () => {
    // The other direction: if the module were renamed or its exports changed,
    // the checks above would keep passing against a file that no longer exists.
    const contract = readFileSync(CONTRACT, 'utf8');
    for (const symbol of ['encodeSecretPayload', 'decodeSecretPayload', 'recoveryCodesOf']) {
      expect(contract, `${CONTRACT} should export ${symbol}`).toMatch(
        new RegExp(`export function ${symbol}`),
      );
    }
  });
});
