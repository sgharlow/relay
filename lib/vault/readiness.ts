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

export type BlockerCode =
  | 'no_items'
  | 'no_recipients'
  | 'no_rules'
  | 'no_verifiers'
  | 'not_enough_verifiers';

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
}

export async function assessReadiness(ownerId: string): Promise<Readiness> {
  const [items, recipients, rules, verifiers, states] = await Promise.all([
    query<{ n: string }>(`SELECT count(*)::text AS n FROM vault_items WHERE owner_id = $1`, [ownerId]),
    query<{ n: string }>(`SELECT count(*)::text AS n FROM recipients WHERE owner_id = $1`, [ownerId]),
    query<{ n: string }>(`SELECT count(*)::text AS n FROM access_rules WHERE owner_id = $1`, [ownerId]),
    query<{ n: string }>(`SELECT count(*)::text AS n FROM verifiers WHERE owner_id = $1`, [ownerId]),
    query<{ trigger_type: string; required_confirmations: number }>(
      `SELECT trigger_type, required_confirmations FROM release_state WHERE owner_id = $1`,
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

  if (states.rows.length > 0 && counts.verifiers === 0) {
    blockers.push({
      code: 'no_verifiers',
      message:
        'No trusted contact yet. Without one, an emergency can start but can never be confirmed — ' +
        'your vault would not open.',
      href: '/recipients',
      fatal: true,
    });
  } else if (counts.verifiers > 0 && highestRequired > counts.verifiers) {
    blockers.push({
      code: 'not_enough_verifiers',
      message:
        `A trigger needs ${highestRequired} confirmations but you have ${counts.verifiers} trusted ` +
        `contact${counts.verifiers === 1 ? '' : 's'}. It could never reach that number.`,
      href: '/triggers',
      fatal: true,
    });
  }

  return { ready: blockers.length === 0, blockers, counts };
}
