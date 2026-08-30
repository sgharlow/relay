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
  /*
    ⚠️ THESE TWO BECAME CALLERLESS ON 2026-08-21 AND ARE DELIBERATELY KEPT.

    J4-R1 replaced the two single-role add forms on /circle with one
    add-a-person form, so no screen POSTs to either route any more and this
    check went red — correctly, and for a change that was itself correct.

    They are NOT retired, because deleting them would break the release gate.
    `scripts/` is outside this checker's scan roots (it walks `src/` and `lib/`
    only, see `candidates()`), so callers there are invisible to it — and every
    one of the five `verify:live` walks builds its circle through these two
    endpoints, as do `disposable-owner.ts`, `capture-screens.ts` and
    `invite-cohort.ts`. That is a checkable claim rather than an assurance:
    `grep -rn "api/recipients\|api/verifiers" scripts/` lists them.

    So the honest state is "reached, by an operator-run tool rather than by a
    screen", which is what this list is for. If the walks are ever rewritten to
    drive the unified endpoint, these entries should go and the routes should be
    retired into docs/retired-surface.md — not left sitting here.
  */
  'POST /api/recipients':
    'No screen POSTs it since the unified add-a-person form (2026-08-21). Still the ' +
    'endpoint every verify:live walk, disposable-owner.ts and invite-cohort.ts use to ' +
    'build a circle — deleting it breaks the release gate. GET is deliberately NOT ' +
    'exempted and is still checked: the rule builder on /rules reads it ' +
    '(src/app/(owner)/rules/RulesPageClient.tsx).',
  'POST /api/verifiers':
    'Same as POST /api/recipients: callerless in the UI since the unified add form, ' +
    'still used by the live walks, capture-screens.ts and invite-cohort.ts. GET stays ' +
    'checked here too — though note it is currently satisfied only by the bare ' +
    "'/api/verifiers' literal in PeopleSections' useRemove, which this checker reads " +
    'as a GET because an unadorned mention counts as one.',
  '/api/cron/heartbeat': 'Vercel Cron (vercel.json), hourly, bearer CRON_SECRET.',
  '/api/health/scheduler':
    'Probed by .github/workflows/scheduler-monitor.yml — the dead-man’s switch.',
  '/api/health/delivery-webhook':
    'Probed daily by .github/workflows/delivery-webhook-monitor.yml — the same ' +
    'shape of switch, for the mail telemetry rather than the cron. Without it, ' +
    'Resend silently ceasing to deliver events leaves /circle blind about every ' +
    'address while looking exactly like a quiet week.',
  '/api/health/reminders':
    'Probed daily by .github/workflows/reminder-ladder-monitor.yml. The ladder ' +
    'has never fired for anybody; its first firing is the live owner’s 75% ' +
    'rung, and `sweepCheckinReminders` never throws, so without this probe a ' +
    'ladder that silently stopped would look exactly like a ladder not yet due.',
  '/api/stripe/webhook': 'Stripe, signature-verified.',
  '/api/incident': 'Posted to by the error boundary, from a page that has already failed.',
  '/api/resend/webhook':
    'Posted to by RESEND, not by any code here. The production API key is ' +
    'send-only (restricted_api_key, verified 2026-08-14), so the app cannot ask ' +
    'what became of a message; Resend pushes bounce and complaint events here ' +
    'instead. Svix-signed against RESEND_WEBHOOK_SECRET, and silently inert ' +
    'until that secret is configured.',
  '/api/csp-report':
    'Posted to by the BROWSER, not by any code here — it is named in the ' +
    'Content-Security-Policy-Report-Only and Reporting-Endpoints headers in ' +
    'next.config.mjs. lib/ops/security-headers.test.ts asserts both directions: ' +
    'the header names this path, and this route exists to receive it.',
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
  /*
    EMPTY, AND KEPT EMPTY BY A TEST — 2026-08-13.

    It held six entries. Every one has now been retired rather than carried,
    with the reason and the replacement in docs/retired-surface.md:

      GET    /api/people          superseded by /api/circle
      GET    /api/policies        superseded by /api/circle
      PUT    /api/policies/[id]   was "retire or wire — undecided"
      DELETE /api/policies/[id]   was "a real product question"
      PUT    /api/rules/[id]      editing a rule is redundant with rewriting it
      GET    /api/vault/items/[id] returned nothing any screen wanted

    Two of them were explicitly undecided, and a release is what turns an
    undecided item into a permanent one. The rest were "superseded", which
    means replaced — and keeping the replaced thing IS the debt. All six were
    owner-authenticated handlers with no screen behind them; one of them could
    revoke every grant a policy had written. A capability that cannot be
    reached by a user can still be reached by an attacker, and it is never
    exercised by the people who would notice it misbehaving.

    THIS MAP IS NOT DELETED, because the mechanism is still right: if a handler
    genuinely must exist before its screen does, saying so here with a date is
    better than deleting the check. But the empty state is now the asserted
    default (api-reachability.test.ts), so adding an entry is a deliberate act
    that shows up in review rather than a quiet place to park something.
  */
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

