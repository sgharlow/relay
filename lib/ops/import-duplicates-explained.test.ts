/**
 * A re-import that changes nothing must not read as success.
 *
 * 🔴 THE TRAP. `splitDuplicates` matches an incoming row against items ALREADY in
 * the vault, on a normalised `title + service_name` (lib/vault/dedupe.ts). So the
 * natural thing to do after turning on two-factor somewhere — export again from
 * your password manager, import again to pick it up — skips every single row and
 * reports `imported: 0, duplicatesSkipped: 40`.
 *
 * Nothing is updated. And until 2026-08-17 nothing on the screen said the second
 * factor had not come across, so the one thing the owner did it FOR was the one
 * thing that silently did not happen.
 *
 * ⚠️ THE FIX IS COPY, DELIBERATELY, AND THAT IS A SECURITY CHOICE. Making import
 * update duplicates would turn it into a path that can WRITE OVER stored vault
 * secrets, which it has never been — a mis-mapped column or a stale export could
 * quietly replace a good credential with a worse one. Ruled 2026-08-17: tell the
 * owner what happened rather than change what happens.
 *
 * Scope measured before deciding: production had 1 owner and 0 vault items, so
 * nobody has been harmed by this. It is a forward-looking trap, and the cheapest
 * honest answer is the right size for it.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const IMPORT_UI = 'src/app/(owner)/import/ImportPageClient.tsx';

function markup(): string {
  // Comments stripped — the note beside the fix has to quote the problem.
  return readFileSync(IMPORT_UI, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('the import result explains what skipping duplicates cost', () => {
  it('names two-factor codes specifically, not just "duplicates"', () => {
    /*
      "left 40 already in your vault untouched" was already on screen and was not
      enough: it describes the ROWS, and the owner is thinking about the CODES.
      The sentence has to name the thing they came for.
    */
    expect(
      markup(),
      `${IMPORT_UI} reports skipped duplicates without saying that their two-factor codes were ` +
        'skipped too — which is the one thing a re-import is usually FOR.',
    ).toMatch(/two-factor codes in this export/i);
  });

  it('tells them what to do instead', () => {
    // A statement of fact with no next step leaves somebody stuck on the screen
    // that just told them their effort achieved nothing.
    expect(markup(), 'the message should point at the item-level Update path').toMatch(
      /open it in your vault and choose Update/i,
    );
  });

  it('only says it when there were duplicates', () => {
    // A first-time import has nothing skipped, and a warning about codes that
    // were not skipped would be noise on the happiest path in the product.
    expect(markup()).toMatch(/report\.duplicates \?/);
  });

  it('import still does not write over an existing item', () => {
    /*
      The ruling, pinned. If a future change makes the importer update duplicates,
      this fails and forces the decision to be taken again rather than inherited.
      `/api/import` inserts; nothing in the client asks it to do otherwise.
    */
    const route = readFileSync('src/app/api/import/route.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(route, '/api/import must not UPDATE vault_items — it is an insert path').not.toMatch(
      /UPDATE\s+vault_items\s+SET\s+(ciphertext|wrapped_data_key)/i,
    );
  });
});
