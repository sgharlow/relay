/**
 * The claim this repo makes about itself can be checked.
 *
 * 🔴 THE FINDING. `PROJECT.yaml` says `ladder: dogfooded`. Above that line sit
 * FOUR successive prose caveats, added 2026-06-27, 2026-08-07, 2026-08-08 and
 * 2026-08-09, each one narrowing what the claim actually covers — the newer
 * surfaces are "live-proven, not dogfooded, do not conflate"; the card that was
 * charged was the owner's own; promotion stays gated. Every one of those notes
 * is correct, carefully written, and **enforced by nothing**.
 *
 * On 2026-08-20 the live system was measured: ONE owner account, ZERO vault
 * items, zero recipients, zero verifiers, zero invitations, and no release that
 * had ever left `armed`. The dogfood of 2026-06-27 genuinely happened and its
 * record is real — but a present-tense reading of `dogfooded` did not survive
 * that query, and no test in a suite of nearly three thousand could tell.
 *
 * That is this portfolio's oldest shape: **a green signal that was wrong.** The
 * claim ladder is the vocabulary the rules use for "how true is this" — idea →
 * built → wired → live-proven → dogfooded → customer-used → revenue-proven —
 * and the one file that states the project's own rung had no more standing
 * behind it than a comment.
 *
 * ⚠️ WHAT THIS GUARD DELIBERATELY DOES NOT DO. It does not decide which rung is
 * correct; that is a judgement about the world, not about code, and a test that
 * tried would be a test that lies. It requires only that the claim **carries its
 * own evidence and says what it describes** — a date, a basis, a record that
 * exists on disk, and, once that date has aged, an explicit scope. An aged claim
 * is not an error. An aged claim nobody has re-read is.
 *
 * The verdict is pure and takes `today` and `recordExists` as inputs, so the
 * test controls both the clock and the filesystem. `lib/` must not reach for
 * either: the yaml parser is a devDependency and cannot be imported from
 * production code, which is why the caller parses and this module judges — the
 * same split `kms-wall.ts` uses against `scripts/verify-kms.ts`.
 *
 * Feature: relay-h0-mvp
 */

/**
 * The rungs, in order, lowest first.
 *
 * ONE authoritative definition. The ladder is stated in prose in the portfolio
 * rules and quoted in several documents; this is the copy a machine reads, and
 * anything that needs the list imports it from here rather than re-typing it.
 */
export const RUNGS = [
  'idea',
  'built',
  'wired',
  'live-proven',
  'dogfooded',
  'customer-used',
  'revenue-proven',
] as const;

export type Rung = (typeof RUNGS)[number];

/**
 * How long a demonstration stands before the claim must say what it describes.
 *
 * 30 days is a judgement, not a standard — the same honesty `verify-live-
 * freshness.ts` prints about its own 14. It is long enough that ordinary work
 * does not trip it and short enough that a claim cannot quietly become historical
 * across a quarter. Raising it is a legitimate change; doing so silently, in a
 * commit that is really about something else, is the drift this file exists to
 * catch.
 */
export const SCOPE_REQUIRED_AFTER_DAYS = 30;

export interface LadderEvidence {
  /** ISO `YYYY-MM-DD`. The day the rung was last actually demonstrated. */
  as_of?: unknown;
  /** What was demonstrated. Prose, but it has to be there. */
  basis?: unknown;
  /** A path, in this repo, holding the record of that demonstration. */
  record?: unknown;
  /** What the claim covers today. Required once `as_of` has aged. */
  scope?: unknown;
}

export interface LadderClaim {
  ladder?: unknown;
  ladder_evidence?: unknown;
}

export interface LadderVerdict {
  ok: boolean;
  /** Every problem found, not just the first — one run should list all the work. */
  problems: string[];
  /** Whole days between `as_of` and `today`; null when `as_of` is unusable. */
  ageDays: number | null;
}

