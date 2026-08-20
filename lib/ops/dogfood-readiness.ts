/**
 * Whether the owner's own vault is real enough to invite someone into.
 *
 * 🔴 THE PREREQUISITE NOBODY WROTE DOWN. `scripts/invite-cohort.ts` invites
 * people to stand by as recipients and verifiers **for the owner's vault**. On
 * 2026-08-20 that vault held zero items, named nobody, and had never opened a
 * release — so an invitee would have been standing by for nothing, an access
 * rule would have had nothing to point at, and the readiness banner would have
 * had nothing to report. The beta-cohort plan assumed a populated vault and no
 * document said so.
 *
 * This is the read-only instrument for ROADMAP.md sprint 1's own done-condition
 * ("the production counts are no longer zero"). It converts four items that were
 * "Steve has to remember what finished looks like" into one command that says
 * what is missing and what to do about it.
 *
 * ⚠️ DELIBERATELY NOT SATISFIABLE BY FIXTURES, AND THERE ARE TWO KINDS.
 * `scripts/reset-demo.ts` can manufacture every count below in seconds, and
 * ROADMAP.md §6 bars using it for this. The second kind is subtler and was a
 * live hole in the first version of this file: the E2E walks create real
 * accounts through ordinary signup, so they are NOT demo-flagged and counted as
 * genuine owners until the reserved-domain exclusion below was added. Both are
 * excluded, and both are REPORTED rather than silently filtered — a walk in
 * flight is the one condition under which these numbers move for reasons that
 * are not real. A check that its own test harness satisfies is not a check.
 *
 * Pure: the caller runs the SELECTs and passes counts in. No I/O here, and
 * nothing in this module can write — see `scripts/verify-dogfood.ts`, which is
 * the thin shell, and the test that asserts the shell holds no mutating SQL.
 *
 * Feature: relay-h0-mvp
 */

import { RESERVED_TLDS } from './disposable-accounts';

export interface DogfoodCounts {
  /** Owner accounts with `is_demo_account = false`. */
  realOwners: number;
  /** Demo-flagged owner accounts, counted only so the verdict can explain itself. */
  demoOwners: number;
  /** Reserved-domain accounts (walk fixtures). Counted so an in-flight sweep is visible, not silent. */
  disposableOwners: number;
  /** Vault items belonging to real owners. */
  vaultItems: number;
  /** Recipients named by real owners. */
  recipients: number;
  /** Verifiers named by real owners. */
  verifiers: number;
  /** Access rules — the thing that points a recipient at an actual item. */
  accessRules: number;
  /** Configured release triggers (`release_state` rows) for real owners. */
  releaseConfigs: number;
}

export interface MissingPiece {
  /** Short label, for a one-line summary. */
  what: string;
  /** Why the cohort cannot run without it. */
  why: string;
  /** The concrete next action, in the product, that supplies it. */
  action: string;
}

export interface DogfoodVerdict {
  ready: boolean;
  missing: MissingPiece[];
  /** Set when something about the shape of the data needs saying out loud. */
  note?: string;
}

/**
 * Judge whether the owner's vault can host a cohort invitation.
 *
 * Order matters: the list reads as a sequence, because that is the order the
 * product makes them possible in. You cannot point an access rule at an item
 * that does not exist.
 */
