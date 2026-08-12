/**
 * Challenge-window escalation — the owner did not answer, so the verifiers get asked.
 *
 * THE GAP THIS CLOSES. `CHALLENGE_WINDOW_SECONDS` is documented as "how long the
 * owner gets to answer before verifiers are contacted", `access_requests.expires_at`
 * is stored NOT NULL and handed back to the client, and **nothing ever read it**.
 * `claimRequest` accepts only `owner_id`, and no sweeper existed. So when the owner
 * was incapacitated — the exact case this product is sold for — a recipient's
 * request sat in `awaiting_owner` forever and the only working path was waiting for
 * the heartbeat interval to lapse.
 *
 * It had been read as a notification problem. It is a missing state transition.
 *
 * NO NEW TRANSITION IS INTRODUCED. This walks the same ARMED -> PENDING -> GRACE
 * pair that `runHeartbeatSweep` and `initiateTrigger` already walk;
 * `PERMITTED_TRANSITIONS` stays at seven (J6-R5).
 *
 * THE ONE THING THAT MUST NOT BE COPIED FROM THE OWNER-CONSENT PATH.
 * `respondToChallenge` auto-satisfies the quorum on approval, deliberately: an
 * owner agreeing is strictly stronger than a quorum of third parties attesting on
 * their behalf. **A lapse is the opposite — it is the absence of a signal.** So
 * escalation opens the confirmable window and leaves `received_confirmations`
 * untouched. Verifiers must actually confirm, N-of-M applies in full, and
 * `resolveElapsedGrace` releases only when quorum and the grace window agree.
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R2, J6-R5, J6-R7
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { GRACE_WINDOW_MS } from './triggers';
import { isReversibleTrigger, type ReleaseStateMachine, type ReleaseStateRow } from './state-machine';

type Machine = Pick<ReleaseStateMachine, 'transition'>;

export interface EscalationResult {
  requestId: string;
  caseId: string;
  ownerId: string;
  triggerType: string;
  releaseStateId: string;
}

/**
 * Pure predicate, so the rule can be tested without a database and read without
 * running anything. An unparseable expiry is deliberately NOT lapsed: bad data
 * must never be able to open a release.
 */
export function isChallengeLapsed(
  req: { status: string; expires_at: string },
  now: Date = new Date(),
): boolean {
  if (req.status !== 'awaiting_owner') return false;
  const expiry = new Date(req.expires_at).getTime();
  if (Number.isNaN(expiry)) return false;
  return expiry <= now.getTime();
}

/**
 * Escalates ONE request. Safe to call concurrently and safe to call twice.
 *
 * The CAS claim is what makes that true: `WHERE status = 'awaiting_owner'` means
 * the first writer wins and every other caller gets zero rows and stops. That is
 * the same guard `claimRequest` uses for the owner, so an owner answering at the
 * same moment the window lapses cannot produce two outcomes.
 */
export async function escalateLapsedRequest(params: {
  requestId: string;
  machine: Machine;
  now: Date;
}): Promise<EscalationResult | null> {
  const { requestId, machine, now } = params;

  // ---- Claim. Loser of the race exits here, having changed nothing. ----
  const claimed = await query<{
    id: string;
    owner_id: string;
    trigger_type: string;
    case_id: string;
  }>(
    `UPDATE access_requests
        SET status = 'escalated'
      WHERE id = $1 AND status = 'awaiting_owner'
      RETURNING id, owner_id, trigger_type, case_id`,
    [requestId],
  );

  const req = claimed.rows[0];
  if (!req) return null;

  const current = await query<ReleaseStateRow>(
    `SELECT * FROM release_state WHERE owner_id = $1 AND trigger_type = $2 LIMIT 1`,
    [req.owner_id, req.trigger_type],
  );

  const row = current.rows[0];
  // No release state, or something already moved it. The request stays claimed as
  // `escalated` either way — it is genuinely no longer awaiting the owner, and
  // re-opening it would hand the decision back to someone who did not take it.
  if (!row || row.state !== 'armed') return null;

  const reversible = isReversibleTrigger(req.trigger_type);

  // Step 1 of 2 — ARMED -> PENDING. `initiated_by` names the LAPSE, not a person,
  // so the audit can always distinguish "nobody answered" from "the owner agreed".
  const pending = await machine.transition(row.id, 'armed', 'pending', row.version, {
    reversible,
    updates: {
      initiated_by: `challenge_lapsed:${req.id}`,
      initiated_at: now.toISOString(),
    },
    auditDetail: { escalated: true, caseId: req.case_id },
  });

  // Step 2 of 2 — PENDING -> GRACE, opening the confirmable window.
  // NOTE the absence of `received_confirmations` here. See the header.
  const grace = await machine.transition(pending.id, 'pending', 'grace', pending.version, {
    reversible,
    updates: { grace_ends_at: new Date(now.getTime() + GRACE_WINDOW_MS).toISOString() },
    auditDetail: { escalated: true, quorumAutoSatisfied: false, caseId: req.case_id },
  });

  await writeAuditEntry(req.owner_id, {
    actor: `system:challenge_lapsed`,
    action: 'request_escalated_to_verifiers',
    entity: 'access_request',
    entityId: req.id,
    detail: { caseId: req.case_id, releaseStateId: grace.id, ownerConsented: false },
  });

  return {
    requestId: req.id,
    caseId: req.case_id,
    ownerId: req.owner_id,
    triggerType: req.trigger_type,
    releaseStateId: grace.id,
  };
}

