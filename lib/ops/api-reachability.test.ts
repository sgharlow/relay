/**
 * The gate: no HTTP handler the product cannot reach.
 *
 * 🔴 WHY THIS EXISTS. The recurring defect in this codebase is not a missing
 * feature — it is a capability built to spec, unit-tested, and never connected
 * to anything a person can reach. It then passes CI forever while doing nothing,
 * because every test sits at the layer BELOW the gap. Four were found by hand in
 * two days, the worst being `PUT` and `DELETE /api/vault/items/[id]`: the vault
 * could not be corrected or emptied, and nothing failed.
 *
 * Anything this flags has exactly three honest resolutions:
 *   1. wire it — it was meant to be reachable;
 *   2. retire it, recording why in docs/retired-surface.md;
 *   3. name it in KNOWN_UNREACHABLE or REACHED_FROM_OUTSIDE, which converts a
 *      silent hole into a dated, arguable claim.
 * Editing the allowlist to make a red build green, without one of those, is the
 * failure this is here to prevent.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import {
  findUnreachable,
  findUnlinkedPages,
  stripImports,
  PAGES_REACHED_WITHOUT_A_LINK,
  callSites,
  methodUsedNear,
  routePathOf,
  literalPrefix,
  KNOWN_UNREACHABLE,
  REACHED_FROM_OUTSIDE,
} from './api-reachability';

describe('route path parsing', () => {
  it('maps a route file to its URL', () => {
    expect(routePathOf('src/app/api/vault/items/[id]/route.ts')).toBe('/api/vault/items/[id]');
    expect(routePathOf('src/app/api/checkin/route.ts')).toBe('/api/checkin');
  });

  it('keeps only the segments a caller can spell literally', () => {
    expect(literalPrefix('/api/vault/items/[id]')).toBe('/api/vault/items');
    expect(literalPrefix('/api/people/[id]/break-glass')).toBe('/api/people');
    expect(literalPrefix('/api/checkin')).toBe('/api/checkin');
  });
});

describe('call-site attribution', () => {
  /*
    THE CASE THAT HID THE VAULT GAP. `/api/vault/items` and its `[id]` sibling
    share a prefix, so a mention of the collection must not vouch for the item
    route — otherwise a page that merely LISTS items makes update and delete look
    wired.
  */
  it('a mention of the collection does not vouch for the item route', () => {
    const client = `const res = await fetch('/api/vault/items');`;
    expect(callSites(client, '/api/vault/items')).toHaveLength(1);
    expect(callSites(client, '/api/vault/items/[id]')).toHaveLength(0);
  });

  it('an interpolated id does attribute to the item route', () => {
    const client = 'await fetch(`/api/vault/items/${id}`, { method: "DELETE" });';
    expect(callSites(client, '/api/vault/items/[id]')).toHaveLength(1);
  });

  it('does not match a longer path that merely starts the same', () => {
    const client = `fetch('/api/access-requests')`;
    expect(callSites(client, '/api/access')).toHaveLength(0);
  });
});

describe('method detection', () => {
  const client = 'await fetch(`/api/x/${id}`, { method: "DELETE" });';
  const sites = [client.indexOf('/api/x')];

  it('finds the verb used at the call site', () => {
    expect(methodUsedNear(client, sites, 'DELETE')).toBe(true);
  });

  it('does not credit a verb used somewhere else entirely', () => {
    expect(methodUsedNear(client, sites, 'PUT')).toBe(false);
  });

  it('treats a bare fetch as a GET', () => {
    const bare = `const r = await fetch('/api/y');`;
    expect(methodUsedNear(bare, [bare.indexOf('/api/y')], 'GET')).toBe(true);
  });

  it('does not treat an explicit POST as a GET', () => {
    const post = `fetch('/api/y', { method: 'POST' })`;
    expect(methodUsedNear(post, [post.indexOf('/api/y')], 'GET')).toBe(false);
  });
});

