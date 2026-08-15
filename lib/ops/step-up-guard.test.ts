/**
 * The sensitive handlers actually call the guard.
 *
 * `step-up.test.ts` proves the guard refuses an unelevated request. It could
 * never prove that a route calls it — which is the exact gap that let sixteen
 * handlers read unbounded request bodies for a day after PROJECT.yaml recorded
 * that debt as closed. A guard that lives in a helper is a guard on the helper.
 *
 * So this scans the filesystem instead of importing anything, and it checks the
 * direction that decays: a NEW route added beside the guarded ones, silently
 * unguarded, is the failure nobody would otherwise notice.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  STEP_UP_REQUIRED,
  STEP_UP_EXEMPT,
  UNELEVATED_METHODS,
  callsStepUpGuard,
  findUnguardedSensitiveRoutes,
  findUndeclaredAccountRoutes,
} from './step-up-guard';
import { stripComments } from './body-limit';
import { STEP_UP_TTL_SECONDS } from '../auth/step-up';

describe('sensitive routes are elevation-guarded', () => {
  it('every declared route calls a guard', () => {
    const unguarded = findUnguardedSensitiveRoutes('.');
    expect(
      unguarded,
      unguarded.length
        ? 'These handlers are declared sensitive but call no step-up guard:\n' +
          unguarded.map((r) => `  ${r}`).join('\n') +
          '\n\nCall requireStepUp(req, ownerId) — or requireStepUpOnce for an ' +
          'action with no undo, which consumes the elevation that authorised it.'
        : 'ok',
    ).toEqual([]);
  });

  /*
    The direction that decays. Adding an endpoint next to the guarded ones is the
    natural way to add a capability, and nothing else would notice the new one
    runs on a bare 24-hour session.
  */
  it('no handler under /api/account is neither declared nor exempted', () => {
    const undeclared = findUndeclaredAccountRoutes('.');
    expect(
      undeclared,
      undeclared.length
        ? 'New handlers under /api/account that nobody classified:\n' +
          undeclared.map((r) => `  ${r}`).join('\n') +
          '\n\nAdd it to STEP_UP_REQUIRED and guard it, or to STEP_UP_EXEMPT ' +
          'with the reason it needs no elevation.'
        : 'ok',
    ).toEqual([]);
  });

  it('every declaration and exemption carries a real reason', () => {
    for (const [route, reason] of Object.entries({
      ...STEP_UP_REQUIRED,
      ...STEP_UP_EXEMPT,
      ...UNELEVATED_METHODS,
    })) {
      expect(reason.length, `${route} needs a real reason, not a placeholder`).toBeGreaterThan(40);
    }
  });

  it('declared routes still exist', () => {
    for (const route of [...Object.keys(STEP_UP_REQUIRED), ...Object.keys(STEP_UP_EXEMPT)]) {
      const file = join('src/app', route.replace(/^\//, ''), 'route.ts');
      expect(() => readFileSync(file, 'utf8'), `${route} is declared but gone`).not.toThrow();
    }
  });

  /*
    🔴 THE CHECK MUST BE ABLE TO FAIL. A scanner whose regex never matches looks
    exactly like a clean codebase, and this repo has already shipped a guard that
    passed on the very defect it was written for. Plant a violation; watch it
    get caught.
  */
  it('catches an unguarded account route when one is planted', () => {
    const root = join(tmpdir(), `relay-stepup-${process.pid}`);
    const dir = join(root, 'src/app/api/account/planted');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(dir + '/route.ts', 'export async function POST() { return null; }\n');
      expect(findUndeclaredAccountRoutes(root)).toEqual(['/api/account/planted']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not accept a guard that appears only in a comment', () => {
    expect(callsStepUpGuard('// this used to call requireStepUp(req, id)\nexport const x = 1;')).toBe(
      false,
    );
    expect(callsStepUpGuard('/* requireStepUpOnce(req, id) */\nexport const x = 1;')).toBe(false);
    expect(callsStepUpGuard('const e = await requireStepUp(req, auth.ownerId);')).toBe(true);
    expect(callsStepUpGuard('const e = await requireStepUpOnce(req, auth.ownerId);')).toBe(true);
  });

  /*
    Closing an account is the only action in the product with no undo and with
    third parties depending on the outcome. It must SPEND the elevation, so
    nothing else can ride the same proof — pinned because `requireStepUpOnce` is
    exactly the sort of thing a tidy-up would "simplify" to the other one.
  */
  it('account closure spends its elevation rather than leaving the window open', () => {
    const src = readFileSync('src/app/api/account/route.ts', 'utf8');
    expect(src).toMatch(/requireStepUpOnce\(req,\s*auth\.ownerId\)/);
  });

  it('the export and recovery-code routes hold the window open instead', () => {
    for (const f of [
      'src/app/api/account/export/route.ts',
      'src/app/api/account/recovery-codes/route.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/requireStepUp\(req,\s*auth\.ownerId\)/);
      expect(src).not.toMatch(/requireStepUpOnce\(/);
    }
  });
});

/**
 * The public security page makes this promise in plain words. It has to be true.
 *
 * Same rule and same reason as `guide-claims.test.ts`: a fact stated in two
 * places drifts, and /security is a marketing surface with nothing connecting it
 * to the constants it describes. Nobody re-reads a FAQ when they change a number
 * in step-up.ts — and this particular answer is read by somebody deciding
 * whether to put a parent's bank login into a website, which makes an
 * out-of-date reassurance worse than none.
 */
describe('the security page describes the elevation the code enforces', () => {
  const page = readFileSync('src/app/security/page.tsx', 'utf8');

  it('names the same window the code enforces', () => {
    expect(STEP_UP_TTL_SECONDS).toBe(300);
    expect(page).toMatch(/lasts five minutes/);
  });

  it('claims exactly as many guarded actions as there are', () => {
    // "The three things that would outlast the session".
    expect(Object.keys(STEP_UP_REQUIRED)).toHaveLength(3);
    expect(page).toMatch(/three things that would outlast the session/);
    // And names them, so the count and the list cannot drift apart.
    for (const phrase of ['exporting everything', 'issuing new recovery codes', 'closing the account']) {
      expect(page).toContain(phrase);
    }
  });

  /*
    "Signing out ends it immediately, everywhere, not just on that machine" is a
    claim about a server-side revoke, not about dropping a cookie. It is only
    true because endSession() calls DELETE /api/account/step-up before signOut.
  */
  it('the sign-out path really does revoke elevation server-side', () => {
    const endSession = readFileSync('src/hooks/useEndSession.ts', 'utf8');
    expect(endSession).toMatch(/\/api\/account\/step-up/);
    expect(endSession).toMatch(/method:\s*'DELETE'/);
    expect(page).toMatch(/Signing out ends it immediately, everywhere/);

    for (const f of [
      'src/app/(owner)/_components/SidebarNav.tsx',
      'src/app/(access)/_components/SignOutControl.tsx',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must sign out through endSession`).toMatch(/endSession\(/);
      // Calling signOut directly would drop the session and leave the elevation
      // row live — the exact thing the sentence promises does not happen.
      expect(stripComments(src)).not.toMatch(/\bsignOut\s*\(/);
    }
  });

  it('does not promise export without the prompt it now shows', () => {
    expect(page).toMatch(/asks for your authenticator code first/);
  });
});
