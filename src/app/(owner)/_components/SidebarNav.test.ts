/**
 * Every owner page must be reachable from somewhere a person can stand.
 *
 * This is the third time this defect class has shipped. A capability gets built,
 * tested, deployed, and is reachable only by typing a URL nobody knows:
 *   - the reverse release transitions had no button (2026-08-08)
 *   - the account controls had no screen (2026-08-09)
 *   - /circle and /approvals had no navigation entry (2026-08-09, found by
 *     screenshotting all 27 screens rather than by any test)
 *
 * A green suite could not see any of them, because "the page exists" and "a
 * user can get there" are different claims. This test asserts the second one:
 * every directory under app/(owner) either appears in the sidebar, or is
 * exempted here WITH the reason it does not belong there.
 *
 * Adding an exemption is the point at which someone has to justify it.
 *
 * Feature: relay-h0-mvp
 * Requirements: 12.1
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const OWNER_DIR = join(process.cwd(), 'src/app/(owner)');

/**
 * Pages deliberately absent from the sidebar. Each needs a reason, and the
 * reason has to be about how a person REACHES it — not why it was convenient.
 */
const NOT_IN_NAV: Record<string, string> = {
  start: 'the onboarding wizard — entered from signup, not browsed back to',
  challenge:
    'push-driven: a person lands here from the "someone is asking for access" email. ' +
    'A permanent nav item reading "Someone is asking" would alarm every owner nobody ' +
    'is asking about. It needs a pending-state surface instead — tracked, not solved here.',
};

function navHrefs(): string[] {
  const src = readFileSync(join(OWNER_DIR, '_components/SidebarNav.tsx'), 'utf8');
  return [...src.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]);
}

function ownerPages(): string[] {
  return readdirSync(OWNER_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('('))
    .map((d) => d.name);
}

describe('owner navigation covers the owner app', () => {
  it('every owner page is either in the sidebar or explicitly exempted', () => {
    const hrefs = new Set(navHrefs());
    const unreachable = ownerPages().filter(
      (page) => !hrefs.has(`/${page}`) && !(page in NOT_IN_NAV),
    );

    expect(
      unreachable,
      `These owner pages ship with no way for a user to find them: ${unreachable.join(', ')}. ` +
        'Add a sidebar entry, or add an exemption to NOT_IN_NAV explaining how a person reaches it.',
    ).toEqual([]);
  });

  it('every exemption names a page that actually exists', () => {
    // An exemption for a deleted page is a stale excuse that would silently
    // cover a future page of the same name.
    const pages = new Set(ownerPages());
    const stale = Object.keys(NOT_IN_NAV).filter((p) => !pages.has(p));
    expect(stale, `Exemptions for pages that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });

  it('every sidebar link points at a page that exists', () => {
    const pages = new Set(ownerPages());
    const broken = navHrefs().filter((h) => !pages.has(h.replace(/^\//, '')));
    expect(broken, `Sidebar links to non-existent pages: ${broken.join(', ')}`).toEqual([]);
  });
});
