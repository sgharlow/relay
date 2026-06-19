/**
 * Release state machine (Requirement 5) — the demo spine.
 *
 * One `release_state` row per (owner_id, trigger_type) advances through:
 *   ARMED → PENDING → GRACE → RELEASED, with reversible side-exits back to
 *   ARMED / CANCELLED. ARMED is the safe default: any ambiguous outcome or
 *   retry exhaustion leaves the row ARMED (`safeResetToArmed`).
 *
 * Every mutation is a compare-and-swap UPDATE guarded on BOTH `state` and
 * `version` (Req 5.6). SQLSTATE 40001 is retried up to 3× with exponential
 * backoff, re-reading and re-evaluating before each retry (Req 5.7); on
 * exhaustion the row is force-reset to ARMED and `OccExhaustedError` is thrown
 * (Req 5.9). A CAS row-count of 0 means a concurrent writer moved the row —
 * surfaced as `CasMismatchError` carrying the freshly re-read row.
 *
 * Reversibility is a property of the trigger type: estate triggers are
 * non-reversible (Req 5.10); all others are reversible. The reversible-only
 * transitions (PENDING→ARMED, GRACE→ARMED, GRACE→CANCELLED, RELEASED→ARMED)
 * are therefore forbidden for estate.
 *
 * Permitted transitions are rejected at the application layer BEFORE any DB
 * write (Property 11). GRACE→RELEASED additionally requires both
 * `received_confirmations ≥ required_confirmations` AND an elapsed grace window
 * (Property 12, Req 5.5).
 *
 * Feature: relay-h0-mvp
 * Requirements: 5.1–5.10
 */

import { query } from '../db/connection';
import { isSqlState40001 } from '../db/occ';
import { writeAuditEntry } from '../audit/audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReleaseStateValue = 'armed' | 'pending' | 'grace' | 'released' | 'cancelled';

export interface ReleaseStateRow {
  id: string;
  owner_id: string;
  trigger_type: string;
  state: ReleaseStateValue;
  required_confirmations: number;
  received_confirmations: number;
  version: string | number;
  initiated_by: string | null;
  initiated_at: string | null;
  grace_ends_at: string | null;
  released_at: string | null;
  created_at: string;
}

/** Columns a transition may set in addition to `state`/`version`. */
const UPDATABLE_COLUMNS = new Set([
  'required_confirmations',
  'received_confirmations',
  'initiated_by',
  'initiated_at',
  'grace_ends_at',
  'released_at',
]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal release transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
    Object.setPrototypeOf(this, IllegalTransitionError.prototype);
  }
}

export class CasMismatchError extends Error {
  constructor(public readonly current: ReleaseStateRow | null) {
    super('Release CAS mismatch — state/version changed concurrently');
    this.name = 'CasMismatchError';
    Object.setPrototypeOf(this, CasMismatchError.prototype);
  }
}

export class OccExhaustedError extends Error {
  constructor() {
    super('Release transition exhausted OCC retries — reset to ARMED');
    this.name = 'OccExhaustedError';
    Object.setPrototypeOf(this, OccExhaustedError.prototype);
  }
}

