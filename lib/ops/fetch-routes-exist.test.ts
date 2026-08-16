/**
 * Every `/api/...` the product fetches is a route that exists.
 *
 * WHY, AND WHY NOTHING ELSE CAN SEE IT. `api-reachability.ts` answers "is this
 * handler reachable from the product?" — the direction that found `PUT` and
 * `DELETE /api/vault/items/[id]` implemented, validated, audited, tested, and
 * called by nothing. This is the other direction: a control in the UI that
 * fetches a path no `route.ts` serves.
 *
 * That one fails as a 404 the first time a person presses the button, and it is
 * invisible everywhere else. Component tests mock `fetch`, so the URL is never
 * resolved against anything. Route tests import the handler directly, so they
 * never see the caller's spelling. `tsc` has no opinion about the inside of a
 * string. The two layers that could each catch it both sit on the wrong side of
 * the gap — which is the same shape as every other defect this directory exists
 * for.
 *
 * ⚠️ IT WAS CLEAN WHEN WRITTEN, and that is the bar rather than a disappointment.
 * Sixty-three fetch sites across seventy-five routes, every one resolving. A
 * check introduced alongside the defect it catches proves only that the author
 * could write both; one introduced on a clean tree is a ratchet, and the planted
 * cases below are what prove it can still fail.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP_DIR = join(process.cwd(), 'src', 'app');
const SEARCH_DIRS = [join(process.cwd(), 'src'), join(process.cwd(), 'lib')];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Route patterns the app actually serves, as `/api/...` with `[param]` segments. */
export function servedRoutes(appDir: string = APP_DIR): string[] {
  return walk(join(appDir, 'api'))
    .filter((f) => f.endsWith('route.ts') && !f.includes('.test.'))
    .map((f) =>
      f
        .replace(/\\/g, '/')
        .slice(f.replace(/\\/g, '/').indexOf('/src/app') + '/src/app'.length)
        .replace(/\/route\.ts$/, ''),
    );
}

/**
 * Collapses a fetch target and a route pattern onto comparable shapes.
 *
 * 🔴 THE INTERPOLATION HAS TO BE EATEN WHOLE, and getting this wrong is how the
 * first version of this check produced its only false positive. The real call in
 * `LimitsNotice.tsx` reads:
 *
 *     fetch(`/api/access/acknowledge${token ? `?token=${...}` : ''}`, …)
 *
 * A lazy `\$\{[^}]*\}` stops at the FIRST `}`, which is inside a nested template
 * literal, leaving `/api/access/acknowledge${token ?` as the apparent path — and
 * the check reported a missing route for an endpoint that exists. Brace depth is
 * counted instead, so a nested `${}` inside a `${}` is consumed with its parent.
 */
export function normalise(path: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < path.length; i += 1) {
    const c = path[i];
    if (c === '$' && path[i + 1] === '{') {
      if (depth === 0) out += '*';
      depth += 1;
      i += 1;
    } else if (depth > 0 && c === '{') depth += 1;
    else if (depth > 0 && c === '}') depth -= 1;
    else if (depth === 0) out += c;
  }
  return out
    .replace(/\[[^\]]+\]/g, '*') // route params
    .replace(/\?.*$/, '') // query string
    .replace(/\/+$/, ''); // trailing slash
}

export interface FetchSite {
  target: string;
  file: string;
}

/** Every `/api/...` literal handed to `fetch`, with where it was written. */
export function fetchSites(dirs: string[] = SEARCH_DIRS): FetchSite[] {
  const sites: FetchSite[] = [];
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      if (!/\.tsx?$/.test(file) || file.includes('.test.')) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/fetch\(\s*[`'"](\/api\/[^`'"]*)/g)) {
        sites.push({ target: m[1], file: file.replace(/\\/g, '/') });
      }
    }
  }
  return sites;
}

