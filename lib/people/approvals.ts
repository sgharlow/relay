/**
 * Owner approval queue for delegate proposals.
 *
 * A delegate proposes; the owner approves. Nothing a delegate does can grant
 * themselves access — and the designation of the delegate as a recipient is
 * the case this exists for (J3-R6).
 *
 * Approvals apply through the EXISTING validated code paths (createRecipient,
 * the policies route), never a raw insert, so an approved proposal is subject
 * to exactly the same validation as an owner-authored one.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R6, J3-R8
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { writeAuditEntry } from '../audit/audit-service';
import { ValidationError } from '../validation';
import { createRecipient, validateRecipientInput } from './recipients';

export const APPROVAL_KINDS = ['recipient', 'policy', 'self_designation'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export interface ApprovalRow {
  id: string;
  owner_id: string;
  kind: ApprovalKind;
  payload: Record<string, unknown>;
  proposed_by_delegation_id: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  decided_at: string | null;
}

export async function enqueueApproval(
  ownerId: string,
  input: {
    kind: ApprovalKind;
    payload: Record<string, unknown>;
    proposedByDelegationId: string | null;
  },
): Promise<{ id: string }> {
  if (!APPROVAL_KINDS.includes(input.kind)) {
    throw new ValidationError(`kind must be one of: ${APPROVAL_KINDS.join(', ')}`, 'kind');
  }

  const res = await query<{ id: string }>(
    `INSERT INTO approvals (owner_id, kind, payload, proposed_by_delegation_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [ownerId, input.kind, JSON.stringify(input.payload), input.proposedByDelegationId],
  );

  await writeAuditEntry(ownerId, {
    actor: input.proposedByDelegationId
      ? `delegate:${input.proposedByDelegationId}`
      : `owner:${ownerId}`,
    action: 'approval_requested',
    entity: 'approval',
    entityId: res.rows[0].id,
    detail: { kind: input.kind },
  });

  return { id: res.rows[0].id };
}

export async function listPendingApprovals(ownerId: string): Promise<ApprovalRow[]> {
  const res = await query<ApprovalRow>(
    `SELECT id, owner_id, kind, payload, proposed_by_delegation_id, status,
            created_at, decided_at
       FROM approvals
      WHERE owner_id = $1 AND status = 'pending'`,
    [ownerId],
  );
  return res.rows;
}

/**
 * Only the OWNER may decide. A rejected proposal applies nothing; an approved
 * one runs through the same validated creation path an owner would use.
 */
export async function decideApproval(
  ownerId: string,
  approvalId: string,
  decision: 'approve' | 'reject',
): Promise<{ applied: boolean }> {
  if (decision !== 'approve' && decision !== 'reject') {
    throw new ValidationError('decision must be approve or reject', 'decision');
  }

  const claimed = await withOccRetry(() =>
    query<ApprovalRow>(
      `UPDATE approvals
          SET status = $3, decided_at = now()
        WHERE id = $1 AND owner_id = $2 AND status = 'pending'
        RETURNING id, owner_id, kind, payload, proposed_by_delegation_id, status,
                  created_at, decided_at`,
      [approvalId, ownerId, decision === 'approve' ? 'approved' : 'rejected'],
    ),
  );

  const row = claimed.rows[0];
  if (!row) {
    throw new ValidationError('No pending approval with that id', 'approvalId');
  }

  let applied = false;

  if (decision === 'approve' && (row.kind === 'recipient' || row.kind === 'self_designation')) {
    // Through the validated path — an approved proposal is not a trusted insert.
    await createRecipient(ownerId, validateRecipientInput(row.payload));
    applied = true;
  }

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: decision === 'approve' ? 'approval_granted' : 'approval_rejected',
    entity: 'approval',
    entityId: approvalId,
    detail: { kind: row.kind, applied },
  });

  return { applied };
}

/**
 * "What was done on your behalf" — generated from the audit chain filtered to
 * delegate actors, not a separate log that could drift from it (J3-R8).
 */
export async function delegateActivityDigest(
  ownerId: string,
  sinceIso: string,
): Promise<{ action: string; entity: string; ts: string; actor: string }[]> {
  const res = await query<{ action: string; entity: string; ts: string; actor: string }>(
    `SELECT action, entity, ts, actor
       FROM audit_log
      WHERE owner_id = $1
        AND actor LIKE 'delegate:%'
        AND ts >= $2
      ORDER BY seq ASC`,
    [ownerId, sinceIso],
  );
  return res.rows;
}
