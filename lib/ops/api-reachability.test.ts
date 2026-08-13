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

  it('every external caller is claimed with a reason, not a bare path', () => {
    for (const [route, why] of Object.entries(REACHED_FROM_OUTSIDE)) {
      expect(why.length, `${route} needs a reason saying what calls it`).toBeGreaterThan(20);
    }
  });
});
