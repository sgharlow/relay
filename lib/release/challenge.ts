/**
 * The owner challenge — the middle of the access-request flow.
 *
 * A recipient asks; the OWNER is asked first. Denial closes the request without
 * touching release_state at all. Approval walks the release to GRACE using the
 * EXISTING transitions.
 *
 * ⚠️ ARMED -> GRACE IS NOT A PERMITTED TRANSITION AND MUST NOT BECOME ONE.
 * Owner approval executes ARMED -> PENDING -> GRACE as two CAS steps with
 * verifier notification suppressed and the quorum auto-satisfied — the same
 * shape lib/release/simulate.ts already uses to fast-forward without weakening
 * OCC. PERMITTED_TRANSITIONS stays at seven (J6-R5).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R4, J6-R5, J6-R6
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  isReversibleTrigger,
  type ReleaseStateMachine,
  type ReleaseStateRow,
} from './state-machine';
import { GRACE_WINDOW_MS } from './triggers';
import { ValidationError } from '../validation';

export interface RespondParams {
  requestId: string;
  ownerId: string;
  response: 'deny' | 'approve';
  machine: Pick<ReleaseStateMachine, 'transition'>;
  now: Date;
}

export interface RespondResult {
  state: 'armed' | 'grace';
  status: 'denied_by_owner' | 'approved_by_owner';
}

async function claimRequest(requestId: string, ownerId: string, nextStatus: string) {
  const res = await query<{
    id: string;
    recipient_id: string;
    trigger_type: string;
    case_id: string;
  }>(
    `UPDATE access_requests
        SET status = $3
      WHERE id = $1 AND owner_id = $2 AND status = 'awaiting_owner'
      RETURNING id, recipient_id, trigger_type, case_id`,
    [requestId, ownerId, nextStatus],
  );

  const row = res.rows[0];
  if (!row) {
    throw new ValidationError('No open request with that id', 'requestId');
  }
  return row;
}

export async function respondToChallenge(params: RespondParams): Promise<RespondResult> {
  const { requestId, ownerId, response, machine, now } = params;

  // ---- Deny: release_state is NEVER touched, and no verifier is contacted ----
  if (response === 'deny') {
    const req = await claimRequest(requestId, ownerId, 'denied_by_owner');

    await writeAuditEntry(ownerId, {
      actor: `owner:${ownerId}`,
      action: 'request_denied_by_owner',
      entity: 'access_request',
      entityId: req.id,
      detail: { caseId: req.case_id, verifiersContacted: 0 },
    });

    return { state: 'armed', status: 'denied_by_owner' };
  }

  // ---- Approve: walk the EXISTING transitions, quorum auto-satisfied ----
  const req = await claimRequest(requestId, ownerId, 'approved_by_owner');

  const current = await query<ReleaseStateRow>(
    `SELECT * FROM release_state WHERE owner_id = $1 AND trigger_type = $2 LIMIT 1`,
    [ownerId, req.trigger_type],
  );

  const row = current.rows[0];
  if (!row) {
    throw new ValidationError('No release state for that trigger type', 'triggerType');
  }

  const reversible = isReversibleTrigger(req.trigger_type);

  // Step 1 of 2 — ARMED -> PENDING, verifier notification suppressed.
  const pending = await machine.transition(row.id, 'armed', 'pending', row.version, {
    reversible,
    updates: { initiated_by: `owner_consent:${ownerId}`, initiated_at: now.toISOString() },
    auditDetail: { ownerConsented: true, notifySuppressed: true, caseId: req.case_id },
  });

  // Step 2 of 2 — PENDING -> GRACE, quorum auto-satisfied because the owner
  // themselves consented. Owner consent is strictly stronger than a quorum of
  // third parties attesting on their behalf.
  const grace = await machine.transition(pending.id, 'pending', 'grace', pending.version, {
    reversible,
    updates: {
      received_confirmations: pending.required_confirmations,
      grace_ends_at: new Date(now.getTime() + GRACE_WINDOW_MS).toISOString(),
    },
    auditDetail: { ownerConsented: true, quorumAutoSatisfied: true, caseId: req.case_id },
  });

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'request_approved_by_owner',
    entity: 'access_request',
    entityId: req.id,
    detail: { caseId: req.case_id, releaseStateId: grace.id, verifiersContacted: 0 },
  });

  return { state: 'grace', status: 'approved_by_owner' };
}
