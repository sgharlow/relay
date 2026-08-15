/**
 * Which sensitive handlers actually call the step-up guard.
 *
 * WHY THIS EXISTS AT ALL, and it is not a general principle — it is a specific
 * scar. On 2026-08-13 a request-body cap was written into `readJson`, recorded
 * in PROJECT.yaml as closed, and was closed for the twenty-six routes that
 * called that helper while sixteen others read `req.json()` directly and stayed
 * completely unbounded. `read-json-limit.test.ts` proved the helper refused an
 * oversized body; nothing asserted a route USED the helper. A cap that lives in
 * a helper is a cap on the helper.
 *
 * Step-up has exactly the same shape — a guard in `lib/auth/step-up.ts` that is
 * worth nothing on any route that forgets to call it — so it gets the same
 * sibling check on the day it ships rather than after the same lesson twice.
 *
 * TWO DIRECTIONS, because one of them is the one that decays:
 *
 *  1. Every route named below must call a guard. This catches a refactor that
 *     drops the call.
 *  2. Every handler under /api/account must be either named below or exempted
 *     WITH A REASON. This catches the thing nobody thinks to check: a new
 *     sensitive endpoint added next to the guarded ones, silently unguarded.
 *     The second is why this file is worth more than a test per route.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody trusts it further than it goes:
 *  - a guard called on the wrong branch, or after the sensitive work.
 *    Placement is judgement and belongs in review.
 *  - a sensitive route outside /api/account that nobody remembered to declare.
 *    Direction 2 is scoped to the directory the sensitive actions live in;
 *    widening it to every route would declare most of the product sensitive and
 *    the list would be ignored within a month.
 *  - whether the elevation window is the right length. That is a number, and
 *    numbers are argued for in the module that sets them.
 *
 * Textual matching, conservative by the same reasoning as `body-limit.ts` and
 * `api-reachability.ts`: its failure mode is a false alarm somebody investigates,
 * never a hole nobody sees.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1, J13-R1, J13-R2
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments, routePathOf } from './body-limit';

/**
 * Handlers that must not run on a 24-hour session alone.
 *
 * The test is "would finding this machine unlocked hand somebody something that
 * OUTLIVES the session, or something irreversible?" Reading a count of recovery
 * codes does not. Minting new ones does.
 */
export const STEP_UP_REQUIRED: Record<string, string> = {
  '/api/account/recovery-codes':
    'POST mints a sheet that is the way back into the account and outlives every ' +
    'session — there is no password to change afterwards that would take it away.',
  '/api/account/export':
    'GET hands over every wrapped key in the vault; the browser unwraps them and ' +
    'writes plaintext to disk. One click from a complete unprotected copy.',
  '/api/account':
    'DELETE is the one action with no undo, and third parties lose their standby ' +
    'access the moment it completes. Typing an address that is already on screen ' +
    'proves somebody read the warning, not that they are the owner.',
};

/**
 * Handlers under /api/account that legitimately need no elevation.
 *
 * Every entry argues for itself. This is not somewhere to park a route because
 * wiring the guard is inconvenient — that is precisely how sixteen unbounded
 * body reads accumulated.
 */
export const STEP_UP_EXEMPT: Record<string, string> = {
  '/api/account/step-up':
    'This IS the elevation endpoint. Guarding it with itself is a deadlock: ' +
    'nobody could ever obtain the elevation it demands.',
};

/**
 * Methods on an otherwise-guarded route that deliberately run unelevated, and
 * why. Read-only and low-consequence writes; the guard sits on the method that
 * needs it rather than on the file.
 */
export const UNELEVATED_METHODS: Record<string, string> = {
  '/api/account/recovery-codes#GET':
    'Returns a COUNT, never a code. Somebody has to be able to discover they are ' +
    'on their last one without ceremony — the whole reason the count exists.',
  '/api/account#PATCH':
    'Changes a display name. Reversible, carries nothing, and re-prompting for a ' +
    'typo fix teaches people to dismiss the prompt.',
};

const BACKSLASH = String.fromCharCode(92);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p.split(BACKSLASH).join('/'));
  }
  return out;
}

function accountRouteFiles(repoRoot: string): string[] {
  const root = repoRoot.split(BACKSLASH).join('/').replace(/\/$/, '');
  const rel = (p: string) => p.split(BACKSLASH).join('/').replace(root + '/', '');
  return walk(join(repoRoot, 'src', 'app', 'api', 'account'))
    .map(rel)
    .filter((f) => /\/route\.ts$/.test(f) && !f.includes('.test.'));
}

/**
 * Does this handler file call either guard?
 *
 * `(Once)?` and NOT `Once?` — the second reads as "requireStepUpOnc" with an
 * optional trailing "e", which matches the burning guard and misses the ordinary
 * one entirely. It was written that way for about ten minutes and the check
 * reported two correctly-guarded routes as unguarded, which is the good failure
 * direction and exactly why the planted-violation test exists.
 */
export function callsStepUpGuard(source: string): boolean {
  return /\brequireStepUp(Once)?\s*\(/.test(stripComments(source));
}

/** Declared as needing elevation, but nothing in the file calls a guard. */
export function findUnguardedSensitiveRoutes(repoRoot = '.'): string[] {
  return Object.keys(STEP_UP_REQUIRED).filter((route) => {
    const file = join(repoRoot, 'src', 'app', route.replace(/^\//, ''), 'route.ts');
    return !callsStepUpGuard(readFileSync(file, 'utf8'));
  });
}

/**
 * A handler under /api/account that is neither declared sensitive nor exempted.
 *
 * This is the direction that decays. Adding a route beside the guarded ones is
 * the natural way to add a capability, and nothing else in the codebase would
 * notice that the new one runs on a bare session.
 */
export function findUndeclaredAccountRoutes(repoRoot = '.'): string[] {
  return accountRouteFiles(repoRoot)
    .map(routePathOf)
    .filter((route) => !STEP_UP_REQUIRED[route] && !STEP_UP_EXEMPT[route]);
}
