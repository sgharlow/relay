/**
 * Leaving a circle — resigning, and rejecting an invitation you did not expect.
 *
 * A standby account is a free user with rights, and until this existed they had
 * none of the obvious one: no way out. Two flows were missing (sprint plan §4):
 * "remove me from Margaret's plan", and "I do not know this person".
 *
 * THE SECOND IS ALSO THE CONTACT-SIDE HALF OF A FINGERPRINT MISMATCH. The
 * assurance step asks the owner to compare a phrase out of band, and the plan
 * never said what happens when it does not match — a control that detects an
 * interception and then offers nobody a response is decoration. This is the
 * contact's half of that answer.
 *
 * DEGRADE, NEVER DELETE (§3.7 rule 3). The roster row survives, unbound and back
 * to `invited`. Deleting it would silently remove a trusted contact from someone
 * else's plan, which is precisely the failure this architecture exists to
 * prevent — the owner would simply have a smaller circle and no idea why. Instead
 * their light goes red, the audit chain records it, and re-inviting is a
 * conversation they get to choose to have.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { ValidationError } from '../validation';
import type { PersonType } from './invitations';

export type LeaveReason = 'resigned' | 'rejected';

export async function resignFromCircle(params: {
  userId: string;
  personId: string;
  personType: PersonType;
  reason?: LeaveReason;
}): Promise<{ ownerId: string }> {
  const { userId, personId, personType } = params;
  const reason: LeaveReason = params.reason ?? 'resigned';
  const table = personType === 'verifier' ? 'verifiers' : 'recipients';

  // The guard IS the authorization: `claimed_user_id = $2` means you can only
  // unbind a row that is currently bound to you. Nothing to check separately,
  // and nothing that can drift away from the check.
  const res = await query<{ owner_id: string }>(
    `UPDATE ${table}
        SET claimed_user_id = NULL,
            standby_state = 'invited',
            fingerprint_confirmed_at = NULL
      WHERE id = $1 AND claimed_user_id = $2
      RETURNING owner_id`,
    [personId, userId],
  );

  const row = res.rows[0];
  if (!row) {
    throw new ValidationError('That standby role is not yours to leave.', 'personId');
  }

  // Against the OWNER: their plan just got weaker and their audit chain is where
  // that has to show up. `rejected` and `resigned` are recorded distinctly —
  // "I do not know this person" may mean an invitation reached the wrong inbox,
  // which is a different thing to know than "I am stepping down".
  await writeAuditEntry(row.owner_id, {
    actor: `${personType}:${personId}`,
    action: reason === 'rejected' ? 'standby_rejected' : 'standby_resigned',
    entity: personType,
    entityId: personId,
    detail: { reason },
  });

  return { ownerId: row.owner_id };
}
