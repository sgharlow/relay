/**
 * The control existed and nothing asked the question.
 *
 * 🔴 THE DEFECT, filed as `secret-kinds-declaration-is-opt-in-by-discovery`
 * (D3) the day the wiring shipped. Migration 035 gave an owner a way to say
 * whether an account demands a code as well as a password, and the only way to
 * reach it was to already be looking at the vault row for an item you would
 * have had to doubt first. Every item created before 2026-08-18 reads
 * `unknown`, which SUPPRESSES the qualifier on the preparedness sentence
 * entirely — so for every plan that already existed, the headline claim stayed
 * exactly as wrong as it was before the migration, and the owners whose plans
 * were wrong were the least likely to go looking.
 *
 * This is the repo's most-repeated shape: a capability that is built, tested,
 * deployed and unreachable (see `SidebarNav.test.ts`, which pins the same class
 * for whole pages). A unit suite cannot see it, because every function works.
 *
 * Source-text assertions rather than a rendered component: this repo has no
 * component-test harness, and adding one to assert "a button exists" would be a
 * larger claim than the one being made. What these pin is that the surface asks
 * and that both answer paths go through one definition — the live walk
 * (`npm run verify:factors`) and the screenshot sweep prove the rendering.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R13
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const BANNER = readFileSync(
  join(process.cwd(), 'src/app/(owner)/_components/ReadinessBanner.tsx'),
  'utf8',
);

describe('the owner is asked, rather than left to find the control', () => {
  it('the banner names the items nobody has been asked about', () => {
    expect(
      BANNER.includes('unaskedItems'),
      'ReadinessBanner does not read preparedness.unaskedItems, so the prompt names nobody — ' +
        'which leaves the declaration reachable only by an owner already looking at the row.',
    ).toBe(true);
  });

  it('the banner offers both answers, not just the alarming one', () => {
    /*
      One-sided prompting is how a signal gets destroyed: an owner who is only
      ever offered "needs a code" learns the prompt is an accusation. "Password
      is enough" is the answer most items will get, and it is the one that
      converts an unknown into a usable item.
    */
    expect(BANNER).toContain('Needs a code');
    expect(BANNER).toContain('Password is enough');
  });

  it('says what to do about an item whose entry Relay cannot see into', () => {
    expect(
      BANNER.includes('undeclaredClause'),
      'The banner reports what nobody has been asked, but not the items where the owner HAS ' +
        'answered and no client ever declared what the entry holds. Those cannot be fixed by ' +
        'tapping anything, and saying nothing about them is how a prompt that changes nothing ' +
        'gets tapped once and never again.',
    ).toBe(true);
  });

  it('every path that records the answer goes through one definition', () => {
    /*
      The D1 lesson, applied one layer up: a guard that checks one call site is
      a guard on that call site. This enumerates every producer instead.
    */
    const roots = ['src', 'lib'];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
        if (path.endsWith(join('lib', 'vault', 'declare-factors.ts'))) continue; // the definition

        const source = readFileSync(path, 'utf8');
        // A client writing this field in a request body, rather than reading it.
        if (/factors_required:\s*(value|\[|null)/.test(source)) offenders.push(path);
      }
    };
    roots.forEach((r) => walk(join(process.cwd(), r)));

    expect(
      offenders,
      'These files hand-write the factors_required request body instead of calling ' +
        'setFactorsRequired(). Two spellings of the same save is how `[]` (a password is enough) ' +
        'and `null` (nobody has said) get confused, and that difference is invisible on screen.',
    ).toEqual([]);
  });
});

/*
  🔴 THE DEFECT THE PROMPT FOUND, 2026-08-18, and it was not in the prompt.

  `assessReadiness` selects `id, title, criticality, is_root_credential` from
  vault_items and passes those rows to `assessPreparedness`. The three usability
  columns were OPTIONAL on that input — deliberately, so a caller compiled
  against a cluster without migration 035 would keep working — so the omission
  compiled, every item read `unknown`, `checkingStarted` was permanently false,
  and THE ENTIRE SECOND-FACTOR CORRECTION WAS INERT ON THE ONE SURFACE THAT
  RENDERS THE SENTENCE.

  Everything was green throughout. The unit tests pass because they call
  `assessPreparedness` directly with the columns supplied. `verify:factors`
  passes for the same reason — it reads the columns from the list API and
  computes preparedness itself, so it proved the rule through a path the banner
  does not use. It took rendering the prompt and seeing it ask about an item
  that had just been answered.

  Same shape as the columns shipping inert a day earlier: the value was there,
  and nothing on the path to the screen selected it.
*/
describe("the banner's own data", () => {
  const READINESS = readFileSync(join(process.cwd(), 'lib/vault/readiness.ts'), 'utf8');

  it('selects the columns the preparedness rule reads', () => {
    const select = /SELECT id, title[^`]*FROM vault_items/.exec(READINESS)?.[0] ?? '';
    for (const column of ['secret_kinds', 'factors_required', 'depends_on_item_id']) {
      expect(
        select.includes(column),
        `readiness.ts fetches vault items without ${column}, so every item reaches ` +
          'assessPreparedness as unknown and the second-factor rule cannot fire on the banner. ' +
          'A column that nothing selects is a column that does not exist.',
      ).toBe(true);
    }
  });
});
