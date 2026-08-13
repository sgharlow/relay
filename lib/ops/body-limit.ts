/**
 * Which HTTP handlers read a request body without a ceiling on it.
 *
 * 🔴 THE CAP WAS A PROPERTY OF A HELPER, NOT OF THE ROUTES. `readJson()` grew a
 * 128 KB limit on 2026-08-13 and `PROJECT.yaml` recorded the debt as closed. It
 * was closed for the twenty-six handlers that called `readJson`. Sixteen others
 * called `req.json()` directly and were completely unbounded — including
 * `POST /api/vault/items` and `PUT /api/vault/items/[id]`, the two largest
 * payloads in the product, and `POST /api/kms/unwrap`, which parses a body
 * BEFORE it authenticates because the recipient token may arrive inside it.
 *
 * `lib/http/read-json-limit.test.ts` proved the helper refuses an oversized
 * body. Nothing asserted that a route USED the helper. That is the same shape
 * `api-reachability.ts` was written about — a guard tested one layer below the
 * gap it was meant to close — and its own header already names this exact class
 * as one it cannot catch: "a route that IS called but missing a guard its
 * sibling has (the import cap)."
 *
 * So this is the sibling check. Conversions are what it enforces; the check is
 * the thing that keeps them true.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody trusts it further than it goes:
 *  - a cap set absurdly high. It asserts a bound exists, not that the number is
 *    sensible. Picking the number is a judgement, and it belongs in review.
 *  - a body read by some route that never appears under src/app/api.
 *  - a handler that reads the raw stream itself rather than through either
 *    helper. That would have to be deliberate, and it is what ALLOWED_RAW is
 *    for — saying so out loud, with a reason.
 *
 * Textual by the same reasoning as api-reachability.ts: conservative matching
 * whose failure mode is a false alarm somebody investigates, never a hole
 * nobody sees.
 *
 * Feature: relay-h0-mvp
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BACKSLASH = String.fromCharCode(92);

/**
 * Handlers that read a body without `readJson`, and why that is correct.
 *
 * Every entry has to argue for itself. This is not a place to park a route
 * because converting it is inconvenient — that is precisely how sixteen of them
 * accumulated in the first place.
 */
export const ALLOWED_RAW: Record<string, string> = {
  '/api/stripe/webhook':
    'Reads req.text(), not req.json(): Stripe signature verification needs the ' +
    'byte-exact body, so it must not be parsed or re-encoded first. The body is ' +
    'refused outright unless it carries a valid signature from Stripe, and Stripe ' +
    'bounds its own event payloads.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p.split(BACKSLASH).join('/'));
  }
  return out;
}

/**
 * Comments out before matching.
 *
 * A header that says "this used to call req.json() directly" must not itself be
 * reported as calling it — and several of the converted routes now carry
 * exactly that sentence. Same crude-by-design rule as api-reachability.ts: it
 * can only ever REMOVE evidence of a violation, so its failure mode is a missed
 * alarm on a commented-out call rather than a permanent false positive that
 * teaches people to ignore the check.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/** `src/app/api/vault/items/[id]/route.ts` → `/api/vault/items/[id]`. */
export function routePathOf(file: string): string {
  return '/' + file.replace(/^src\/app\//, '').replace(/\/route\.ts$/, '');
}

export interface UncappedBodyRead {
  route: string;
  /** The literal call that has no ceiling on it. */
  call: string;
}

/**
 * Route handlers that parse a request body without going through a helper that
 * bounds it.
 */
export function findUncappedBodyReads(repoRoot = '.'): UncappedBodyRead[] {
  const root = repoRoot.split(BACKSLASH).join('/').replace(/\/$/, '');
  const rel = (p: string) => p.split(BACKSLASH).join('/').replace(root + '/', '');

  const routeFiles = walk(join(repoRoot, 'src', 'app', 'api'))
    .map(rel)
    .filter((f) => /\/route\.ts$/.test(f) && !f.includes('.test.'));

  const out: UncappedBodyRead[] = [];

  for (const file of routeFiles) {
    const route = routePathOf(file);
    if (ALLOWED_RAW[route]) continue;

    const src = stripComments(readFileSync(join(repoRoot, file), 'utf8'));

    /*
      `.json()` and `.text()` on the REQUEST are the two ways a body enters a
      handler. Both are matched; a handler that legitimately needs the raw body
      declares itself in ALLOWED_RAW rather than being silently tolerated.
    */
    for (const m of src.matchAll(/\b(?:req|request)\.(json|text)\(\)/g)) {
      out.push({ route, call: m[0] });
    }
  }

  return out;
}
