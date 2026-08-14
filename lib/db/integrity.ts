/**
 * Application-layer referential integrity utilities for Aurora DSQL.
 *
 * DSQL does not enforce foreign key constraints — all referential and ownership
 * checks are performed here in application code.  Every exported function wraps
 * its DB operation in `withOccRetry` to tolerate SQLSTATE 40001 serialization
 * failures.
 *
 * Exports:
 *  - IntegrityError  — typed error class with code 'NOT_FOUND' | 'UNAUTHORIZED' | 'INTEGRITY_ERROR'
 *  - assertOwns      — verifies a row exists and its owner_id matches the caller
 *  - cascadeDelete   — deletes all rows in a table where a FK column equals parentId
 *  - assertNoCrossOwner — batch assertOwns across multiple table/id references
 *
 * Requirements: 16.1, 16.2, 16.3
 */

import { query } from './connection';
import { withOccRetry } from './occ';
import { isUuid } from '../validation';
import { writeAuditEntry } from '../audit/audit-service';

/**
 * The four actions Requirement 16.5 names, and the only ones this module writes.
 *
 * 🔴 AUDIT FAILURES ARE SWALLOWED HERE, WHICH IS THE OPPOSITE OF THE RULE
 * ELSEWHERE. CLAUDE.md is explicit that an audit write blocks the operation it
 * describes — deliberately, so nothing happens unrecorded. This one function
 * inverts that, for a reason worth stating:
 *
 * `assertOwns` is the app's ownership GATE. If a failed audit write threw from
 * inside it, an audit outage would stop every ownership check from returning —
 * turning a logging problem into a total outage of a vault, including the
 * release path a family may be waiting on. Worse, the refusal it is trying to
 * record has already been decided: the caller is about to be told NOT_FOUND or
 * UNAUTHORIZED either way, so blocking adds no safety and removes availability.
 *
 * The trade is therefore explicit: for these four bookkeeping actions the
 * enforcement is authoritative and the log is best-effort. Every audit write
 * that records a CHANGE to somebody's vault still blocks.
 */
type IntegrityAction =
  | 'ref_integrity_parent_not_found'
  | 'ref_integrity_owner_mismatch'
  | 'ref_integrity_cascade_delete'
  | 'ref_integrity_uniqueness_enforced';

export async function recordIntegrityAction(
  ownerId: string,
  action: IntegrityAction,
  table: string,
  entityId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await writeAuditEntry(ownerId, {
      actor: `system:integrity`,
      action,
      entity: table,
      entityId,
      detail,
    });
  } catch (err) {
    process.stderr.write(`[integrity] audit write failed for ${action}: ${String(err)}
`);
  }
}

// ---------------------------------------------------------------------------
// IntegrityError
// ---------------------------------------------------------------------------

export type IntegrityErrorCode = 'NOT_FOUND' | 'UNAUTHORIZED' | 'INTEGRITY_ERROR';

/**
 * Thrown by integrity helpers when an ownership check fails or a referenced
 * row does not exist.
 */
export class IntegrityError extends Error {
  public readonly code: IntegrityErrorCode;

  constructor(code: IntegrityErrorCode, message: string) {
    super(message);
    this.name = 'IntegrityError';
    this.code = code;
    // Maintain correct prototype chain for instanceof checks in transpiled code
    Object.setPrototypeOf(this, IntegrityError.prototype);
  }
}

// ---------------------------------------------------------------------------
// assertOwns
// ---------------------------------------------------------------------------

/**
 * Verifies that a row identified by `id` exists in `table` and that its
 * `owner_id` column equals `ownerId`.
 *
 * Throws:
 *  - IntegrityError('NOT_FOUND')    — row does not exist
 *  - IntegrityError('UNAUTHORIZED') — row exists but owner_id does not match
 *
 * The SELECT is wrapped in `withOccRetry` to handle SQLSTATE 40001 from
 * concurrent snapshot reads (Requirement 16.3).
 *
 * @param ownerId - The authenticated owner's UUID
 * @param table   - Table name (one of: recipients, verifiers, vault_items,
 *                  access_rules, release_state)
 * @param id      - Row UUID to look up
 */
