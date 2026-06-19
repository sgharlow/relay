/**
 * Demo simulate-trigger control (Requirement 9).
 *
 * Fast-forwards one trigger's release_state ARMED → PENDING → GRACE → RELEASED
 * within ~10s, using the SAME CAS transitions as production (Req 9.3 — no OCC
 * bypass, real version increments). It:
 *  - auto-satisfies the N-of-M quorum (received = required) at GRACE (Req 9.6),
 *  - sets an already-elapsed grace window so RELEASED can proceed,
 *  - tags every transition's audit `detail.simulated = true` (Req 9.4),
 *  - writes suppressed-notification audit events `detail.suppressed = true`
 *    instead of sending email (Req 9.5).
 *
 * Auth + demo-account gating happens in the route BEFORE this runs (Req 9.1/9.7);
 * this function still re-checks that the state is ARMED and throws (no state
 * change) otherwise.
 *
 * Feature: relay-h0-mvp
 * Requirements: 9.2–9.6
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  isReversibleTrigger,
  type ReleaseStateMachine,
  type ReleaseStateRow,
} from './state-machine';
import { TriggerError } from './triggers';

const STEP_PENDING_MS = 3000;
const STEP_GRACE_MS = 3000;
const STEP_RELEASED_MS = 4000; // 3 + 3 + 4 = 10s total (Req 9.2)

export interface SimulateParams {
  ownerId: string;
  triggerType: string;
  machine: Pick<ReleaseStateMachine, 'transition'>;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface SimulateResult {
  releaseStateId: string;
  states: string[]; // ['pending', 'grace', 'released']
}

export async function runSimulation(params: SimulateParams): Promise<SimulateResult> {
  const sleep = params.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = params.now ?? (() => new Date());
  const reversible = isReversibleTrigger(params.triggerType);

  // Re-read state — must be ARMED, else error with NO state change (Req 9.7).
  const head = await query<ReleaseStateRow>(
    `SELECT * FROM release_state WHERE owner_id = $1 AND trigger_type = $2 LIMIT 1`,
    [params.ownerId, params.triggerType],
  );
  if (head.rowCount === 0 || head.rows.length === 0) {
    throw new TriggerError(`No release state for trigger "${params.triggerType}"`, 404);
  }
  let row = head.rows[0];
  if (row.state !== 'armed') {
    throw new TriggerError(`Simulate requires ARMED state (got ${row.state})`, 409);
  }

  const states: string[] = [];
  const simulated = { simulated: true };

  // ARMED → PENDING
  row = await params.machine.transition(row.id, 'armed', 'pending', row.version, {
    reversible,
    updates: { initiated_by: 'simulate', initiated_at: now().toISOString() },
    auditDetail: simulated,
  });
  states.push('pending');
  await suppressedNotification(params.ownerId, row.id, 'verifier_requests');
  await sleep(STEP_PENDING_MS);

  // PENDING → GRACE — auto-satisfy quorum + an already-elapsed grace window (Req 9.6).
  const elapsedGrace = new Date(now().getTime() - 1000).toISOString();
  row = await params.machine.transition(row.id, 'pending', 'grace', row.version, {
    reversible,
    updates: {
      grace_ends_at: elapsedGrace,
      received_confirmations: row.required_confirmations,
    },
    auditDetail: { ...simulated, confirmations_bypassed: true },
  });
  states.push('grace');
  await sleep(STEP_GRACE_MS);

  // GRACE → RELEASED (same CAS path; stamps released_at).
  row = await params.machine.transition(row.id, 'grace', 'released', row.version, {
    reversible,
    updates: { released_at: now().toISOString() },
    auditDetail: simulated,
  });
  states.push('released');
  await sleep(STEP_RELEASED_MS);

  return { releaseStateId: row.id, states };
}

/** Records a suppressed-notification audit event (Req 9.5) — no email sent. */
async function suppressedNotification(ownerId: string, releaseStateId: string, event: string): Promise<void> {
  await writeAuditEntry(ownerId, {
    actor: 'system',
    action: 'notification_suppressed',
    entity: 'release_state',
    entityId: releaseStateId,
    detail: { suppressed: true, event, simulated: true },
  });
}
