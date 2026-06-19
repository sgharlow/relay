/**
 * Heartbeat + scheduler logic (Requirement 4).
 *
 * Two entry points, both built on the ReleaseStateMachine:
 *  - processCheckin(ownerId, machine) — an owner heartbeat: records activity and
 *    reverses any reversible trigger from PENDING/GRACE back to ARMED via CAS.
 *    Estate triggers in PENDING/GRACE are reported as `blocked` (cannot reverse,
 *    Req 4.5) so the route can return 409.
 *  - runHeartbeatSweep(machine, deps) — the cron evaluation: finds overdue active
 *    owners and arms each ARMED release_state to PENDING (Req 4.3), retrying a
 *    transient failure with exponential backoff (base 5s, max 3) before logging
 *    and moving on (Req 4.7).
 *
 * `isOverdue` is the pure overdue predicate (Property 9).
 *
 * NOTE: the owner-alert email on a PENDING transition (Req 4.4) is sent by the
 * notification layer (Resend, task 17) — wired there, not here.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.2, 4.3, 4.5, 4.7
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { isReversibleTrigger, type ReleaseStateMachine } from './state-machine';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Just the surface of ReleaseStateMachine this module needs (eases testing). */
type Machine = Pick<ReleaseStateMachine, 'transition'>;

interface PendingRow {
  id: string;
  trigger_type: string;
  state: 'pending' | 'grace';
  version: string | number;
}

interface ArmedRow {
  id: string;
  trigger_type: string;
  version: string | number;
}

// ---------------------------------------------------------------------------
// Overdue predicate (Property 9)
// ---------------------------------------------------------------------------

/**
 * True when more than `intervalDays` have elapsed since `lastActiveAt`
 * (strictly greater — exactly-at-interval is not yet overdue).
 */
export function isOverdue(lastActiveAt: Date | string, intervalDays: number, now: Date): boolean {
  const last = lastActiveAt instanceof Date ? lastActiveAt : new Date(lastActiveAt);
  return now.getTime() - last.getTime() > intervalDays * MS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Owner check-in (Property 10)
// ---------------------------------------------------------------------------

export interface CheckinResult {
  /** Trigger types reset PENDING/GRACE → ARMED. */
  reset: string[];
  /** Estate trigger types that could not be reversed (Req 4.5). */
  blocked: string[];
}

/**
 * Records the owner's heartbeat and reverses reversible triggers from
 * PENDING/GRACE back to ARMED. Estate triggers in those states are collected
 * into `blocked` (the route maps a non-empty `blocked` to 409).
 */
export async function processCheckin(ownerId: string, machine: Machine): Promise<CheckinResult> {
  // Req 4.2 — record activity.
  await query(`UPDATE users SET last_active_at = now() WHERE id = $1`, [ownerId]);

  const rows = await query<PendingRow>(
    `SELECT id, trigger_type, state, version
       FROM release_state
      WHERE owner_id = $1 AND state IN ('pending', 'grace')`,
    [ownerId],
  );

  const reset: string[] = [];
  const blocked: string[] = [];

  for (const row of rows.rows) {
    if (!isReversibleTrigger(row.trigger_type)) {
      blocked.push(row.trigger_type); // estate — cannot reverse (Req 4.5)
      continue;
    }
    try {
      await machine.transition(row.id, row.state, 'armed', row.version, { reversible: true });
      reset.push(row.trigger_type);
    } catch {
      // A concurrent writer moved this row; it will be re-evaluated on the next
      // heartbeat. Do not fail the whole check-in for one racing row.
    }
  }

  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'owner_checkin',
    entity: 'release_state',
    detail: { reset, blocked },
  });

  return { reset, blocked };
}

// ---------------------------------------------------------------------------
// Cron sweep (Property 9 at the system level)
// ---------------------------------------------------------------------------

export interface SweepResult {
  /** Owners found overdue. */
  evaluated: number;
  /** ARMED → PENDING transitions committed. */
  transitioned: number;
  /** Transitions that failed after all retries. */
  failures: number;
}

export interface SweepDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const CRON_RETRY_BASE_MS = 5000;
const CRON_MAX_RETRIES = 3;

/**
 * Finds overdue active owners and arms each ARMED release_state to PENDING.
 * A per-owner transient failure is retried (base 5s backoff, max 3) then logged
 * and skipped so one bad owner never blocks the sweep (Req 4.7).
 */
export async function runHeartbeatSweep(machine: Machine, deps: SweepDeps = {}): Promise<SweepResult> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());

  const overdue = await query<{ id: string }>(
    `SELECT id FROM users
       WHERE status = 'active'
         AND now() - last_active_at > (checkin_interval_days * INTERVAL '1 day')`,
  );

  let transitioned = 0;
  let failures = 0;

  for (const owner of overdue.rows) {
    const armed = await query<ArmedRow>(
      `SELECT id, trigger_type, version
         FROM release_state
        WHERE owner_id = $1 AND state = 'armed'`,
      [owner.id],
    );
    for (const rs of armed.rows) {
      const ok = await armOne(machine, rs, owner.id, now, sleep);
      if (ok) transitioned++;
      else failures++;
    }
  }

  return { evaluated: overdue.rows.length, transitioned, failures };
}

async function armOne(
  machine: Machine,
  rs: ArmedRow,
  ownerId: string,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < CRON_MAX_RETRIES; attempt++) {
    try {
      await machine.transition(rs.id, 'armed', 'pending', rs.version, {
        reversible: isReversibleTrigger(rs.trigger_type),
        updates: { initiated_by: 'cron', initiated_at: now().toISOString() },
      });
      return true;
    } catch {
      if (attempt < CRON_MAX_RETRIES - 1) {
        await sleep(CRON_RETRY_BASE_MS * 2 ** attempt);
      }
    }
  }
  process.stderr.write(`[heartbeat] failed to arm owner ${ownerId} trigger ${rs.trigger_type}\n`);
  return false;
}
