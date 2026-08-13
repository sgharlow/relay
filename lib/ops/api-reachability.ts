/**
 * Which HTTP handlers the product can actually reach.
 *
 * 🔴 THE RECURRING DEFECT IN THIS CODEBASE IS NOT A MISSING FEATURE. It is a
 * capability that was built to spec, unit-tested, and then never connected to
 * anything a person can reach — so it passes CI forever while doing nothing.
 * Four were found by hand between 2026-08-12 and 2026-08-13, the worst being
 * `PUT` and `DELETE /api/vault/items/[id]`: implemented, validated, audited and
 * tested, with no control anywhere in the product that called either. The vault
 * was append-only and nothing failed, because every test sat at the layer BELOW
 * the gap.
 *
 * This turns "somebody reads the manual carefully" into a machine check.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody trusts it further than it goes:
 *  - a column written and never read (`release_after_days` shipped that way).
 *    The guard for that class is a "every gate consults it" test, as in
 *    lib/rules/release-delay.test.ts.
 *  - a route that IS called but missing a guard its sibling has (the import cap).
 *  - a library function nobody calls. Tried and abandoned: most such exports are
 *    internal helpers exported for their own unit test, so the signal measured
 *    ~90% noise, and a check people learn to ignore is worse than no check.
 *
 * Deliberately string-matching rather than parsing. Half these URLs are built
 * from template literals, so an AST would have to evaluate them; a conservative
 * textual match errs toward calling something reachable, which is the right
 * direction for a guard whose false positives cost developer trust.
 *
 * Feature: relay-h0-mvp
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface Unreachable {
  route: string;
  method: HttpMethod;
}

/**
 * Handlers with no caller inside the product, and why that is correct.
 *
 * Every entry asserts that something OUTSIDE this codebase invokes it. Adding a
 * line here is how you say so — the cost of the check is that the claim has to
 * be written down and can be argued with.
 */
export const REACHED_FROM_OUTSIDE: Record<string, string> = {
  '/api/cron/heartbeat': 'Vercel Cron (vercel.json), hourly, bearer CRON_SECRET.',
  '/api/health/scheduler':
    'Probed by .github/workflows/scheduler-monitor.yml — the dead-man’s switch.',
  '/api/stripe/webhook': 'Stripe, signature-verified.',
  '/api/incident': 'Posted to by the error boundary, from a page that has already failed.',
};

/**
 * Handlers that ARE dead, listed rather than deleted.
 *
 * Removing a capability is a product decision; leaving one unlisted is an
 * accident. This is the difference, written down and dated. An entry here is a
 * debt with a name — not an exemption, and not a place to park something because
 * wiring it is inconvenient.
 *
 * Retirement, when it is decided, goes in docs/retired-surface.md with the
 * reason and the replacement. That is what happened to /api/ai/prioritize and
 * /api/ai/triage on 2026-08-13.
 */
