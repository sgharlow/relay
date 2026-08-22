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
import { isReversibleTrigger, type ReleaseStateMachine } from './state-machine';
import { graceWindowMs } from './triggers';
import { ensureReleaseState } from './provisioning';
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

  /*
    ---- Approve: walk the EXISTING transitions, quorum auto-satisfied ----

    🔴 THE ORDER OF THE NEXT TWO STATEMENTS IS THE FIX, ruled by Steve 2026-08-21
    (option C of `deferred → approve-is-unreachable-before-the-first-rule`).

    WHAT IT WAS. `claimRequest` ran FIRST, committing `status =
    'approved_by_owner'`, and only then did the release_state lookup run and
    throw `No release state for that trigger type`. The two are not in one
    transaction, so the status change stuck. The result was the worst available
    combination: the owner saw an error, the release never opened, and the
    request was BURNED — no longer `awaiting_owner`, so it could never be
    answered again — while the audit log recorded that the owner had approved
    something that never happened. The owner's own record, which is the one
    place they go to reconstruct what occurred, was left with a false event in
    it.

    WHO HIT IT. Anybody who had named and invited somebody but not yet written
    an access rule, because `release_state` rows are provisioned by
    `POST /api/rules` — not by naming a recipient. Ordinary setup order: name,
    invite, claim, ask. Found by `scripts/e2e-request.ts` on its first run;
    no unit test reached it, because it needs a real account in a real
    intermediate state.

    THE FIX IS BOTH HALVES, and they are one line apart.

    (1) `ensureReleaseState` — so an owner who has not written a rule yet can
    still approve. It is idempotent and returns the existing ARMED row
    untouched when one is there, so this changes nothing for every owner who
    already has one.

    (2) It runs BEFORE `claimRequest`. That is the half that survives the next
    unrelated failure: anything that throws while establishing the release row
    now leaves the request `awaiting_owner` and answerable, instead of consuming
    it. Nothing is claimed until the thing it is claimed FOR is known to exist.

    ⚠️ Do not reorder these back. A failure between the claim and the first
    transition is unrecoverable for that request — there is no path that returns
    a row from `approved_by_owner` to `awaiting_owner`.
  */
  const peek = await query<{ trigger_type: string }>(
    `SELECT trigger_type FROM access_requests
      WHERE id = $1 AND owner_id = $2 AND status = 'awaiting_owner' LIMIT 1`,
    [requestId, ownerId],
  );
  if (!peek.rows[0]) {
    throw new ValidationError('No open request with that id', 'requestId');
  }

  const row = await ensureReleaseState(ownerId, peek.rows[0].trigger_type);

  const req = await claimRequest(requestId, ownerId, 'approved_by_owner');

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
      grace_ends_at: new Date(now.getTime() + graceWindowMs(req.trigger_type)).toISOString(),
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