export function assessDogfoodReadiness(counts: DogfoodCounts): DogfoodVerdict {
  const missing: MissingPiece[] = [];

  if (counts.realOwners < 1) {
    missing.push({
      what: 'a real owner account',
      why: 'every count below hangs off an owner that is neither demo-flagged nor a walk fixture',
      action: 'sign up at relaystandby.com with a real address (reserved-domain addresses do not count)',
    });
    // Nothing else can be judged without one, and listing six more consequences
    // of the same absence would read as six problems instead of one.
    return {
      ready: false,
      missing,
      note:
        counts.demoOwners > 0
          ? `${counts.demoOwners} demo-flagged account(s) exist and are excluded on purpose: ` +
            'a vault seeded by scripts/reset-demo.ts satisfies these counts while proving nothing.'
          : undefined,
    };
  }

  if (counts.vaultItems < 1) {
    missing.push({
      what: 'at least one vault item',
      why: 'a recipient standing by for an empty vault is standing by for nothing',
      action: 'add a real credential in /vault/new — ideally one with factors_required set, so the declaration path is exercised too',
    });
  }

  if (counts.recipients < 1) {
    missing.push({
      what: 'at least one recipient',
      why: 'the cohort invites people to be recipients; with none named, there is no role to invite into',
      action: 'name a recipient in /circle',
    });
  }

  if (counts.verifiers < 1) {
    missing.push({
      what: 'at least one verifier',
      why: 'release requires a confirmation, and with no verifier no release can ever complete',
      action: 'name a verifier in /circle',
    });
  }

  if (counts.accessRules < 1) {
    missing.push({
      what: 'at least one access rule',
      why:
        'this is the piece that makes the rest mean anything: it points a named recipient at an ' +
        'actual item under a trigger. Items and people without a rule between them are two lists',
      action: 'set what each person can reach, in /rules',
    });
  }

  if (counts.releaseConfigs < 1) {
    missing.push({
      what: 'a configured release trigger',
      why: 'the readiness banner reports on a release configuration; with none, it has nothing true to say',
      action: 'configure a trigger in /triggers',
    });
  }

  const verdict: DogfoodVerdict = { ready: missing.length === 0, missing };

  const notes: string[] = [];
  if (counts.demoOwners > 0) {
    notes.push(
      `${counts.demoOwners} demo-flagged account(s) excluded on purpose: a vault seeded by ` +
        'scripts/reset-demo.ts would satisfy these numbers while proving nothing (ROADMAP.md §6).',
    );
  }
  if (counts.disposableOwners > 0) {
    // Said out loud rather than silently filtered: a sweep in flight is the one
    // condition under which these numbers move for reasons that are not real.
    notes.push(
      `${counts.disposableOwners} reserved-domain account(s) excluded — a walk is in flight or ` +
        'left rows behind. They are NOT evidence of a populated vault; they delete themselves. ' +
        'Run `npm run verify:orphans` if this is unexpected.',
    );
  }
  if (notes.length) verdict.note = notes.join(' ');

  return verdict;
}

/** One-line summary for a console, kept here so the shell stays thin. */
export function summarise(v: DogfoodVerdict): string {
  return v.ready
    ? 'READY — the owner vault can host a cohort invitation.'
    : `NOT READY — ${v.missing.length} piece(s) missing: ${v.missing.map((m) => m.what).join(', ')}.`;
}

/**
 * What counts as a real owner, said once.
 *
 * 🔴 THE HOLE THIS CLOSES, FOUND THE DAY AFTER THIS FILE SHIPPED. The first
 * version excluded only `is_demo_account`, and **nothing sets that column** —
 * `auth-options.ts` reads it in four places and no signup path ever writes it.
 * The walk accounts (`e2e-*`, `disposable-owner.ts`) are created through
 * ORDINARY SIGNUP on reserved domains, so every one of them counted as a real
 * owner and every fixture item it created counted as a real vault item.
 *
 * The consequence was specific and bad: run a journey sweep, and `verify:dogfood`
 * reports READY off the back of accounts that delete themselves an hour later —
 * and `invite:cohort` would then let real invitations through. A check that its
 * own test harness satisfies is exactly the false green this probe was written
 * to prevent, built into the probe.
 *
 * Reserved TLDs come from `disposable-accounts.ts` rather than being re-listed,
 * so adding one there closes it here too. `lower()` because addresses are not
 * case-normalised on the way in.
 */
const RESERVED_EXCLUSION = RESERVED_TLDS.map((t) => `lower(email) NOT LIKE '%.${t}'`).join(' AND ');

const REAL_OWNERS =
  `SELECT id FROM users WHERE NOT COALESCE(is_demo_account, false) AND ${RESERVED_EXCLUSION}`;

