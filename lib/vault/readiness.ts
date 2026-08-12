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
  | 'unsatisfiable_quorum';

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
    query<{ id: string; title: string; criticality: string | null; is_root_credential: boolean }>(
      `SELECT id, title, criticality, is_root_credential FROM vault_items WHERE owner_id = $1
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
    query<{ id: string; standby_state: string | null }>(
      `SELECT id, standby_state FROM verifiers WHERE owner_id = $1`,
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

  // Everyone who is not revoked — see the blocker below for why that is the
  // right line for a FATAL check.
  const ableVerifiers = verifierStates.rows.filter(
    (v) => readStandbyState(v.standby_state) !== 'revoked',
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
    const shortfall = counts.verifiers - ableVerifiers;
    blockers.push({
      code: 'unsatisfiable_quorum',
      message:
        `A trigger needs ${highestRequired} confirmations but only ${ableVerifiers} of your ` +
        `trusted contacts could give one` +
        (shortfall > 0
          ? ` — ${shortfall} ${shortfall === 1 ? 'has' : 'have'} been removed. ` +
            'An emergency could start and never resolve.'
          : '. It could never reach that number.'),
      href: '/triggers',
      fatal: true,
    });
  }

  const preparedness = assessPreparedness({
    items: itemRows.rows.map((r) => ({
      id: r.id,
      title: r.title,
      criticality: r.criticality,
      is_root_credential: Boolean(r.is_root_credential),
    })),
    ruledItemIds: ruleRows.rows.map((r) => r.vault_item_id),
    verifierCount: counts.verifiers,
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

  return { ready: blockers.length === 0, blockers, counts, preparedness, whoLabel, circle };
}
