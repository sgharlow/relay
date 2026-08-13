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
const ACCESS_DIR = join(process.cwd(), 'src/app/(access)');
/** The app root, for pages outside both route groups — /help, /security, /terms. */
const ROOT_DIR = join(process.cwd(), 'src', 'app');

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

function pagesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('('))
    .map((d) => d.name);
}

function ownerPages(): string[] {
  return pagesIn(OWNER_DIR);
}

/**
 * Route groups do not appear in the URL, so an owner-sidebar link may legitimately
 * point into (access) — and one does. §3.7 allows the same human to own a vault
 * AND stand by for other people, and owner mode previously linked to /standby
 * from nowhere at all, which left a both-hats user unable to reach the screen
 * that matters most when it matters. The link is conditional on actually
 * standing by for somebody, so it never shows for an owner it does not concern.
 *
 * The guard keeps its teeth: the destination still has to EXIST somewhere.
 */
function linkablePages(): string[] {
  /*
    Route groups AND the app root. The sidebar may point anywhere a person can
    actually land, and on 2026-08-13 it gained /help — which lives at the root
    on purpose, because a standby contact and a lost visitor need it as much as
    an owner does, and a page inside `(owner)/` is behind an owner session.

    This test failed on that link, which was the guard being narrow rather than
    the link being wrong: it only knew about the two route groups.
  */
  return [...pagesIn(OWNER_DIR), ...pagesIn(ACCESS_DIR), ...pagesIn(ROOT_DIR)];
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
    const pages = new Set(linkablePages());
    const broken = navHrefs().filter((h) => !pages.has(h.replace(/^\//, '')));
    expect(broken, `Sidebar links to non-existent pages: ${broken.join(', ')}`).toEqual([]);
  });

  it('links the both-hats user to their standby page', () => {
    // Regression guard for the reachability defect found on 2026-08-12: owner
    // mode linked to /standby from nowhere, so somebody who both owned a vault
    // and stood by for a parent could not get to the page that tells them
    // whether they are needed.
    expect(navHrefs()).toContain('/standby');
  });
});