/**
 * Sweeps every lapsed request across all owners.
 *
 * WHY A SWEEP AND NOT PURELY DERIVE-ON-READ. `docs/standby-architecture.md` §4.4
 * specifies derive-on-read — computed when a verifier loads their standby
 * dashboard, because "rung 0 guarantees someone is looking". That reader does not
 * exist yet; standby dashboards arrive with the release-path swap. Until then a
 * lapse with no reader is a lapse that never fires, which is the bug this module
 * exists to fix.
 *
 * So this runs from the heartbeat cron, which is already scheduled and already
 * sweeps release states. That honours the principle as written — "you already
 * carry one scheduler ledger; do not add a second thing that can silently stop" —
 * because it adds no second scheduler. When standby dashboards land, the read path
 * becomes an additional and faster trigger; both are CAS-guarded and idempotent, so
 * running both is safe.
 *
 * One request failing must never abort the sweep: these are independent owners,
 * and a conflict on one is not a reason to leave the rest waiting.
 */
export async function escalateLapsedRequests(
  machine: Machine,
  now: Date = new Date(),
): Promise<EscalationResult[]> {
  const lapsed = await query<{ id: string }>(
    `SELECT id FROM access_requests
      WHERE status = 'awaiting_owner' AND expires_at <= $1`,
    [now.toISOString()],
  );
  return escalateEach(lapsed.rows, machine, now);
}

/**
 * The derive-on-read half, scoped to the owners one person stands by for.
 *
 * This is what §4.4 originally specified and Sprint A could not yet implement:
 * "when a verifier loads their standby dashboard, requests whose challenge window
 * has lapsed are computed as verifier-actionable". The reader did not exist then.
 * It does now, so the lapse fires the moment somebody looks rather than waiting
 * for the next scheduled sweep — which matters, because the person looking is
 * usually the person waiting.
 *
 * Both paths are CAS-guarded and idempotent, so running the cron and this on the
 * same request is safe: the first writer wins and the second changes nothing.
 */
export async function escalateLapsedRequestsForOwners(
  ownerIds: string[],
  machine: Machine,
  now: Date = new Date(),
): Promise<EscalationResult[]> {
  if (ownerIds.length === 0) return [];

  const lapsed = await query<{ id: string }>(
    `SELECT id FROM access_requests
      WHERE status = 'awaiting_owner' AND expires_at <= $1 AND owner_id = ANY($2)`,
    [now.toISOString(), ownerIds],
  );
  return escalateEach(lapsed.rows, machine, now);
}

async function escalateEach(
  rows: { id: string }[],
  machine: Machine,
  now: Date,
): Promise<EscalationResult[]> {
  const results: EscalationResult[] = [];
  for (const { id } of rows) {
    try {
      const out = await escalateLapsedRequest({ requestId: id, machine, now });
      if (out) results.push(out);
    } catch {
      // Independent owners; the next reader or sweep re-evaluates this one.
    }
  }
  return results;
}
