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
