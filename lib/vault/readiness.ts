/**
 * Can this vault actually open?
 *
 * THE GAP THIS EXISTS FOR. Creating an access rule provisions a release state
 * with `required_confirmations = 1`, and nothing required a verifier to exist.
 * So an owner could seed a vault, name a recipient, write rules, and finish
 * with every screen reading as complete — green ARMED badge, rules listed,
 * recipient listed — while the vault was incapable of ever opening. The
 * emergency would fire, reach GRACE, and wait forever for a confirmation
 * nobody existed to give.
 *
 * That was the DEFAULT state of a new account, and the guided setup never
 * mentioned verifiers at all. Every family would have hit it unless they
 * happened to find the recipients page.
 *
 * The general lesson, and why this is a readiness MODEL rather than one more
 * validation: nothing in the product ever asked whether a vault was
 * operational. Each piece validated itself and none of them owned the question
 * the owner actually cares about — will this work when I need it?
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1, J7-R1
 */

import { query } from '../db/connection';
import { selected } from '../db/row';
import { assessPreparedness, type Preparedness } from './preparedness';
import { assessCircle, type CircleAssessment } from './circle-readiness';
import { readStandbyState } from '../people/standby-state';

export type BlockerCode =
  | 'no_items'
  | 'no_recipients'
  | 'no_rules'
  | 'no_verifiers'
  | 'not_enough_verifiers'
  /**
   * §4.3: a trigger needs more confirmations than it has people who could ever
   * give them. Distinct from `not_enough_verifiers`, which counted ROSTER ROWS
   * and therefore counted revoked people as if they could still answer.
   */
  | 'unsatisfiable_quorum'
  /**
   * [A3] ruling, 2026-08-12. The plan CAN run — and it depends on somebody who
   * has no way back in if they lose the device they signed in on. Non-fatal on
   * purpose: it is a fragility, not a fault, and today it works.
   */
  | 'fragile_quorum';

export interface Blocker {
  code: BlockerCode;
  /** Written for the owner, not for a log. */
  message: string;
  /** Where they go to fix it. */
  href: string;
  /** True when this alone stops a release from ever completing. */
  fatal: boolean;
}

export interface Readiness {
  ready: boolean;
  blockers: Blocker[];
  counts: { items: number; recipients: number; rules: number; verifiers: number };
  /**
   * How prepared the vault actually is, as a number rather than a list of
   * absences. The blockers say what is missing; this says what it costs.
   */
  preparedness: Preparedness;
  /** Who would step in, for the sentence. Their name if there is exactly one. */
  whoLabel: string;
  /**
   * [A3] §4.5 — can the plan actually RUN, and if not, the single fastest thing
   * to do about it. Distinct from `blockers`, which say what is absent; this
   * says whether what exists is executable, and it is the assessment the circle
   * light is drawn from.
   */
  circle: CircleAssessment;
}