/**
 * The counts, from one definition.
 *
 * Both `verify-dogfood.ts` and `invite-cohort.ts` ask the same question, and two
 * copies of "what counts as ready" is two things to drift — the portfolio rule
 * is one authoritative definition per cross-boundary contract. The query
 * function is injected, so this module still performs no I/O and the SQL is
 * testable without a cluster.
 */
export async function countDogfood(
  count: (sql: string) => Promise<number>,
): Promise<DogfoodCounts> {
  return {
    realOwners: await count(`SELECT count(*) AS n FROM (${REAL_OWNERS}) o`),
    demoOwners: await count('SELECT count(*) AS n FROM users WHERE COALESCE(is_demo_account, false)'),
    disposableOwners: await count(
      `SELECT count(*) AS n FROM users WHERE NOT (${RESERVED_EXCLUSION})`,
    ),
    vaultItems: await count(`SELECT count(*) AS n FROM vault_items WHERE owner_id IN (${REAL_OWNERS})`),
    recipients: await count(`SELECT count(*) AS n FROM recipients WHERE owner_id IN (${REAL_OWNERS})`),
    verifiers: await count(`SELECT count(*) AS n FROM verifiers WHERE owner_id IN (${REAL_OWNERS})`),
    accessRules: await count(`SELECT count(*) AS n FROM access_rules WHERE owner_id IN (${REAL_OWNERS})`),
    releaseConfigs: await count(`SELECT count(*) AS n FROM release_state WHERE owner_id IN (${REAL_OWNERS})`),
  };
}

export interface CohortGateDecision {
  refuse: boolean;
  message: string;
}

/**
 * Should `invite:cohort --commit` proceed?
 *
 * 🔴 THE REASON THIS IS A REFUSAL AND NOT A WARNING. `verify:dogfood` reports,
 * and a report is a convention every future operator has to remember to run.
 * The portfolio rule is to prefer a structure that makes the mistake impossible
 * over a convention somebody must remember, and the mistake here is specific and
 * hard to undo: real people, named in a gitignored file, receive an invitation to
 * stand by for a vault with nothing in it. They are not test rows. Withdrawing an
 * invitation costs a conversation.
 *
 * ⚠️ THE OVERRIDE EXISTS ON PURPOSE. There are legitimate reasons to invite
 * early — naming a verifier before the vault is filled is a defensible order of
 * operations — and a check with no escape hatch is a check somebody deletes the
 * first time it is wrong. `--anyway` proceeds and prints exactly what is being
 * overridden, so the exception is visible in the run output rather than silent.
 * The dry run is never gated: listing the roster is how the list gets checked,
 * and blocking that would push people toward `--commit` to see anything at all.
 */
export function gateCohortInvite(verdict: DogfoodVerdict, override: boolean): CohortGateDecision {
  if (verdict.ready) {
    return { refuse: false, message: 'Owner vault is ready to host an invitation.' };
  }

  const missing = verdict.missing.map((m) => `  - ${m.what}: ${m.action}`).join('\n');

  if (override) {
    return {
      refuse: false,
      message:
        '⚠️  PROCEEDING ANYWAY. The owner vault cannot currently host an invitation:\n\n' +
        `${missing}\n\n` +
        'Real people are about to be invited to stand by for this. That is a defensible\n' +
        'choice — naming a verifier before the vault is filled is a real order of operations —\n' +
        'but it is being recorded here because it was chosen rather than missed.',
    };
  }

  return {
    refuse: true,
    message:
      '✗ REFUSED: the owner vault cannot host an invitation yet.\n\n' +
      `${missing}\n\n` +
      'These are real people. Inviting them now means asking them to stand by for a vault\n' +
      'with nothing in it — there is nothing an access rule could point at and nothing the\n' +
      'readiness banner could truthfully report.\n\n' +
      'Run `npm run verify:dogfood` for the full picture. If this is deliberate, re-run with\n' +
      '--anyway and the reason will be printed with the run.',
  };
}