/**
 * Import specifiers out.
 *
 * 🔴 A MODULE PATH IS NOT A LINK, and one was vouching for a page.
 * `import { respondToChallenge } from '../../lib/release/challenge'` ends in
 * `/challenge'` — indistinguishable, to a textual matcher, from an href to the
 * `/challenge` route. It made the page check pass on exactly the defect the
 * check was written to catch, which was proved by deleting the real link and
 * watching the result stay green.
 *
 * A specifier can never be somewhere a person navigates, so removing them costs
 * nothing and closes the whole class rather than this one instance.
 */
export function stripImports(src: string): string {
  return src
    .replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]*['"];?/gm, ' ')
    .replace(/^\s*import\s*['"][^'"]*['"];?/gm, ' ')
    .replace(/^\s*export\s[\s\S]*?from\s*['"][^'"]*['"];?/gm, ' ')
    .replace(/\bimport\(\s*['"][^'"]*['"]\s*\)/g, ' ');
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

/**
 * Pages nothing in the product links to.
 *
 * 🔴 THE SAME DEFECT, ONE LAYER UP. `/challenge` — where an owner answers a
 * request for access — was linked only from a notification email. Not the
 * sidebar, not a banner, nowhere a person could look, on a screen with a
 * two-hour clock that escalates to the verifiers when it lapses. The API gate
 * could not see it: the endpoint behind that page WAS called, by the page you
 * could not reach.
 *
 * `lib/` is scanned as well as `src/`, because a route can be reached by
 * configuration rather than a link — NextAuth points at `/auth/error` from
 * `lib/auth/auth-options.ts`, and an earlier version of this check called that
 * an orphan.
 */
export function findUnlinkedPages(repoRoot = '.'): string[] {
  const root = repoRoot.split(BACKSLASH).join('/').replace(/\/$/, '');
  const rel = (p: string) => p.split(BACKSLASH).join('/').replace(root + '/', '');
  const all = walk(join(repoRoot, 'src')).concat(walk(join(repoRoot, 'lib'))).map(rel);

  const blob = all
    .filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.') && f !== 'lib/ops/api-reachability.ts')
    .map((f) => stripImports(stripComments(readFileSync(join(repoRoot, f), 'utf8'))))
    .join('\n');

  const unlinked: string[] = [];
  for (const file of all.filter((f) => /^src\/app\/.*\/page\.tsx$/.test(f))) {
    const route = ('/' + file.replace(/^src\/app\//, '').replace(/\/page\.tsx$/, ''))
      .replace(/\/\([^)]*\)/g, '');
    if (route === '/' || route === '') continue;
    if (PAGES_REACHED_WITHOUT_A_LINK[route]) continue;
    if (new RegExp(escapeRe(route) + '(?=[\'"`?#])').test(blob)) continue;
    unlinked.push(route);
  }
  return unlinked;
}

/** Pages a person reaches without any in-product link, and how. */
export const PAGES_REACHED_WITHOUT_A_LINK: Record<string, string> = {
  '/claim': 'Typed in from an invitation. The code IS the entry point (J4).',
  '/break-glass': 'Typed in when the usual sign-in is gone — that is its whole purpose.',
  '/verify': 'Reached by a verifier from their notice, or by typing the code.',
  '/access': 'Reached by a recipient holding a single-use code.',
  '/continue': 'A redirect target, never a destination — it decides where a sign-in lands.',
};

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
    .map((f) => stripImports(stripComments(readFileSync(join(repoRoot, f), 'utf8'))))
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
      /*
        METHOD-SCOPED EXEMPTIONS, added 2026-08-21. The route-level check above
        is right for a whole endpoint nothing here calls (Vercel Cron, Stripe,
        the browser). It is far too broad for the case that prompted this: the
        unified add-a-person form left POST /api/recipients callerless while GET
        /api/recipients is still what /circle reads to draw the roster. A
        route-level entry would have exempted the GET too, so a later change
        orphaning the read path would pass this check silently — an allowlist
        that grants more than it was written to grant is how a guard rots.
      */
      if (REACHED_FROM_OUTSIDE[method + ' ' + route]) continue;
      if (sites.length === 0 || !methodUsedNear(clientBlob, sites, method)) {
        unreachable.push({ route, method });
      }
    }
  }

  return unreachable;
}
