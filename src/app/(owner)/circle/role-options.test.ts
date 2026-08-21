/**
 * No form may offer a role the Terms say does not exist.
 *
 * 🔴 THE CONTRADICTION, ONE CLICK APART. src/app/terms/page.tsx says:
 *
 *     "Relay does not offer estate or inheritance services — there is no
 *      death-verified handoff, no executor role, and nothing here transfers
 *      ownership of anything."
 *
 * and the "Their role" select on /circle rendered `VALID_ROLES` raw — recipient,
 * **executor**, caregiver, partner — while the helper's "How would you describe
 * them?" select hardcoded its own copy of the same four. So an owner could pick
 * executor from a dropdown on the screen where they name people, on a surface
 * that takes live payments, against their own Terms.
 *
 * The role carries no behaviour: docs/user-journeys.md defines an executor as
 * "a recipient with role = executor on the estate trigger", and estate was
 * withdrawn permanently when gate g2-counsel-opinion was declined on 2026-08-14.
 * It is a label that does nothing, promises a capability, and contradicts the
 * contract.
 *
 * ⚠️ FIXED THE SAME WAY THE TRIGGER DROPDOWN WAS, and for the reason recorded
 * there: "the product offered a permanent capability its own Terms disclaimed".
 * The UI list narrows; `VALID_ROLES` and the DB CHECK keep accepting `executor`
 * so any legacy row still reads back. Both selects here are CREATE-only, so
 * narrowing them strands nothing — an edit form would need the stored value kept
 * in the list or saving would silently change somebody's role.
 *
 * ⚠️ AND IT IS TWO FILES, WHICH IS THE WEAKNESS THIS TEST COVERS. The right home
 * for the narrowed list is lib/domain/enums.ts beside USER_SELECTABLE_TRIGGER_TYPES;
 * until it lives there, one assertion reading both files is what stops them
 * drifting apart.
 *
 * Feature: relay-h0-mvp
 * Requirements: J10 (withdrawn)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { VALID_ROLES } from '../../../../lib/domain/enums';

/**
 * ⚠️ THREE FILES SINCE 2026-08-21, AND THE THIRD IS THE ONE THAT RENDERS.
 *
 * J4-R1 folded the circle screen's two add forms into one `AddPersonForm`, which
 * is now where the role <select> lives; `PeopleSections.tsx` keeps the narrowed
 * LIST (`SELECTABLE_ROLES`) and exports it. Both are read, because either one
 * alone would go green on the defect: pinning only the list file would miss an
 * option rendered elsewhere, and pinning only the form would miss the list
 * widening back to include `executor`.
 */
const FORMS = [
  { name: 'the owner naming someone', file: 'src/app/(owner)/circle/AddPersonForm.tsx' },
  { name: 'the narrowed list itself', file: 'src/app/(owner)/circle/PeopleSections.tsx' },
  { name: 'a helper proposing someone', file: 'src/app/(access)/helping/HelpingClient.tsx' },
] as const;

/** Rendered markup only — a comment explaining the removal must not re-trip it. */
const markup = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');

describe('the role selects do not offer executor', () => {
  it.each(FORMS)('$name offers no executor option', ({ file }) => {
    /*
      Matches a LIST that contains it, not the word. `VALID_ROLES.filter((r) => r
      !== 'executor')` names it in order to exclude it, and a check that cannot
      tell an exclusion from an option would have to be silenced — after which it
      checks nothing. That failure mode is recorded in ad-copy.test.ts.
    */
    const src = markup(file);
    const listWithExecutor = /\[[^\]]*['"]executor['"][^\]]*\]/.exec(src);
    expect(
      listWithExecutor?.[0] ?? null,
      `${file} offers the role "executor" while /terms says there is no executor role`,
    ).toBeNull();
    expect(src, `${file} must not render an executor <option>`).not.toMatch(/>\s*executor\s*</i);
  });

  it.each(FORMS)('$name does not render VALID_ROLES unfiltered', ({ file }) => {
    /*
      The subtler regression. Mapping the domain enum straight into <option>s is
      how executor got onto the screen in the first place, and it would put back
      anything else added to VALID_ROLES later — silently, with no diff on this
      file at all. Whatever the select maps, it must not be the raw enum.
    */
    expect(markup(file), `${file} should map a narrowed list, not VALID_ROLES itself`).not.toMatch(
      /\{\s*VALID_ROLES\s*\.map/,
    );
  });

  it('keeps executor valid in the domain, so a legacy row still reads back', () => {
    // Narrowing the UI is not deleting the value. An existing recipient stored
    // as `executor` must still validate, render and be editable.
    expect(VALID_ROLES as readonly string[]).toContain('executor');
  });
});