export interface LadderInputs {
  /** Injected so the test owns the clock and the verdict never flakes on a date. */
  today: Date;
  /** Injected so `lib/` performs no I/O; the caller reads the filesystem. */
  recordExists: (path: string) => boolean;
  staleAfterDays?: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Midnight UTC for a `YYYY-MM-DD`, or null if it is not one. */
function parseIsoDate(v: unknown): Date | null {
  if (!isNonEmptyString(v) || !ISO_DATE.test(v.trim())) return null;
  const d = new Date(`${v.trim()}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip, so 2026-02-31 is rejected rather than silently becoming March.
  return d.toISOString().slice(0, 10) === v.trim() ? d : null;
}

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Judge a ladder claim. Returns every problem rather than throwing on the first,
 * so one run tells you all of the work.
 */
export function assessLadderClaim(claim: LadderClaim, inputs: LadderInputs): LadderVerdict {
  const staleAfter = inputs.staleAfterDays ?? SCOPE_REQUIRED_AFTER_DAYS;
  const problems: string[] = [];

  const rung = claim.ladder;
  if (!isNonEmptyString(rung)) {
    problems.push(
      'PROJECT.yaml has no `ladder:` value. That key is how every rule in this ' +
        'portfolio says how true a claim is; without it nothing else here can be judged.',
    );
  } else if (!(RUNGS as readonly string[]).includes(rung.trim())) {
    problems.push(
      `\`ladder: ${rung}\` is not one of the rungs. Known rungs, lowest first: ` +
        `${RUNGS.join(' -> ')}. A rung this file does not know is either a typo or a new ` +
        'vocabulary that has to be added to RUNGS deliberately, in its own change.',
    );
  }

  const ev = claim.ladder_evidence;
  if (ev === undefined || ev === null || typeof ev !== 'object' || Array.isArray(ev)) {
    problems.push(
      'PROJECT.yaml has no `ladder_evidence:` block. The rung is a claim about the ' +
        'live system, and a claim with no evidence pointer is the state this guard was ' +
        'written to end: on 2026-08-20 the file said `dogfooded` while production held ' +
        'one account and zero vault items, and nothing could tell.',
    );
    return { ok: false, problems, ageDays: null };
  }

  const evidence = ev as LadderEvidence;
  const asOf = parseIsoDate(evidence.as_of);

  if (evidence.as_of === undefined) {
    problems.push('`ladder_evidence.as_of` is missing — the day the rung was last actually demonstrated.');
  } else if (!asOf) {
    problems.push(
      `\`ladder_evidence.as_of\` is not a real ISO date: ${JSON.stringify(evidence.as_of)}. ` +
        'Use `YYYY-MM-DD`. Quote it in YAML, or a bare date becomes a Date object and the ' +
        'shape this reads changes under you.',
    );
  }

  if (!isNonEmptyString(evidence.basis)) {
    problems.push(
      '`ladder_evidence.basis` is missing — one line saying what was actually demonstrated. ' +
        '"It works" is not a basis; "all ten journeys walked against production as a new ' +
        'self-serve account" is.',
    );
  }

  if (!isNonEmptyString(evidence.record)) {
    problems.push(
      '`ladder_evidence.record` is missing — the path, in this repo, holding the record of ' +
        'that demonstration. A basis with no record is a memory.',
    );
  } else if (!inputs.recordExists(evidence.record.trim())) {
    problems.push(
      `\`ladder_evidence.record\` names \`${evidence.record.trim()}\`, which does not exist. ` +
        'A pointer to a file nobody kept is worse than no pointer: it reads as evidence.',
    );
  }

  let ageDays: number | null = null;
  if (asOf) {
    ageDays = wholeDaysBetween(asOf, inputs.today);

    if (ageDays < 0) {
      problems.push(
        `\`ladder_evidence.as_of\` is ${-ageDays} day(s) in the future. A demonstration that ` +
          'has not happened yet cannot be evidence for a claim that is already written down.',
      );
    } else if (ageDays > staleAfter && !isNonEmptyString(evidence.scope)) {
      problems.push(
        `The rung was last demonstrated ${ageDays} days ago (threshold ${staleAfter}) and ` +
          '`ladder_evidence.scope` is empty.\n\n' +
          'This is not a build error and there is nothing to fix in code. There are exactly ' +
          'two honest ways to clear it:\n' +
          '  1. Re-demonstrate the rung and move `as_of` to the day you did it; or\n' +
          '  2. Write `scope:` — state plainly what the claim covers NOW, including what it ' +
          'does not.\n\n' +
          'What is not available is leaving it unwritten, because that is precisely how ' +
          '`dogfooded` came to describe a system with an empty vault.',
      );
    }
  }

  return { ok: problems.length === 0, problems, ageDays };
}
