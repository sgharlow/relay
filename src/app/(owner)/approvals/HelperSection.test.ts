/**
 * The consent copy may only promise what a route actually honours.
 *
 * 🔴 THE SAME DEFECT THE TEAM ALREADY RULED ON, in the copy instead of the code.
 * `policies:propose` was removed on 2026-08-12 for being "a granted capability
 * that silently does nothing… worse than an absent one, because it reads as
 * working" (lib/people/delegation.ts). Two of its neighbours were not: nothing
 * anywhere calls `requireScope(actor, 'items:update')` or `'import:run'` —
 * `/api/import` is `requireOwner`, `PUT /api/vault/items/[id]` is
 * `getOwnerSession` + assertOwns — and this panel, which is the screen an owner
 * reads while DECIDING whether to hand somebody a key to their vault, listed:
 *
 *     "A helper can: add and edit items in your vault / import a list from
 *      elsewhere / suggest people and access rules"
 *
 * Three of those did not exist. Edit and import were never wired to a delegate
 * path, and "access rules" outlived the scope that would have proposed them.
 *
 * ⚠️ WHICH WAY THIS FAILS MATTERS. It overstates, so an owner grants a helper
 * expecting an import they will then not find, and — worse for a consent
 * screen — the list they are asked to consent to is not the list of what they
 * are consenting to. The BUILD half (routing import and update through
 * resolveActor) is demand-gated; telling the truth is not.
 *
 * Feature: relay-h0-mvp
 * Requirements: J3-R5, J3-R6, J3-R11
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { DELEGATE_SCOPES } from '../../../../lib/people/delegation';

const PANEL = 'src/app/(owner)/approvals/HelperSection.tsx';

/** The consent list, comments stripped and whitespace collapsed to how it reads. */
function consentCopy(): string {
  return readFileSync(PANEL, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ');
}

/** Every scope some route actually gates on, read from the routes themselves. */
function scopesHonouredByARoute(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'route.ts') {
        const src = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        for (const m of src.matchAll(/requireScope\(\s*\w+\s*,\s*'([^']+)'/g)) found.add(m[1]);
      }
    }
  };
  walk('src/app/api');
  return found;
}

describe('the helper consent list matches the capabilities that exist', () => {
  it('does not promise an import a delegate cannot run', () => {
    const honoured = scopesHonouredByARoute();
    if (honoured.has('import:run')) return; // built — the promise is true again
    expect(
      consentCopy(),
      'no route calls requireScope(actor, "import:run"), so a helper cannot import anything',
    ).not.toMatch(/import a list/i);
  });

  it('does not promise editing a delegate cannot do', () => {
    const honoured = scopesHonouredByARoute();
    if (honoured.has('items:update')) return;
    expect(
      consentCopy(),
      'no route calls requireScope(actor, "items:update"); PUT /api/vault/items/[id] is owner-only',
    ).not.toMatch(/edit items/i);
  });

  it('does not promise suggesting access rules, which was removed in 2026-08-12', () => {
    expect(
      DELEGATE_SCOPES as readonly string[],
      'policies:propose is back — revisit this copy deliberately rather than inheriting it',
    ).not.toContain('policies:propose');
    expect(consentCopy(), 'a helper cannot propose an access rule').not.toMatch(/access rules/i);
  });

  it('still says what a helper CAN do — an empty list is not the fix', () => {
    // Deleting the overstatement must not leave an owner consenting to nothing
    // legible. Adding items and suggesting people are real and are the point.
    const copy = consentCopy();
    expect(copy).toMatch(/add[^.]{0,40}items/i);
    expect(copy).toMatch(/suggest/i);
  });
});

/**
 * 🔴 THE OTHER HALF OF THE SAME AUDIT, AND IT FAILS THE EXPENSIVE WAY.
 *
 * The three lines removed on 2026-08-21 overstated what a helper CAN do — an
 * owner grants more than they meant to. This one overstates what a helper is
 * PREVENTED from doing, which on a consent artifact is worse: the owner is
 * reassured about a protection that does not exist, and the person being
 * reassured is the one whose vault it is.
 *
 * The panel said, flatly:
 *
 *     "A helper can never: open or read anything in your vault"
 *
 * A delegate can read back every item they personally entered. That is not an
 * oversight, it is the design: `listItemsIEntered` selects on
 * `created_by_delegate_id`, and `POST /api/kms/unwrap` calls
 * `assertDelegateMayRead`, which ALLOWS an item whose provenance is this
 * delegation. `lib/people/delegation.ts` states the boundary in its own header
 * and ends the paragraph with the instruction this copy broke: *"a delegate who
 * types a credential in obviously knows it… Never imply the delegate learns
 * nothing."*
 *
 * ⚠️ THE OVERSTATEMENT IS THE DANGEROUS PART IN PRACTICE, not the pedantry. A
 * parent reading "can never open or read anything" reasonably concludes it is
 * safe to have their helper type in the bank password — which is precisely the
 * one thing that IS visible to them, forever, because they typed it.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R2, J3-R4
 */
describe('the "can never" list does not promise a protection that does not exist', () => {
  /*
    ⚠️ MATCHED ON THE UNQUALIFIED CLAIM, not on the words "read anything".

    The first version of this assertion was `/never[^.]{0,80}read anything/i`,
    which could not tell "can never read anything in your vault" from "can never
    read anything YOU PUT IN" — it fired on the corrected copy too. A check that
    cannot distinguish the defect from the fix has to be silenced to ship the
    fix, and a silenced check protects nothing. Same failure recorded in
    role-options.test.ts, where a list naming `executor` in order to EXCLUDE it
    tripped a check looking for the word.
  */
  it('never claims a helper cannot read anything in the vault', () => {
    expect(
      consentCopy(),
      'a delegate CAN decrypt items they entered — assertDelegateMayRead allows it',
    ).not.toMatch(/read anything in your vault/i);
  });

  it('qualifies the claim it does make, rather than dropping it', () => {
    // "anything you put in" is the true boundary; the bare noun is not.
    expect(consentCopy()).toMatch(/read anything you put in/i);
  });

  it('states the honest boundary instead: what they typed, they know', () => {
    const copy = consentCopy();
    expect(copy, 'the consent panel must say what a helper CAN see').toMatch(
      /(typed|entered|added).{0,80}(see|read|know)|(see|read|know).{0,80}(typed|entered|added)/i,
    );
  });

  it('still says what they cannot reach — the boundary is narrowed, not deleted', () => {
    // The real guarantee survives: everything the OWNER put in is closed to
    // them. Deleting the whole line would trade an overstatement for silence.
    expect(consentCopy()).toMatch(/you enter yourself stays closed/i);
  });

  it('names the decision the boundary actually leaves with the owner', () => {
    /*
      The line above is a fact; this is the fact an owner has to ACT on. Whether
      a helper learns a credential is decided entirely by which fields the owner
      lets them type, and until 2026-08-21 nothing on this screen said so —
      leaving the owner to infer the most important thing about the feature from
      a bullet list of prohibitions.
    */
    expect(consentCopy()).toMatch(/what you let them type in/i);
  });
});