describe('the repository has no unreachable handler', () => {
  const unreachable = findUnreachable('.');
  const named = (u: { method: string; route: string }) => `${u.method} ${u.route}`;

  it('every handler is reachable, retired, or named', () => {
    const unaccounted = unreachable.filter((u) => !KNOWN_UNREACHABLE[named(u)]);
    expect(
      unaccounted.map(named),
      'Unreachable HTTP handler with no caller. Wire it, retire it (recording why ' +
        'in docs/retired-surface.md), or name it in KNOWN_UNREACHABLE with a reason ' +
        'and a date. See lib/ops/api-reachability.ts.',
    ).toEqual([]);
  });

  /*
    An allowlist nobody prunes becomes a place to hide things. If an entry no
    longer describes a real handler, the debt was paid or the route was deleted —
    either way the line should go, and this is what says so.
  */
  it('no stale entry in KNOWN_UNREACHABLE', () => {
    const live = new Set(unreachable.map(named));
    const stale = Object.keys(KNOWN_UNREACHABLE).filter((k) => !live.has(k));
    expect(stale, 'These are listed as unreachable but are not. Remove the entries.').toEqual([]);
  });

  /*
    THE EMPTY STATE IS THE DEFAULT, ASSERTED — 2026-08-13.

    This list held six handlers, two of them explicitly marked undecided, and a
    release is exactly what turns an undecided item into a permanent one. All
    six were retired. Making empty the asserted default means the next entry has
    to argue for itself in review, rather than being added quietly and then
    inherited by whoever reads the file in six months.

    This is not a ban. If a handler must genuinely land before its screen does,
    add it with a reason and a date and change this test in the same commit —
    that is a decision, and it will be visible as one.
  */
  it('nothing is parked as permanently unreachable', () => {
    expect(
      Object.keys(KNOWN_UNREACHABLE),
      'A handler has been added to KNOWN_UNREACHABLE. That is allowed, but it is ' +
        'a product decision and not a parking space: retiring it into ' +
        'docs/retired-surface.md or wiring it to a screen are both better ' +
        'endings. If it truly must wait, update this expectation deliberately.',
    ).toEqual([]);
  });

  it('every external caller is claimed with a reason, not a bare path', () => {
    for (const [route, why] of Object.entries(REACHED_FROM_OUTSIDE)) {
      expect(why.length, `${route} needs a reason saying what calls it`).toBeGreaterThan(20);
    }
  });
});

describe('pages a person can actually get to', () => {
  /*
    🔴 THE SAME DEFECT ONE LAYER UP. `/challenge` — where an owner answers a
    request for access — was linked only from a notification email. The API gate
    could not see it, because the endpoint behind that page WAS called: by the
    page nobody could reach. The window is two hours and it escalates to the
    verifiers when it lapses, so a filtered email meant an owner first learned
    they had been asked when their circle was already being polled.
  */
  it('every page is linked, or listed with how it is reached', () => {
    expect(
      findUnlinkedPages('.'),
      'A page with no link, redirect or config pointing at it. Link it, or add it ' +
        'to PAGES_REACHED_WITHOUT_A_LINK saying how somebody arrives there.',
    ).toEqual([]);
  });

  it('every no-link page says how it is reached', () => {
    for (const [route, why] of Object.entries(PAGES_REACHED_WITHOUT_A_LINK)) {
      expect(why.length, `${route} needs a reason`).toBeGreaterThan(20);
    }
  });

  /*
    A module path is not a link. `from '../../lib/release/challenge'` ends in
    `/challenge'`, which is indistinguishable from an href to a textual matcher —
    and it made the check above pass on the exact defect it was written to catch.
    Proved by deleting the real link and watching the result stay green.
  */
  it('an import specifier does not count as a link', () => {
    const src = [
      "import { respondToChallenge } from '../../lib/release/challenge';",
      'const x = 1;',
    ].join('\n');
    expect(stripImports(src)).not.toContain('/challenge');
  });

  it('a real href survives stripping', () => {
    const src = ["import x from './y';", "const link = { href: '/challenge' };"].join('\n');
    expect(stripImports(src)).toContain("'/challenge'");
  });
});
