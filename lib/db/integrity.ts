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
  await withOccRetry(async () => {
    // Parameterised table names are not supported by pg; table is validated by
    // being a trusted internal string — callers are server-side only.
    const result = await query<{ owner_id: string }>(
      `SELECT owner_id FROM ${table} WHERE id = $1 LIMIT 1`,
      [id],
    );

    if (result.rowCount === 0 || result.rows.length === 0) {
      throw new IntegrityError(
        'NOT_FOUND',
        `Row not found: ${table}/${id}`,
      );
    }

    if (result.rows[0].owner_id !== ownerId) {
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
 * @param table     - Table to delete from
 * @param parentId  - Value to match against `fkColumn`
 * @param fkColumn  - Foreign-key column name in `table`
 */
export async function cascadeDelete(
  table: string,
  parentId: string,
  fkColumn: string,
): Promise<void> {
  await withOccRetry(async () => {
    await query(
      `DELETE FROM ${table} WHERE ${fkColumn} = $1`,
      [parentId],
    );
  });
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
