/**
 * Advice the owner cannot act on is worse than no advice.
 *
 * 🔴 THE DEFECT THIS WAS WRITTEN FOR, found 2026-08-17. `vault_items.backup_note`
 * exists in migration 001, is projected by `METADATA_COLUMNS`, is read by
 * `lib/ai/metadata-query.ts`, and is the field `detectGaps` uses to decide
 * whether an item is a `CUSTODY_RISK` or a `MISSING_NOTE`.
 *
 * No write path in the product ever set it.
 *
 * `createVaultItem` did not list the column. `updateVaultItem` did not set it.
 * There was no form field, and no API accepted one. So `hasNote()` returned
 * false for every item in every real vault, forever — which means `detectGaps`
 * emitted a gap for EVERY SINGLE ITEM an owner had, each one advising them to
 * add a note the product gave them no way to add.
 *
 * WHY IT SURVIVED SO LONG, and the reason this check excludes one file:
 * `lib/seed/seed-runner.ts` DOES write `backup_note`. The demo vault therefore
 * looked correct — gaps appeared and cleared exactly as designed — while every
 * vault built through the actual product showed 100% of its contents as gapped.
 * A check that counted the seed runner as a write path would have passed on the
 * defect. Demo data is not a product capability, and that distinction is the
 * entire value of this file.
 *
 * THE GENERAL RULE. A column the advice layer READS must be writable through the
 * product's own APIs. Otherwise the gap it generates is permanent, the owner has
 * no move that clears it, and the vault screen accuses them of negligence they
 * cannot correct. That is the same false-signal family as the coverage banner
 * and the /circle box, pointed the other way: not a green that should be red,
 * but a red nobody can turn green.
 *
 * Feature: relay-h0-mvp
 * Requirements: 12.1, 12.3, 12.4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** The module that owns every product write to `vault_items`. */
const WRITES = 'lib/vault/vault-items.ts';
/** Where the advice is generated from. */
const ADVICE = 'lib/ai/prioritize-agent.ts';
/**
 * DELIBERATELY NOT COUNTED AS A WRITE PATH. Seeded demo rows are why this
 * defect was invisible for months — see the header.
 */
const NOT_A_PRODUCT_PATH = 'lib/seed/seed-runner.ts';

/** Columns the advice layer reads to decide whether to accuse the owner of a gap. */
const ADVICE_INPUTS = ['backup_note'] as const;

function source(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Statement bodies only — a column named in a comment is not a write. */
function writeStatements(src: string): string {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const stmts = stripped.match(/(INSERT INTO vault_items[\s\S]*?RETURNING|UPDATE vault_items[\s\S]*?RETURNING)/g);
  return (stmts ?? []).join('\n');
}

describe('every column the advice layer reads is writable through the product', () => {
  it.each(ADVICE_INPUTS)('%s is set by a production write path', (column) => {
    /*
      Comments are stripped before matching, and that is not a loophole — it is
      the same reasoning `claim-copy.test.ts` and `ad-copy.test.ts` record. The
      comment beside the fix has to be able to NAME the column in order to
      explain it, and a check that cannot tell an explanation from a use ends up
      silenced.
    */
    const statements = writeStatements(source(WRITES));
    expect(
      statements,
      `${ADVICE}'s advice depends on ${column}, but no INSERT or UPDATE in ${WRITES} sets it. ` +
        `Every item would be flagged forever with no action that clears it. ` +
        `NOTE: ${NOT_A_PRODUCT_PATH} writing it does not count — demo data is not a product capability.`,
    ).toContain(column);
  });

  it('the advice layer really does read these columns — otherwise this file is checking nothing', () => {
    /*
      The other direction. If `detectGaps` stopped consulting `backup_note`, the
      check above would still pass while guarding a rule that no longer exists.
      This fails the day the coupling is removed, so the pair is retired together
      or not at all.
    */
    const advice = source(ADVICE);
    for (const column of ADVICE_INPUTS) {
      expect(advice, `${ADVICE} no longer reads ${column} — retire it from ADVICE_INPUTS too`).toContain(column);
    }
  });

  it('the seed runner is not mistaken for a product write path', () => {
    /*
      Pins the exclusion that gives this file its value. If someone "fixes" a
      future failure by pointing the check at the seed runner, this fails.
    */
    const seed = writeStatements(source(NOT_A_PRODUCT_PATH));
    expect(
      seed,
      'the seed runner is expected to write backup_note — that is precisely why it must not count',
    ).toContain('backup_note');
    expect(WRITES).not.toBe(NOT_A_PRODUCT_PATH);
  });
});
