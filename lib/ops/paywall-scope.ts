/**
 * Which release paths does the paywall actually guard? Derived, never quoted.
 *
 * 🔴 THE FACT THIS EXISTS FOR DECIDES A RULING AND LIVED ONLY IN PROSE.
 * `assertCanRelease` guards exactly ONE of the four ARMED → PENDING paths. That
 * sentence is the entire basis of E4.1 (ruled at Sitting D-1, 2026-08-30: keep it
 * Initiate-only) and it is the premise E4.2 — the paywall flip on 2026-10-01 —
 * will be decided on. On 2026-08-30 it appeared in five `docs/` files, in
 * `PROJECT.yaml`, and, since that sitting, in a paragraph on `/terms` that
 * customers read.
 *
 * Nothing measured it. Adding `assertCanRelease` to the missed-check-in sweep
 * would silently make `/terms` false to every paying owner — a page that says a
 * lapsed subscription "does not switch off the part that matters" while the cron
 * had begun refusing to open a vault for someone who had gone quiet. There is no
 * test that fails, no build that breaks, and nobody reads a terms page twice.
 *
 * ⚠️ AND THE PROSE HAD ALREADY DRIFTED once before this was written:
 * `ratified.beta-free-release.detail` cited the call at
 * `lib/release/triggers.ts:125`; it was at :139. A line number in a register
 * entry is a volatile fact copied to a second place, which is the failure this
 * repository has a standing rule against.
 *
 * So the numbers are derived from the source on every run and compared against
 * the declaration below AND against the sentence `/terms` shows a customer. Three
 * places that must agree, with the code as the authority.
 *
 * Feature: relay-h0-mvp
 * Requirements: E4.1, E4.2, E4.3
 */

/** A path by which a release can begin — one ARMED → PENDING transition. */
export interface ReleaseEntryPoint {
  /** Source file holding the transition. */
  file: string;
  /** What actually fires it. */
  firedBy: string;
  /** Is `assertCanRelease` on this path? */
  billingGated: boolean;
  /** Why it is, or is not — the E4.1 ruling's reasoning, kept beside the fact. */
  why: string;
}

/**
 * The four ways a release begins, as ruled at Sitting D-1.
 *
 * The order is the order `docs/paywall-flip-changeset.md` numbers them, so the
 * two can be read side by side.
 */
export const RELEASE_ENTRY_POINTS: readonly ReleaseEntryPoint[] = [
  {
    file: 'lib/release/triggers.ts',
    firedBy: 'the owner, deliberately — the Initiate action',
    billingGated: true,
    why: 'A deliberate act by a person who is well enough to perform it. This is the only ' +
      'path where refusing is a commercial decision rather than an abandonment.',
  },
  {
    file: 'lib/release/heartbeat.ts',
    firedBy: 'the cron, on silence — the missed check-in sweep',
    billingGated: false,
    why: 'The owner did not choose to be on this path and by construction cannot answer. ' +
      'A custodial promise should not lapse with a card.',
  },
  {
    file: 'lib/release/challenge.ts',
    firedBy: 'a recipient asks and the owner agrees',
    billingGated: false,
    why: 'Same ruling: the release is already consented to. Gating it would refuse a ' +
      'request the owner has personally approved.',
  },
  {
    file: 'lib/release/escalation.ts',
    firedBy: 'nobody — the challenge window elapses',
    billingGated: false,
    why: 'The absence of a signal from an owner who may be incapacitated. This is the ' +
      'path a lapsed card would most cruelly block.',
  },
] as const;

/**
 * Files holding an ARMED → PENDING transition that is NOT a release path.
 *
 * Every entry argues for itself, the convention every allowlist in this directory
 * uses: a justification that cannot be falsified is decoration.
 */
export const NOT_A_RELEASE_PATH: Readonly<Record<string, string>> = {
  'lib/release/simulate.ts':
    'The demo control. It drives a demo-flagged account through the whole state machine for ' +
    'the /demo page and is unreachable for a real owner; `docs/paywall-flip-changeset.md` ' +
    'excludes it by name for the same reason.',
} as const;

/** Artefacts `docs/paywall-flip-changeset.md` says the flip commit must touch. */
export const CHANGESET_ARTEFACTS: readonly string[] = [
  'lib/billing/entitlements.ts',
  'lib/billing/entitlements.test.ts',
  'public/guide/index.html',
  'scripts/guide-pdf.mjs',
  'lib/billing/beta-flag.test.ts',
  'lib/ops/post-lapse-state.test.ts',
  'lib/billing/lapse-notice.ts',
  'src/app/terms/page.tsx',
] as const;

/** Number words `/terms` may use, so the page can read like English and still be checked. */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

/**
 * An ARMED → PENDING transition call, however it is spelled.
 *
 * Matches `transition(<anything>, 'armed', 'pending'` across line breaks, because
 * the real call sites wrap their arguments.
 */
const ARMED_TO_PENDING = /transition\s*\([^)]*?['"]armed['"]\s*,\s*['"]pending['"]/gs;

/** Does this source text contain an ARMED → PENDING transition? */
export function hasArmedToPending(src: string): boolean {
  ARMED_TO_PENDING.lastIndex = 0;
  return ARMED_TO_PENDING.test(src);
}

/**
 * Does this source text CALL `assertCanRelease`?
 *
 * An import alone is not a call — the distinction matters, because the
 * cheapest wrong way to satisfy this check would be importing the guard and
 * never invoking it.
 */
export function callsAssertCanRelease(src: string): boolean {
  return /(?:await\s+)?assertCanRelease\s*\(/.test(stripImports(src));
}

/** Remove `import` statements so an import is never mistaken for a call. */
function stripImports(src: string): string {
  return src.replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
}

export interface TermsClaim {
  guarded: number;
  total: number;
}

/**
 * The claim `/terms` makes to a customer, parsed back out of the page.
 *
 * Returns `null` when the sentence is not found at all, which is a finding rather
 * than a pass: the page having stopped saying it is exactly as interesting as the
 * page saying something false.
 */
export function parseTermsClaim(page: string): TermsClaim | null {
  const m =
    /guards\s+exactly\s+([A-Za-z]+)\s+of\s+the\s+([A-Za-z]+)\s+ARMED/i.exec(page);
  if (!m) return null;
  const guarded = NUMBER_WORDS[m[1].toLowerCase()];
  const total = NUMBER_WORDS[m[2].toLowerCase()];
  if (guarded === undefined || total === undefined) return null;
  return { guarded, total };
}