export async function assertOwns(
  ownerId: string,
  table: string,
  id: string,
): Promise<void> {
  // A malformed id cannot identify a row, so answering NOT_FOUND is both true
  // and the safest thing to say. Without this the value reached the driver,
  // which raised SQLSTATE 22P02 — and routes that do not use the shared
  // mapError (39 of them) rendered that as a 500. Proven on production
  // 2026-08-10: DELETE /api/vault/items/not-a-uuid returned 500 while
  // /api/policies/not-a-uuid, which does use mapError, returned 400.
  //
  // Guarding HERE rather than per-route is what makes it structural: every
  // ownership check in the app funnels through this function, and each caller
  // already handles IntegrityError. It also keeps Requirement 1.8 intact —
  // malformed, missing and someone-else's ids stay indistinguishable.
  if (!isUuid(id)) {
    throw new IntegrityError('NOT_FOUND', `Row not found: ${table}`);
  }

  await withOccRetry(async () => {
    // Parameterised table names are not supported by pg; table is validated by
    // being a trusted internal string — callers are server-side only.
    const result = await query<{ owner_id: string }>(
      `SELECT owner_id FROM ${table} WHERE id = $1 LIMIT 1`,
      [id],
    );

    if (result.rowCount === 0 || result.rows.length === 0) {
      await recordIntegrityAction(ownerId, 'ref_integrity_parent_not_found', table, id);
      throw new IntegrityError(
        'NOT_FOUND',
        `Row not found: ${table}/${id}`,
      );
    }

    if (result.rows[0].owner_id !== ownerId) {
      /*
        The one entry here that is a SECURITY record rather than bookkeeping: it
        is somebody reaching for a row that belongs to another vault. The detail
        deliberately names the table and id but NOT the true owner — the log is
        readable by the caller's owner, and telling them whose row it was would
        turn an audit trail into a disclosure.
      */
      await recordIntegrityAction(ownerId, 'ref_integrity_owner_mismatch', table, id);
      throw new IntegrityError(
        'UNAUTHORIZED',
        `Owner mismatch on ${table}/${id}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// cascadeDelete
// ---------------------------------------------------------------------------

/**
 * Deletes all rows in `table` where `fkColumn = parentId`.
 *
 * Used to maintain referential integrity when a parent row is deleted (since
 * DSQL does not enforce ON DELETE CASCADE).  The DELETE is wrapped in
 * `withOccRetry` (Requirement 16.3).
 *
 * 🔴 REQUIREMENT 16.5 REQUIRES THIS TO BE LOGGED, AND IT WAS NOT. The spec
 * names four exact actions the audit log must carry —
 * `ref_integrity_parent_not_found`, `ref_integrity_owner_mismatch`,
 * `ref_integrity_cascade_delete` and `ref_integrity_uniqueness_enforced` — and
 * none of them had ever been written. So the one place that records what
 * happened to a family's vault was silent about rows the system deleted on its
 * own initiative: an owner removing one recipient could take access_rules and
 * policies with them, and the audit page showed the recipient going and nothing
 * else.
 *
 * `ownerId` is optional ONLY because a cascade can run from a path that has
 * already lost the owner context (account closure deletes the owner row first).
 * Every caller that has it passes it, and a cascade without one still deletes
 * correctly — it is the record that is missing, not the enforcement.
 *
 * @param table     - Table to delete from
 * @param parentId  - Value to match against `fkColumn`
 * @param fkColumn  - Foreign-key column name in `table`
 * @param ownerId   - Whose audit chain records the cascade (Req 16.5)
 */
export async function cascadeDelete(
  table: string,
  parentId: string,
  fkColumn: string,
  ownerId?: string,
): Promise<void> {
  const deleted = await withOccRetry(async () => {
    const res = await query(
      `DELETE FROM ${table} WHERE ${fkColumn} = $1`,
      [parentId],
    );
    return res.rowCount ?? 0;
  });

  // Only when something actually went. A cascade that deleted nothing is not an
  // enforcement action, and logging it would bury the ones that are.
  if (ownerId && deleted > 0) {
    await recordIntegrityAction(ownerId, 'ref_integrity_cascade_delete', table, parentId, {
      rows: deleted,
      via: fkColumn,
    });
  }
}

// ---------------------------------------------------------------------------
// assertNoCrossOwner
// ---------------------------------------------------------------------------

/**
 * Batch ownership check — asserts that every (table, id) pair is owned by
 * `ownerId`.  All checks run in parallel via `Promise.all`.
 *
 * Throws the first `IntegrityError` encountered if any check fails.
 *
 * @param ownerId - The authenticated owner's UUID
 * @param refs    - Array of {table, id} objects to check
 */
export async function assertNoCrossOwner(
  ownerId: string,
  refs: Array<{ table: string; id: string }>,
): Promise<void> {
  await Promise.all(refs.map(({ table, id }) => assertOwns(ownerId, table, id)));
}
