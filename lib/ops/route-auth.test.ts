/**
 * Every API handler establishes who is calling it, or says why it does not.
 *
 * The codebase already had this shape of check twice — `body-limit.ts` for
 * request bodies, `step-up-guard.ts` for elevation — and not for the guard both
 * of those presuppose. `api-reachability.ts` even names the gap in its own list
 * of what it cannot catch: "a route that IS called but missing a guard its
 * sibling has".
 *
 * NOTHING WAS BROKEN WHEN THIS WAS WRITTEN. All seventy-five handlers resolved,
 * and the one that looked alarming in a first pass — `/api/vault/items`, with no
 * `requireOwner` anywhere in it — authenticates through `resolveActor`, which
 * reads `getOwnerSession` and returns its 401. That near-miss is the argument
 * for the check rather than against it: a scan with an incomplete vocabulary
 * reported the vault as unguarded, and only reading the code settled it. Now the
 * vocabulary is written down.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  AUTHENTICATORS,
  PUBLIC_ROUTES,
  authenticates,
  findUnauthenticatedRoutes,
} from './route-auth';

describe('every handler authenticates or argues that it should not', () => {
  it('no route is silently open', () => {
    const open = findUnauthenticatedRoutes('.');
    expect(
      open,
      open.length
        ? 'These handlers neither authenticate nor are declared public:\n' +
          open.map((r) => `  ${r.methods.join(',').padEnd(18)} ${r.route}`).join('\n') +
          '\n\nCall requireOwner(req) / resolveActor() for a session, verify a ' +
          'scoped token, or check a shared secret. If it is genuinely public, ' +
          'add it to PUBLIC_ROUTES in lib/ops/route-auth.ts with the reason — ' +
          'in the same commit, so the claim can be argued with.'
        : 'ok',
    ).toEqual([]);
  });

  it('every public entry carries a real reason', () => {
    for (const [route, reason] of Object.entries(PUBLIC_ROUTES)) {
      expect(reason.length, `${route} needs a real reason, not a placeholder`).toBeGreaterThan(60);
    }
  });

  /*
    A REASON THAT CANNOT BE FALSIFIED IS DECORATION. Several entries defend
    themselves by saying the route is rate-limited or answers a constant status —
    which are checkable claims, and an allowlist whose justifications drift out of
    date is worse than one with none, because it reads as considered.

    This repo has the lesson already: a gate's evidence script is part of the
    gate. So the prose is held to the code it describes.
  */
  it('a public entry that claims rate limiting actually rate-limits', () => {
    const broken: string[] = [];
    for (const [route, reason] of Object.entries(PUBLIC_ROUTES)) {
      if (!/rate.?limit/i.test(reason)) continue;
      const src = readFileSync(join('src/app', route.replace(/^\//, ''), 'route.ts'), 'utf8');
      if (!/\brateLimit\s*\(/.test(src)) broken.push(route);
    }
    expect(
      broken,
      broken.length
        ? 'These entries say they are rate-limited and are not:\n' + broken.map((r) => `  ${r}`).join('\n')
        : 'ok',
    ).toEqual([]);
  });

  it('a public entry that claims a constant status actually returns one', () => {
    for (const route of ['/api/csp-report', '/api/incident']) {
      const src = readFileSync(join('src/app', route.replace(/^\//, ''), 'route.ts'), 'utf8');
      expect(PUBLIC_ROUTES[route], `${route} should still be declared public`).toMatch(/204/);
      // Nothing may answer with a status that varies — that is what makes an
      // unauthenticated reporting endpoint unprobeable.
      expect(src, `${route} claims a constant 204`).toMatch(/204/);
      expect(src).not.toMatch(/status:\s*(400|401|403|404|500)\b/);
    }
  });

  it('public entries still exist as routes', () => {
    for (const route of Object.keys(PUBLIC_ROUTES)) {
      const file = join('src/app', route.replace(/^\//, ''), 'route.ts');
      expect(() => readFileSync(file, 'utf8'), `${route} is declared public but gone`).not.toThrow();
    }
  });

  /*
    🔴 THE CHECK MUST BE ABLE TO FAIL. A scanner whose regex never matches looks
    exactly like a clean codebase — and one in this repo did exactly that, twice:
    api-reachability's module-specifier false positive, and step-up-guard's
    `Once?` typo, which read as "requireStepUpOnc" plus an optional "e" and
    missed the ordinary guard entirely. Plant a violation; watch it get caught.
  */
  it('catches an unauthenticated handler when one is planted', () => {
    const root = join(tmpdir(), `relay-routeauth-${process.pid}`);
    const dir = join(root, 'src/app/api/planted');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        dir + '/route.ts',
        'export async function POST() {\n  return Response.json({ secret: 1 });\n}\n',
      );
      expect(findUnauthenticatedRoutes(root)).toEqual([
        { route: '/api/planted', methods: ['POST'] },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not accept an authenticator that appears only in a comment', () => {
    expect(authenticates('// const a = await requireOwner(req);\nexport const x = 1;')).toBe(false);
    expect(authenticates('/* getOwnerSession() used to be here */\nexport const x = 1;')).toBe(false);
    expect(authenticates('const a = await requireOwner(req);')).toBe(true);
  });

  /*
    The near-miss that motivated the vocabulary being written down rather than
    remembered. A first scan without `resolveActor` reported the VAULT as
    unauthenticated.
  */
  it('recognises the delegate-aware session read the vault uses', () => {
    expect([...AUTHENTICATORS]).toContain('resolveActor');
    expect(authenticates('const actor = await resolveActor(targetOwnerId);')).toBe(true);

    const vault = readFileSync('src/app/api/vault/items/route.ts', 'utf8');
    expect(authenticates(vault)).toBe(true);
  });

  /*
    The three shapes of authentication the header describes, pinned so that
    removing one from the vocabulary is a visible change rather than a quiet
    widening of what counts.
  */
  it('recognises sessions, scoped tokens and shared secrets — and nothing else', () => {
    expect([...AUTHENTICATORS].sort()).toEqual(
      [
        'constructEvent',
        'getOwnerSession',
        'redeemBreakGlass',
        'redeemRecipientCode',
        'redeemVerifierCode',
        'requireOwner',
        'resolveActor',
        'timingSafeEquals',
        'verifyRecipientToken',
        'verifySvixSignature',
        'verifyVerifierToken',
      ].sort(),
    );
  });

  /*
    A credential that arrives in the body is still a credential. Stated as a test
    so that `/api/access/code` is not later "tidied" into PUBLIC_ROUTES, which
    would read as one more open endpoint when it is nothing of the sort.
  */
  it('treats a redeemed single-use code as authentication, not as public', () => {
    expect(PUBLIC_ROUTES['/api/access/code']).toBeUndefined();
    expect(PUBLIC_ROUTES['/api/verify/code']).toBeUndefined();
    expect(authenticates(readFileSync('src/app/api/access/code/route.ts', 'utf8'))).toBe(true);
    expect(authenticates(readFileSync('src/app/api/verify/code/route.ts', 'utf8'))).toBe(true);
  });
});
