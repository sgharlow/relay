/**
 * The recipient is told what this is, and the telling is on the record.
 *
 * WHY THIS EXISTS. Relay releases an owner's credentials to a person who may
 * then sign in to a third party — whose terms almost certainly forbid credential
 * sharing, with unauthorised-access statutes behind those terms. Questions 4 and
 * 5 of docs/g2-counsel-brief.md are about exactly that, and gate
 * `g2-counsel-opinion` was DECLINED on 2026-08-14: no written opinion is coming,
 * and the risk is recorded as accepted rather than resolved.
 *
 * This is the mitigation that was chosen instead, and it is deliberately modest
 * about what it achieves. It does not make anything lawful. What it does is
 * change the shape of the thing: a product that hands over credentials silently
 * is facilitating access, and a product that hands them over while saying "this
 * is what the owner chose to share, it gives you no authority, and if they have
 * died the person with authority is their executor" is conveying a choice its
 * owner made and naming the limits. That difference is worth having, and it is
 * worth having in writing.
 *
 * ⚠️ ITS VALUE IS IN THE RECORD, NOT THE RENDER. A statement that is shown and
 * not acknowledged proves nothing later; the audit entry is what makes "they
 * were told" a fact rather than an assertion about a React component. So it is
 * acknowledged once, per recipient, and written to the owner's hash-chained log.
 *
 * NO MIGRATION. The acknowledgement lives in `audit_log`, which already exists,
 * is append-only, is owner-scoped and is exactly where "this person did this
 * thing on this date" belongs. Same reasoning as lib/ai/intake-budget.ts.
 *
 * Feature: relay-h0-mvp
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';

/** The audit action that records one acknowledgement. Also how it is read back. */
export const LIMITS_ACK_ACTION = 'recipient_limits_acknowledged';

/**
 * Has this recipient already been told, and said so?
 *
 * Scoped to the recipient rather than to the release: being re-told the same
 * thing every time an owner re-arms would train people to click past it, which
 * is how a disclosure stops being a disclosure.
 */
export async function hasAcknowledgedLimits(
  ownerId: string,
  recipientId: string,
): Promise<boolean> {
  const r = await query<{ n: string }>(
    `SELECT count(*) AS n FROM audit_log
      WHERE owner_id = $1 AND action = $2 AND entity_id = $3`,
    [ownerId, LIMITS_ACK_ACTION, recipientId],
  );
  return Number(r.rows[0]?.n ?? 0) > 0;
}

/**
 * Records that the recipient read the statement and continued.
 *
 * Against the OWNER's chain, like every other recipient action here: it is their
 * circle, their release, and their audit log that has to be able to show what
 * each person was told before they opened anything.
 */
export async function recordLimitsAcknowledgement(params: {
  ownerId: string;
  recipientId: string;
  releaseStateId: string;
}): Promise<void> {
  await writeAuditEntry(params.ownerId, {
    actor: `recipient:${params.recipientId}`,
    action: LIMITS_ACK_ACTION,
    entity: 'recipient',
    entityId: params.recipientId,
    detail: { releaseStateId: params.releaseStateId },
  });
}
