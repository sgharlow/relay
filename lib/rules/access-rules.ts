/**
 * Access-rule validation + persistence — the Rule Engine (Requirement 3.3–3.9).
 *
 * An access rule grants a recipient scoped access to a vault item under a
 * trigger type. Invariants enforced here (belt-and-suspenders with the DB CHECK
 * constraints in 001_initial.sql):
 *  - estate rules are ALWAYS irreversible (Property 7, Req 3.5)
 *  - the (vault_item_id, recipient_id) pair must both belong to the owner
 *    (assertNoCrossOwner, Req 3.8)
 *  - N-of-M verifier configuration must satisfy 1 ≤ N ≤ M (Property 8, Req 3.9)
 *
 * N-of-M (`required_confirmations`) is stored on `release_state`, not on
 * `access_rules`. `validateNofM` is the Rule Engine's validation primitive; the
 * release_state provisioning path (Milestone 5) calls it before persisting N.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.3, 3.4, 3.5, 3.8, 3.9
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { assertNoCrossOwner } from '../db/integrity';
import { ValidationError, isNonEmptyString } from '../validation';
import { VALID_TRIGGER_TYPES, VALID_SCOPES, type TriggerType, type Scope } from '../domain/enums';

export { VALID_TRIGGER_TYPES, VALID_SCOPES, type TriggerType, type Scope };

export interface AccessRuleInput {
  vault_item_id: string;
  recipient_id: string;
  trigger_type: TriggerType;
  scope: Scope;
  reversible: boolean;
  release_after_days: number | null;
}

export interface AccessRule extends AccessRuleInput {
  id: string;
  created_at: string;
}

const COLUMNS =
  'id, vault_item_id, recipient_id, trigger_type, scope, reversible, release_after_days, created_at';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a rule payload. Collects ALL missing/invalid required fields so the
 * caller can report them together (Req 3.4), then enforces the estate-
 * irreversible invariant (Property 7, Req 3.5).
 */
export function validateAccessRuleInput(body: unknown): AccessRuleInput {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const invalid: string[] = [];

  if (!isNonEmptyString(b.vault_item_id)) invalid.push('vault_item_id');
  if (!isNonEmptyString(b.recipient_id)) invalid.push('recipient_id');
  if (!isNonEmptyString(b.trigger_type) || !VALID_TRIGGER_TYPES.includes(b.trigger_type as TriggerType)) {
    invalid.push('trigger_type');
  }
  if (!isNonEmptyString(b.scope) || !VALID_SCOPES.includes(b.scope as Scope)) {
    invalid.push('scope');
  }
  if (typeof b.reversible !== 'boolean') invalid.push('reversible');

  let releaseAfterDays: number | null = null;
  if (b.release_after_days != null) {
    if (typeof b.release_after_days !== 'number' || !Number.isInteger(b.release_after_days) || b.release_after_days < 0) {
      invalid.push('release_after_days');
    } else {
      releaseAfterDays = b.release_after_days;
    }
  }

  if (invalid.length > 0) {
    throw new ValidationError(`Missing or invalid fields: ${invalid.join(', ')}`, invalid[0]);
  }

  // Estate rules are ALWAYS irreversible (Property 7).
  if (b.trigger_type === 'estate' && b.reversible === true) {
    throw new ValidationError('estate rules must be irreversible (reversible must be false)', 'reversible');
  }

  return {
    vault_item_id: b.vault_item_id as string,
    recipient_id: b.recipient_id as string,
    trigger_type: b.trigger_type as TriggerType,
    scope: b.scope as Scope,
    reversible: b.reversible as boolean,
    release_after_days: releaseAfterDays,
  };
}

/**
 * Validates an N-of-M verifier configuration (Property 8, Req 3.9).
 * @throws {ValidationError} unless 1 ≤ N ≤ M.
 */
export function validateNofM(n: number, m: number): void {
  if (!Number.isInteger(n) || !Number.isInteger(m) || n < 1 || m < 1 || n > m) {
    throw new ValidationError(
      `Invalid N-of-M: require 1 ≤ N ≤ M (got N=${n}, M=${m})`,
      'required_confirmations',
    );
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function toRule(row: Record<string, unknown>): AccessRule {
  return {
    id: String(row.id),
    vault_item_id: String(row.vault_item_id),
    recipient_id: String(row.recipient_id),
    trigger_type: row.trigger_type as TriggerType,
    scope: row.scope as Scope,
    reversible: Boolean(row.reversible),
    release_after_days: (row.release_after_days as number | null) ?? null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function listRules(ownerId: string): Promise<AccessRule[]> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM access_rules WHERE owner_id = $1 ORDER BY created_at ASC`,
      [ownerId],
    ),
  );
  return result.rows.map(toRule);
}

/**
 * Creates a rule after confirming both referenced rows belong to the owner
 * (Req 3.8). Throws IntegrityError (mapped to 403) on a cross-owner reference.
 */
export async function createRule(ownerId: string, input: AccessRuleInput): Promise<AccessRule> {
  await assertNoCrossOwner(ownerId, [
    { table: 'vault_items', id: input.vault_item_id },
    { table: 'recipients', id: input.recipient_id },
  ]);

  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `INSERT INTO access_rules
         (owner_id, vault_item_id, recipient_id, trigger_type, scope, reversible, release_after_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [
        ownerId,
        input.vault_item_id,
        input.recipient_id,
        input.trigger_type,
        input.scope,
        input.reversible,
        input.release_after_days,
      ],
    ),
  );
  return toRule(result.rows[0]);
}

export async function updateRule(
  ownerId: string,
  id: string,
  input: AccessRuleInput,
): Promise<AccessRule | null> {
  await assertNoCrossOwner(ownerId, [
    { table: 'vault_items', id: input.vault_item_id },
    { table: 'recipients', id: input.recipient_id },
  ]);

  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `UPDATE access_rules
          SET vault_item_id = $1, recipient_id = $2, trigger_type = $3,
              scope = $4, reversible = $5, release_after_days = $6
        WHERE id = $7 AND owner_id = $8
       RETURNING ${COLUMNS}`,
      [
        input.vault_item_id,
        input.recipient_id,
        input.trigger_type,
        input.scope,
        input.reversible,
        input.release_after_days,
        id,
        ownerId,
      ],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  return toRule(result.rows[0]);
}

export async function deleteRule(ownerId: string, id: string): Promise<void> {
  await withOccRetry(() =>
    query(`DELETE FROM access_rules WHERE id = $1 AND owner_id = $2`, [id, ownerId]),
  );
}