export class GraceConditionError extends Error {
  constructor() {
    super('GRACE → RELEASED requires received ≥ required AND elapsed grace window');
    this.name = 'GraceConditionError';
    Object.setPrototypeOf(this, GraceConditionError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Permitted-transition table (Property 11)
// ---------------------------------------------------------------------------

interface TransitionRule {
  from: ReleaseStateValue;
  to: ReleaseStateValue;
  /** True if only reversible (non-estate) triggers may take this edge. */
  reversibleOnly: boolean;
}

export const PERMITTED_TRANSITIONS: readonly TransitionRule[] = [
  { from: 'armed', to: 'pending', reversibleOnly: false },
  { from: 'pending', to: 'grace', reversibleOnly: false },
  { from: 'pending', to: 'armed', reversibleOnly: true },
  { from: 'grace', to: 'released', reversibleOnly: false },
  { from: 'grace', to: 'armed', reversibleOnly: true },
  { from: 'grace', to: 'cancelled', reversibleOnly: true },
  { from: 'released', to: 'armed', reversibleOnly: true }, // reversibleOnly ⇒ non-estate
];

/** Estate triggers are permanent once released (Req 5.10); all others reverse. */
export function isReversibleTrigger(triggerType: string): boolean {
  return triggerType !== 'estate';
}

/**
 * Whether `from → to` is permitted for a trigger of the given reversibility.
 * Any pair not in the table — or a reversible-only edge for a non-reversible
 * trigger — is rejected (Property 11).
 */
export function isPermittedTransition(
  from: ReleaseStateValue,
  to: ReleaseStateValue,
  reversible: boolean,
): boolean {
  const rule = PERMITTED_TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!rule) return false;
  if (rule.reversibleOnly && !reversible) return false;
  return true;
}

/**
 * GRACE → RELEASED guard (Property 12): both the confirmation quorum AND the
 * elapsed grace window must hold.
 */
export function canRelease(
  receivedConfirmations: number,
  requiredConfirmations: number,
  graceEndsAt: string | Date | null,
  now: Date,
): boolean {
  if (receivedConfirmations < requiredConfirmations) return false;
  if (graceEndsAt == null) return false;
  const ends = graceEndsAt instanceof Date ? graceEndsAt : new Date(graceEndsAt);
  return ends.getTime() <= now.getTime();
}

// ---------------------------------------------------------------------------
// SET-clause builder
// ---------------------------------------------------------------------------

function buildSetClause(
  updates: Partial<ReleaseStateRow>,
  startIndex: number,
): { clause: string; values: unknown[] } {
  const cols = Object.keys(updates).filter((k) => UPDATABLE_COLUMNS.has(k));
  const fragments: string[] = [];
  const values: unknown[] = [];
  cols.forEach((col, i) => {
    fragments.push(`${col} = $${startIndex + i}`);
    values.push((updates as Record<string, unknown>)[col]);
  });
  return { clause: fragments.length ? ', ' + fragments.join(', ') : '', values };
}

// ---------------------------------------------------------------------------
// ReleaseStateMachine
// ---------------------------------------------------------------------------

export interface TransitionOptions {
  /** Reversibility of the trigger; required for reversible-only edges. */
  reversible?: boolean;
  /** Extra columns to set in the same CAS commit. */
  updates?: Partial<ReleaseStateRow>;
  /** Extra fields merged into this transition's audit-entry `detail`. */
  auditDetail?: Record<string, unknown>;
}

interface MachineDeps {
  /** Injectable sleep (tests pass a no-op to skip backoff delays). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0,1) (defaults to Math.random). */
  random?: () => number;
  maxRetries?: number;
}

const BASE_DELAY_MS = 100;
const JITTER_MS = 50;
const MAX_DELAY_MS = 1000;

export class ReleaseStateMachine {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRetries: number;

  constructor(deps: MachineDeps = {}) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = deps.random ?? Math.random;
    this.maxRetries = deps.maxRetries ?? 3;
  }

  /**
   * Performs a CAS transition. Validates the edge before any DB write, then
   * UPDATEs guarded on (state, version). Retries SQLSTATE 40001 with backoff,
   * re-reading and re-evaluating each time; on exhaustion resets to ARMED and
   * throws {@link OccExhaustedError}.
   *
   * @throws {IllegalTransitionError} edge not permitted for this trigger
   * @throws {CasMismatchError}       a concurrent writer changed the row
   * @throws {OccExhaustedError}      40001 retries exhausted (row reset to ARMED)
   */
  async transition(
    id: string,
    expectedState: ReleaseStateValue,
    nextState: ReleaseStateValue,
    expectedVersion: string | number,
    opts: TransitionOptions = {},
  ): Promise<ReleaseStateRow> {
    const reversible = opts.reversible ?? false;

    if (!isPermittedTransition(expectedState, nextState, reversible)) {
      throw new IllegalTransitionError(expectedState, nextState);
    }

    let expState = expectedState;
    let expVer = expectedVersion;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await this.commit(id, expState, nextState, expVer, opts.updates ?? {}, opts.auditDetail);
      } catch (err) {
        if (!isSqlState40001(err)) throw err;

        // Serialization failure — back off, re-read, re-evaluate, retry.
        if (attempt >= this.maxRetries - 1) {
          await this.safeResetToArmed(id);
          throw new OccExhaustedError();
        }
        await this.sleep(this.backoffDelay(attempt));

        const current = await this.readRow(id);
        if (!current || !isPermittedTransition(current.state, nextState, reversible)) {
          // The row moved somewhere the original transition no longer applies.
          throw new CasMismatchError(current);
        }
        expState = current.state;
        expVer = current.version;
      }
    }
    // Unreachable (loop either returns or throws), but satisfies the type.
    await this.safeResetToArmed(id);
    throw new OccExhaustedError();
  }

  /** Single CAS UPDATE + audit. Throws CasMismatchError on a 0-row result. */
  private async commit(
    id: string,
    expectedState: ReleaseStateValue,
    nextState: ReleaseStateValue,
    expectedVersion: string | number,
    updates: Partial<ReleaseStateRow>,
    auditDetail?: Record<string, unknown>,
  ): Promise<ReleaseStateRow> {
    const { clause, values } = buildSetClause(updates, 5);
    const result = await query<ReleaseStateRow>(
      `UPDATE release_state
          SET state = $1,
              version = version + 1${clause}
        WHERE id = $2 AND state = $3 AND version = $4
       RETURNING *`,
      [nextState, id, expectedState, String(expectedVersion), ...values],
    );

    if (result.rowCount === 0 || result.rows.length === 0) {
      throw new CasMismatchError(await this.readRow(id));
    }

    const row = result.rows[0];
    await writeAuditEntry(row.owner_id, {
      actor: 'system',
      action: `release_transition_${nextState}`,
      entity: 'release_state',
      entityId: id,
      detail: { from: expectedState, to: nextState, ...auditDetail },
    });
    return row;
  }

  /**
   * Convenience for the GRACE → RELEASED edge. Enforces the Property 12 guard
   * (received ≥ required AND grace elapsed) before transitioning and stamps
   * `released_at` in the same CAS commit (Req 5.8).
   */
  async releaseFromGrace(row: ReleaseStateRow, now: Date): Promise<ReleaseStateRow> {
    if (!canRelease(row.received_confirmations, row.required_confirmations, row.grace_ends_at, now)) {
      throw new GraceConditionError();
    }
    return this.transition(row.id, 'grace', 'released', row.version, {
      reversible: isReversibleTrigger(row.trigger_type),
      updates: { released_at: now.toISOString() },
    });
  }

  /**
   * Best-effort, unconditional reset to ARMED — the "default to locked" safety
   * net invoked on retry exhaustion (Req 5.9). Never throws: a failed reset must
   * not mask the original error.
   */
  async safeResetToArmed(id: string): Promise<void> {
    try {
      const result = await query<ReleaseStateRow>(
        `UPDATE release_state
            SET state = 'armed', version = version + 1
          WHERE id = $1
         RETURNING *`,
        [id],
      );
      if (result.rowCount && result.rows[0]) {
        await writeAuditEntry(result.rows[0].owner_id, {
          actor: 'system',
          action: 'release_safe_reset_armed',
          entity: 'release_state',
          entityId: id,
          detail: { reason: 'occ_exhausted' },
        });
      }
    } catch {
      // Swallow — this is the last-resort safety path.
    }
  }

  private async readRow(id: string): Promise<ReleaseStateRow | null> {
    const r = await query<ReleaseStateRow>(`SELECT * FROM release_state WHERE id = $1`, [id]);
    return r.rowCount && r.rows.length ? r.rows[0] : null;
  }

  private backoffDelay(attempt: number): number {
    const jitter = (this.random() * 2 - 1) * JITTER_MS; // ±50ms
    return Math.min(BASE_DELAY_MS * 2 ** attempt + jitter, MAX_DELAY_MS);
  }
}