export async function assessReadiness(ownerId: string): Promise<Readiness> {
  const [
    items,
    recipients,
    rules,
    verifiers,
    states,
    itemRows,
    ruleRows,
    recipientRows,
    verifierStates,
    recipientStates,
  ] = await Promise.all([
    query<{ n: string }>(`SELECT count(*)::text AS n FROM vault_items WHERE owner_id = $1`, [ownerId]),
    query<{ n: string }>(`SELECT count(*)::text AS n FROM recipients WHERE owner_id = $1`, [ownerId]),
    query<{ n: string }>(`SELECT count(*)::text AS n FROM access_rules WHERE owner_id = $1`, [ownerId]),
    query<{ n: string }>(`SELECT count(*)::text AS n FROM verifiers WHERE owner_id = $1`, [ownerId]),
    query<{ trigger_type: string; required_confirmations: number }>(
      `SELECT trigger_type, required_confirmations FROM release_state WHERE owner_id = $1`,
      [ownerId],
    ),
    // Metadata only — never ciphertext (CC2).
    /*
      🔴 THE USABILITY COLUMNS WERE MISSING HERE UNTIL 2026-08-18, AND THAT MADE
      MIGRATION 035 INERT ON THE BANNER. `assessPreparedness` reads
      `secret_kinds`, `factors_required` and `depends_on_item_id`; this query did
      not select them, they were optional on its input, so every item arrived
      `unknown`, `checkingStarted` was permanently false, and an owner storing a
      password for an account that demands a code was still told their recipient
      could reach it. `secret_kinds` names what the blob HOLDS, not what it is —
      that is metadata, so CC2 is untouched.
    */
    query<{
      id: string;
      title: string;
      criticality: string | null;
      is_root_credential: boolean;
      secret_kinds: string | null;
      factors_required: string | null;
      depends_on_item_id: string | null;
    }>(
      `SELECT id, title, criticality, is_root_credential,
              secret_kinds, factors_required, depends_on_item_id
         FROM vault_items WHERE owner_id = $1
        ORDER BY is_root_credential DESC, importance_score DESC, title ASC`,
      [ownerId],
    ),
    query<{ vault_item_id: string }>(
      `SELECT DISTINCT vault_item_id FROM access_rules WHERE owner_id = $1`,
      [ownerId],
    ),
    query<{ name: string }>(`SELECT name FROM recipients WHERE owner_id = $1 ORDER BY created_at ASC`, [ownerId]),
    // Person state, for §4.3 and [A3]. Counting rows was the original defect:
    // a revoked verifier is a row that can never answer.
    query<{
      id: string;
      standby_state: string | null;
      break_glass_only: boolean | null;
      claimed_user_id: string | null;
    }>(
      `SELECT id, standby_state, break_glass_only, claimed_user_id
         FROM verifiers WHERE owner_id = $1`,
      [ownerId],
    ),
    query<{ id: string; standby_state: string | null }>(
      `SELECT id, standby_state FROM recipients WHERE owner_id = $1`,
      [ownerId],
    ),
  ]);

  const counts = {
    items: Number(items.rows[0]?.n ?? 0),
    recipients: Number(recipients.rows[0]?.n ?? 0),
    rules: Number(rules.rows[0]?.n ?? 0),
    verifiers: Number(verifiers.rows[0]?.n ?? 0),
  };

  const blockers: Blocker[] = [];

  if (counts.items === 0) {
    blockers.push({
      code: 'no_items',
      message: 'Your vault is empty — there is nothing to give anyone access to.',
      href: '/start',
      fatal: false,
    });
  }

  if (counts.recipients === 0) {
    blockers.push({
      code: 'no_recipients',
      message: 'Nobody is named to receive access. Add the person who would step in.',
      href: '/recipients',
      fatal: false,
    });
  } else if (counts.rules === 0) {
    blockers.push({
      code: 'no_rules',
      message: 'No access rules yet, so nothing would be shared even in an emergency.',
      href: '/rules',
      fatal: false,
    });
  }

  // The fatal one. A provisioned trigger needs enough verifiers to reach its
  // own threshold, or it can enter GRACE and never leave.
  const highestRequired = states.rows.reduce((max, r) => Math.max(max, Number(r.required_confirmations)), 0);

  /**
   * TIGHTENED 2026-08-12 from "not revoked" to "confirmed", in the same change
   * that tightened the quorum itself.
   *
   * This deliberately read "could answer by ANY route" that morning, because a
   * fatal warning that is untrue for a plan that would in fact run teaches
   * owners to disbelieve the banner. That reasoning has not changed — what
   * changed is the truth underneath it. An unconfirmed verifier's answer no
   * longer advances the quorum (§4.3), so a plan whose threshold exceeds its
   * confirmed count now genuinely cannot complete, and saying so is accurate
   * rather than alarmist.
   *
   * Conflicts (rules 6/7) are per-trigger and not computed here, so this is an
   * upper bound — it can only ever UNDER-report a problem, never invent one,
   * which is the safe direction for something fatal.
   */
  const ableVerifiers = verifierStates.rows.filter(
    (v) => readStandbyState(v.standby_state) === 'confirmed',
  ).length;

  if (states.rows.length > 0 && counts.verifiers === 0) {
    blockers.push({
      code: 'no_verifiers',
      message:
        'No trusted contact yet. Without one, an emergency can start but can never be confirmed — ' +
        'your vault would not open.',
      href: '/recipients',
      fatal: true,
    });
  } else if (counts.verifiers > 0 && highestRequired > ableVerifiers) {
    // §4.3, and the reason it needed saying: this compared `highestRequired`
    // against the ROSTER COUNT, so a revoked verifier still counted toward a
    // quorum they can never answer. Two verifiers, both revoked, N=2 read as
    // satisfiable — and §4.3 describes what that produces exactly: "the release
    // stalls permanently with no error anywhere".
    //
    // ABLE means "could answer by ANY route" — claimed people act from their
    // session, unclaimed ones still hold the emailed-code path (retained by
    // J7-R1). Only `revoked` is genuinely incapable. Deliberately NOT
    // confirmed-only: this blocker is FATAL, and a fatal warning that is untrue
    // for a plan that would in fact run is worse than none, because a banner
    // owners learn to disbelieve stops working for the cases that are real.
    // Confirmation is graded by the [A3] light below instead.
    // Names the fix, not just the fault. The shortfall is almost always people
    // who have claimed but were never checked, and that is a phone call — so
    // the message says so and points at the circle rather than at /triggers,
    // which would suggest lowering the threshold instead.
    // §8.1: somebody the owner marked paper-only is never coming, so "waiting on
    // you to check" would be false for them. Naming the two groups separately is
    // the difference between an action and a nag — one is a phone call, the
    // other means adding a person or lowering the threshold.
    const paperOnly = verifierStates.rows.filter((v) => v.break_glass_only === true).length;
    const unchecked = counts.verifiers - ableVerifiers - paperOnly;

    const parts: string[] = [];
    if (unchecked > 0) {
      parts.push(
        `${unchecked === 1 ? 'One is' : `${unchecked} are`} waiting on you to check it is really ` +
          'them',
      );
    }
    if (paperOnly > 0) {
      parts.push(
        `${paperOnly === 1 ? 'one is' : `${paperOnly} are`} covered by an emergency code only and ` +
          'will never count',
      );
    }

    blockers.push({
      code: 'unsatisfiable_quorum',
      message:
        `A trigger needs ${highestRequired} confirmations, but only ${ableVerifiers} of your ` +
        `trusted contacts ${ableVerifiers === 1 ? 'is' : 'are'} verified` +
        (parts.length > 0
          ? ` — ${parts.join(', and ')}. An emergency could start and never resolve.`
          : '. An emergency could start and never resolve.'),
      // Point at the circle only when a call would fix it. If the shortfall is
      // all paper-only, no amount of chasing helps and the answer is a different
      // threshold or another person.
      href: unchecked > 0 ? '/circle' : '/triggers',
      fatal: true,
    });
  }

  /**
   * [A3] RULING, 2026-08-12 — green means the plan can run, and now says when it
   * runs on one thread.
   *
   * The audit found a circle reading GREEN and EXECUTABLE whose only counting
   * verifier had neither a passkey nor an emergency code: the plan worked for
   * exactly as long as that person kept hold of their phone. That is the same
   * shape as the coverage false-green closed the same morning, one level out.
   *
   * ⚠️ WHY THIS DOES NOT MAKE GREEN STRICTER. Requiring every counting person to
   * hold a fallback would gate green on passkey adoption, which will never be
   * 100% — and §4.5 rejects exactly that move: "perpetual amber readiness that
   * owners learn to ignore" is the objection the whole [A3] design answers.
   * Green keeps meaning *configured and verified*; the fragility gets its own
   * line, non-fatal, and only when it is real.
   *
   * Raised only when the quorum has NO SLACK — every confirmed verifier is
   * needed — because with slack the loss of one device is survivable and saying
   * so would be the nagging this exists to avoid.
   */
  // Who could still get in on a new device — the same two facts /api/circle
  // shows the owner per person, asked here for the confirmed verifiers only.
  const confirmedVerifierRows = verifierStates.rows.filter(
    (v) => readStandbyState(v.standby_state) === 'confirmed',
  );
  const confirmedUserIds = confirmedVerifierRows
    .map((v) => v.claimed_user_id)
    .filter((id): id is string => Boolean(id));

  const [pkRows, bgRows] = await Promise.all([
    confirmedUserIds.length
      ? query<{ user_id: string }>(
          `SELECT DISTINCT user_id FROM webauthn_credentials WHERE user_id = ANY($1)`,
          [confirmedUserIds],
        )
      : Promise.resolve({ rows: [] as { user_id: string }[] }),
    confirmedVerifierRows.length
      ? query<{ person_id: string }>(
          `SELECT DISTINCT person_id FROM break_glass_codes
            WHERE person_id = ANY($1) AND used_at IS NULL AND expires_at > now()`,
          [confirmedVerifierRows.map((v) => v.id)],
        )
      : Promise.resolve({ rows: [] as { person_id: string }[] }),
  ]);

  const passkeyUsers = new Set(pkRows.rows.map((r) => r.user_id));
  const codePeople = new Set(bgRows.rows.map((r) => r.person_id));

  const strandedVerifiers = confirmedVerifierRows.filter(
    (v) => !(v.claimed_user_id && passkeyUsers.has(v.claimed_user_id)) && !codePeople.has(v.id),
  ).length;

  if (
    blockers.every((b) => !b.fatal) &&
    highestRequired > 0 &&
    ableVerifiers === highestRequired &&
    strandedVerifiers > 0
  ) {
    blockers.push({
      code: 'fragile_quorum',
      // Written twice because "every one of your 1 verified contact" is how a
      // template reads when nobody checked the singular.
      message:
        ableVerifiers === 1
          ? 'Your plan works, but it rests entirely on one person — and they have no way back in ' +
            'if they lose the device they signed in on. Give them an emergency code, or ask them ' +
            'to add a passkey.'
          : `Your plan works, but it needs all ${ableVerifiers} of your verified contacts — and ` +
            `${strandedVerifiers === 1 ? 'one of them has' : `${strandedVerifiers} of them have`} ` +
            'no way back in if they lose the device they signed in on. An emergency code or a ' +
            'passkey would fix that.',
      href: '/circle',
      fatal: false,
    });
  }

  const preparedness = assessPreparedness({
    items: itemRows.rows.map((r) => ({
      id: r.id,
      title: r.title,
      criticality: r.criticality,
      is_root_credential: Boolean(r.is_root_credential),
      // Dropped HERE as well as in the query above — two independent places,
      // one effect. Widening the SELECT alone would have fixed nothing, which
      // is why the input type now demands these rather than tolerating their
      // absence: one of the two omissions would have survived the other's fix.
      /*
        Read through `selected` rather than off the row, so that if this
        projection ever loses them again the read FAILS instead of quietly
        reporting `unknown` — which is what it did for a day, rendered as a
        sentence about the owner. The two omissions that caused it were here and
        in the query above; this is the half that cannot be fixed by looking at
        the SQL alone.
      */
      secret_kinds: selected<string>(r, 'secret_kinds'),
      factors_required: selected<string>(r, 'factors_required'),
      depends_on_item_id: selected<string>(r, 'depends_on_item_id'),
    })),
    ruledItemIds: ruleRows.rows.map((r) => r.vault_item_id),
    /**
     * 🔴 ABLE VERIFIERS, NOT ROSTER ROWS. This passed `counts.verifiers` —
     * `SELECT count(*) FROM verifiers`, any state — so `preparedness.ready` went
     * true on the strength of somebody having been TYPED IN. An owner with full
     * coverage and one named-but-unverified verifier therefore got a sage
     * "could reach all N of the things that matter" stacked directly above the
     * clay "This vault would not open in an emergency."
     *
     * Found by writing the user manual: the sentence explaining what the green
     * banner means could not be written without contradicting the box beneath
     * it. The same false-green shape as the coverage banner and the /circle box,
     * one level further out again — this is the third time this exact confusion
     * between NAMED and ABLE has produced a wrong colour.
     */
    verifierCount: ableVerifiers,
  });

  // Naming the person is the point — "someone" is what every other product
  // says. Falls back only when there is nobody, or more than one to name.
  const names = recipientRows.rows.map((r) => r.name).filter(Boolean);
  const whoLabel = names.length === 1 ? names[0] : names.length === 0 ? 'nobody' : 'the people you named';

  /**
   * [A3] §4.5 — green at EXECUTABLE, not at complete. `assessCircle` had been
   * written, tested, and imported by nothing since sprint E; this is the
   * consumer it was missing, so the light finally reports something.
   *
   * It grades on CONFIRMED, which is stricter than the fatal blocker above and
   * deliberately so: "could this run at all" and "has this been verified" are
   * different questions, and conflating them either produces false alarms or
   * hides real ones. Being stricter here errs toward asking the owner to make a
   * two-minute phone call, which is the safe direction — the opposite error is
   * a green light on a plan whose participants were never checked.
   */
  const circle = assessCircle({
    requiredConfirmations: highestRequired,
    verifiers: verifierStates.rows,
    recipients: recipientStates.rows,
  });

  return {
    /**
     * `fragile_quorum` is excluded deliberately. Every other blocker names
     * something still to SET UP; this one names a plan that is set up, works,
     * and rests on one thread. Letting it flip `ready` to false would tell an
     * owner their vault is not ready when it is — the precise overstatement the
     * [A3] ruling was careful not to make.
     */
    ready: blockers.filter((b) => b.code !== 'fragile_quorum').length === 0,
    blockers,
    counts,
    preparedness,
    whoLabel,
    circle,
  };
}