/**
 * Does a normalised fetch target match a normalised route pattern?
 *
 * Segment-wise, and DEPTH IS STRICT: a fetch that interpolates an id must not
 * match a route of a different depth, or `/api/vault/items/${id}` would be
 * satisfied by `/api/vault/items` and the whole check would go quiet.
 *
 * 🔴 THE LITERAL PART OF A SEGMENT STILL HAS TO MATCH, and the first version of
 * this file got that wrong in a way worth recording. An interpolation is not
 * always a path parameter: the real call in `LimitsNotice.tsx` appends an
 * optional QUERY STRING inside one, so the target normalises to
 * `…/acknowledge*` against a route of `…/acknowledge`, and demanding an exact
 * segment reported a missing route for an endpoint that plainly exists. The
 * obvious repair — treat any segment containing `*` as a wildcard — made the
 * check WORSE THAN USELESS: `…/acknowledgement*` then matched `…/acknowledge`
 * too, and a real planted typo in that very file sailed through green. Three
 * checks in this repo have already passed on the exact defect they were written
 * for; this would have been the fourth, and it was caught only by planting the
 * typo in the tree rather than in a fixture array.
 *
 * So `*` expands to `.*` WITHIN the segment and the literal text around it must
 * still match. `acknowledge*` accepts `acknowledge`; `acknowledgement*` does
 * not. A route segment that is itself a parameter accepts anything, because the
 * route genuinely does.
 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function segmentMatches(targetSeg: string, routeSeg: string): boolean {
  if (routeSeg === '*') return true; // a route parameter accepts any value
  if (!targetSeg.includes('*')) return targetSeg === routeSeg;
  const pattern = targetSeg.split('*').map(escapeRe).join('.*');
  return new RegExp(`^${pattern}$`).test(routeSeg);
}

export function matches(target: string, route: string): boolean {
  const t = target.split('/');
  const r = route.split('/');
  if (t.length !== r.length) return false;
  return r.every((seg, i) => segmentMatches(t[i], seg));
}

export function unresolved(sites: FetchSite[], routes: string[]): FetchSite[] {
  const patterns = routes.map(normalise);
  return sites.filter((s) => !patterns.some((p) => matches(normalise(s.target), p)));
}

describe('every fetched /api path is served by a route', () => {
  const routes = servedRoutes();
  const sites = fetchSites();

  it('finds the routes and the call sites at all — a silent zero would pass vacuously', () => {
    // The failure mode of a filesystem check is finding nothing and reporting
    // success. Both sides are asserted non-trivial before anything is compared.
    expect(routes.length).toBeGreaterThan(40);
    expect(sites.length).toBeGreaterThan(30);
  });

  it('has no fetch pointing at a path nothing serves', () => {
    const bad = unresolved(sites, routes);
    expect(
      bad.map((b) => `${b.target}  <-  ${b.file}`),
      'these fetch targets match no route.ts — they 404 when pressed',
    ).toEqual([]);
  });

  describe('and it can still fail — proven, not assumed', () => {
    it('catches a fetch at a route that does not exist', () => {
      const planted = [{ target: '/api/vault/itmes', file: 'planted.tsx' }];
      expect(unresolved(planted, routes)).toHaveLength(1);
    });

    it('catches a fetch one segment too deep for the route it names', () => {
      const planted = [{ target: '/api/circle/${id}/rename', file: 'planted.tsx' }];
      expect(unresolved(planted, routes)).toHaveLength(1);
    });

    /*
      The regression that produced this check's only false positive. If brace
      depth is ever dropped from `normalise`, this is the case that notices —
      and a check that cries wolf on correct code is one people delete.
    */
    it('does NOT flag an interpolation containing a nested template literal', () => {
      const real = [
        {
          target: '/api/access/acknowledge${token ? `?token=${encodeURIComponent(token)}` : \'\'}',
          file: 'LimitsNotice.tsx',
        },
      ];
      expect(unresolved(real, routes)).toEqual([]);
    });

    it('does not let a shorter route stand in for a deeper fetch', () => {
      expect(matches('/api/vault/items/*', '/api/vault/items')).toBe(false);
    });

    /*
      🔴 THE BUG THIS FILE ITSELF SHIPPED FOR TEN MINUTES. Repairing the false
      positive above by treating any segment containing `*` as a full wildcard
      made `…/acknowledgement*` match `…/acknowledge` — so a genuine typo in a
      real component passed green, and the check could no longer catch the one
      thing it was written to catch. The literal text either side of an
      interpolation is evidence and must still match.

      Found by planting the typo in the tree, which the fixture cases above had
      all missed. That is the difference between testing a function and testing a
      check.
    */
    it('an interpolation does not turn its segment into a free pass', () => {
      expect(matches('/api/access/acknowledge*', '/api/access/acknowledge')).toBe(true);
      expect(matches('/api/access/acknowledgement*', '/api/access/acknowledge')).toBe(false);
      expect(matches('/api/access/*ledge', '/api/access/acknowledge')).toBe(true);
    });

    it('a route parameter still accepts any value, because the route does', () => {
      expect(matches('/api/vault/items/abc', '/api/vault/items/*')).toBe(true);
    });
  });
});