export const KNOWN_UNREACHABLE: Record<string, string> = {
  'GET /api/people':
    'Superseded by /api/circle, which returns the same roster plus the coverage ' +
    'matrix the screen needs. Unused since the circle page was built. 2026-08-13.',
  'GET /api/policies':
    'Superseded by /api/circle, which embeds proposals. POST on the same route ' +
    'IS used, to accept one. 2026-08-13.',
  'PUT /api/policies/[id]':
    'No edit-a-policy surface exists; the flow is accept, then adjust the ' +
    'resulting rules on /rules. Retire or wire — undecided. 2026-08-13.',
  'DELETE /api/policies/[id]':
    'Policies are removed today only as a cascade of deleting the recipient. ' +
    'Whether an owner should be able to un-accept one directly is a real ' +
    'product question, so this is debt rather than dead code. 2026-08-13.',
  'PUT /api/rules/[id]':
    'A rule is changed by removing it and writing another — the builder sits ' +
    'directly beneath the list. Editing is redundant. 2026-08-13.',
  'GET /api/vault/items/[id]':
    'Fetching ONE item. The list endpoint returns the metadata every screen ' +
    'needs, and the ciphertext is never served to an owner — they re-encrypt on ' +
    'update rather than reading the old value back, because Relay cannot decrypt ' +
    'it. So there is nothing this returns that anything wants. 2026-08-13.',
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

/** `src/app/api/vault/items/[id]/route.ts` → `/api/vault/items/[id]`. */
export function routePathOf(file: string): string {
  return '/' + file.replace(/^src\/app\//, '').replace(/\/route\.ts$/, '');
}

/**
 * The part of a route a caller can spell literally. A call site writes
 * `/api/vault/items/${id}`, so only the segments before the first dynamic one
 * are comparable.
 */
export function literalPrefix(routePath: string): string {
  const parts = routePath.split('/');
  const stop = parts.findIndex((p) => p.startsWith('['));
  return (stop === -1 ? parts : parts.slice(0, stop)).join('/');
}

/**
 * Comments out, for the same reason: a header that says "POST /api/people/[id]
 * had existed with no caller" must not itself count as a caller. Crude by
 * design — it can only ever REMOVE evidence of reachability, so its failure mode
 * is a false alarm somebody investigates rather than a hole nobody sees.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, (c) => BACKSLASH + c);
}

/**
 * Call sites for one route, as offsets into the concatenated client source.
 *
 * ATTRIBUTED TO THE MOST SPECIFIC ROUTE. `/api/vault/items` and
 * `/api/vault/items/[id]` share a prefix, so a mention of the collection must
 * not vouch for the item route — that shared prefix is exactly what hid the
 * vault gap. A dynamic route therefore requires the prefix to be followed by a
 * separator and an interpolation; a static one requires the literal to END where
 * the path does.
 */
export function callSites(clientBlob: string, routePath: string): number[] {
  const prefix = escapeRe(literalPrefix(routePath));
  /*
    A CLOSING DELIMITER IS REQUIRED — there is no end-of-line alternative. A path
    that runs to the end of a line with nothing closing it is prose, not a call,
    and prose was crediting two endpoints as reachable purely because a comment
    named them. "Mentioned" is not "called", and that difference is the entire
    point of this check.
  */
  const pattern = routePath.includes('[')
    ? new RegExp(prefix + '/(?:\\$\\{|\\\\$)', 'g')
    : // `$` closes a static path too: `/api/verify${release ? '?…' : ''}` is a
      // call to /api/verify with an interpolated QUERY. A dynamic path segment
      // would put a `/` there instead, so the two stay distinguishable.
      new RegExp(prefix + '(?=[\'"`?$])', 'g');

  const out: number[] = [];
  for (const m of clientBlob.matchAll(pattern)) {
    if (m.index !== undefined) out.push(m.index);
  }
  return out;
}

/**
 * Is `method` used at any of these call sites?
 *
 * A window rather than an AST, for the template-literal reason above. 320
 * characters comfortably spans a fetch options object. A bare `fetch(url)` is a
 * GET, so an unadorned mention satisfies GET and nothing else.
 */
export function methodUsedNear(clientBlob: string, sites: number[], method: HttpMethod): boolean {
  return sites.some((i) => {
    const w = clientBlob.slice(Math.max(0, i - 320), i + 320);
    const explicit = new RegExp('[\'"`]' + method + '[\'"`]').test(w);
    if (method === 'GET') return explicit || !/method\s*:/.test(w);
    return explicit;
  });
}

export function findUnreachable(repoRoot = '.'): Unreachable[] {
  const root = repoRoot.split(BACKSLASH).join('/').replace(/\/$/, '');
  const rel = (p: string) => p.split(BACKSLASH).join('/').replace(root + '/', '');

  const all = walk(join(repoRoot, 'src')).concat(walk(join(repoRoot, 'lib'))).map(rel);

  const routeFiles = all.filter((f) => /^src\/app\/api\/.*\/route\.ts$/.test(f));
  const clientBlob = all
    .filter(
      (f) =>
        /\.tsx?$/.test(f) &&
        !f.includes('.test.') &&
        !f.startsWith('src/app/api/') &&
        /*
          THIS FILE MUST NOT VOUCH FOR ANYTHING. Its allowlists hold route paths
          as data, and while comments are stripped a string literal is not — so
          `'GET /api/people'` sitting in KNOWN_UNREACHABLE was making
          /api/people look reachable. An allowlist that silently satisfies the
          very check it belongs to is the worst failure a guard can have.
        */
        f !== 'lib/ops/api-reachability.ts',
    )
    .map((f) => stripComments(readFileSync(join(repoRoot, f), 'utf8')))
    .join('\n');

  const unreachable: Unreachable[] = [];

  for (const file of routeFiles) {
    const route = routePathOf(file);
    if (REACHED_FROM_OUTSIDE[route]) continue;

    const src = readFileSync(join(repoRoot, file), 'utf8');
    const sites = callSites(clientBlob, route);

    for (const method of HTTP_METHODS) {
      const declared = new RegExp('^export (?:async )?function ' + method + '\\b', 'm').test(src);
      if (!declared) continue;
      if (sites.length === 0 || !methodUsedNear(clientBlob, sites, method)) {
        unreachable.push({ route, method });
      }
    }
  }

  return unreachable;
}
