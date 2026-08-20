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
 * ⚠️ DELIBERATELY NOT SATISFIABLE BY FIXTURES. `scripts/reset-demo.ts` can
 * manufacture every count below in seconds, and ROADMAP.md §6 bars using it for
 * this precisely because it would satisfy the numbers while proving nothing. So
 * demo-flagged owners are excluded from every count by the caller, and if the
 * ONLY populated owner is a demo account this reports not-ready and says why.
 * A check that its own bypass satisfies is not a check.
 *
 * Pure: the caller runs the SELECTs and passes counts in. No I/O here, and
 * nothing in this module can write — see `scripts/verify-dogfood.ts`, which is
 * the thin shell, and the test that asserts the shell holds no mutating SQL.
 *
 * Feature: relay-h0-mvp
 */

export interface DogfoodCounts {
  /** Owner accounts with `is_demo_account = false`. */
  realOwners: number;
  /** Demo-flagged owner accounts, counted only so the verdict can explain itself. */
  demoOwners: number;
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
      why: 'every count below hangs off an owner that is not demo-flagged',
      action: 'sign up at relaystandby.com, or clear is_demo_account on the intended account',
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
      action: 'name a recipient in /people',
    });
  }

  if (counts.verifiers < 1) {
    missing.push({
      what: 'at least one verifier',
      why: 'release requires a confirmation, and with no verifier no release can ever complete',
      action: 'name a verifier in /people',
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

  if (counts.demoOwners > 0) {
    verdict.note =
      `${counts.demoOwners} demo-flagged account(s) exist and are excluded from every count above ` +
      'on purpose: a vault seeded by scripts/reset-demo.ts would satisfy these numbers while ' +
      'proving nothing (ROADMAP.md §6).';
  }

  return verdict;
}

/** One-line summary for a console, kept here so the shell stays thin. */
export function summarise(v: DogfoodVerdict): string {
  return v.ready
    ? 'READY — the owner vault can host a cohort invitation.'
    : `NOT READY — ${v.missing.length} piece(s) missing: ${v.missing.map((m) => m.what).join(', ')}.`;
}
