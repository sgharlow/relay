/**
 * The documented exclusion (§8.1, ruled by Steve 2026-08-12).
 *
 * Some contacts will never hold an account — the 70-year-old with no
 * smartphone, the person who simply will not. §3.6 exists for them and §4.3
 * decides their standing: they are **not** confirmed participants and do not
 * count toward N. Since quorum tightened, that is already true mechanically.
 *
 * WHAT THIS ADDS IS HONESTY, WHICH IS THE WHOLE OF §8.1. Until now such a person
 * showed a permanent red light reading "has not accepted yet" — which tells an
 * owner to chase somebody who is never coming. §8.1 puts it exactly: the product
 * must say so plainly "rather than let a red light imply 'not yet' when the
 * truth is 'not ever, on this device'".
 *
 * IT MEANS DIFFERENT THINGS FOR THE TWO ROLES, and both are real:
 *   • a verifier marked this way never counts toward a quorum;
 *   • a recipient marked this way never satisfies [A3]'s "at least one confirmed
 *     recipient", so a plan of only such recipients is not executable.
 * Neither is a defect. Both are the owner choosing cover-by-paper for somebody,
 * and the point of recording it is that the choice becomes visible arithmetic
 * instead of a light nobody can ever turn green.
 *
 * ⚠️ MARKING SOMEBODY IS NOT A WAY TO SILENCE A WARNING. The caller re-runs the
 * readiness assessment and reports what the exclusion did to the quorum, because
 * the failure mode of this feature is converting a nagging red into a
 * comfortable silence — which is worse than the nag it replaced.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { ValidationError } from '../validation';
import { readStandbyState } from './standby-state';
import type { PersonType } from './invitations';

function tableFor(personType: PersonType): 'recipients' | 'verifiers' {
  return personType === 'verifier' ? 'verifiers' : 'recipients';
}

/**
 * Record that this person is covered by paper only.
 *
 * Refused for anybody who has already claimed: they demonstrably CAN hold an
 * account, so marking them would be recording a fact that is not true, and it
 * would exclude a person who is able to act.
 */
export async function setBreakGlassOnly(params: {
  ownerId: string;
  personId: string;
  personType: PersonType;
  value: boolean;
}): Promise<void> {
  const table = tableFor(params.personType);

  const current = await query<{ standby_state: string | null }>(
    `SELECT standby_state FROM ${table} WHERE id = $1 AND owner_id = $2 LIMIT 1`,
    [params.personId, params.ownerId],
  );
  const row = current.rows[0];
  if (!row) throw new ValidationError('That person is not on your list.', 'personId');

  const state = readStandbyState(row.standby_state);
  if (params.value && state !== 'invited') {
    throw new ValidationError(
      state === 'revoked'
        ? 'You removed that person. Add them again if you want them covered by a code.'
        : 'They already have an account, so they do not need to rely on a paper code.',
      'personId',
    );
  }

  await query(`UPDATE ${table} SET break_glass_only = $1 WHERE id = $2 AND owner_id = $3`, [
    params.value,
    params.personId,
    params.ownerId,
  ]);

  await writeAuditEntry(params.ownerId, {
    actor: `owner:${params.ownerId}`,
    action: params.value ? 'standby_marked_break_glass_only' : 'standby_unmarked_break_glass_only',
    entity: params.personType,
    entityId: params.personId,
    detail: { personType: params.personType },
  });
}

/*
 * CLEARING IS NOT DONE HERE, DELIBERATELY. Both paths that give somebody an
 * account — `claimStandbyRole` and `redeemBreakGlass` — clear the marker inside
 * the SAME UPDATE that binds the identity, rather than calling a helper
 * afterwards. A separate write can be forgotten by the next path that binds, or
 * fail on its own, and either way leaves an exclusion outliving its reason.
 *
 * An exported `clearBreakGlassOnly` would also have been a function nobody
 * called, which is the shape of dead code this codebase has produced repeatedly.
 */
