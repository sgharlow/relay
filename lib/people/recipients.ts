/**
 * Recipient validation + persistence (Requirement 3.1, 3.6).
 *
 * Recipients are owner-scoped. Deleting a recipient cascade-deletes its
 * access_rules in application logic first (DSQL has no ON DELETE CASCADE).
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.1, 3.6
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { cascadeDelete } from '../db/integrity';
import { ValidationError, isNonEmptyString } from '../validation';
import { VALID_ROLES, type RecipientRole } from '../domain/enums';

export { VALID_ROLES, type RecipientRole };

export interface RecipientInput {
  name: string;
  relationship: string | null;
  email: string;
  phone: string | null;
  role: RecipientRole;
}

export interface Recipient extends RecipientInput {
  id: string;
  created_at: string;
}

const COLUMNS = 'id, name, relationship, email, phone, role, created_at';

function isEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

export function validateRecipientInput(body: unknown): RecipientInput {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.name)) throw new ValidationError('name is required', 'name');
  if (!isEmail(b.email)) throw new ValidationError('a valid email is required', 'email');
  if (!isNonEmptyString(b.role) || !VALID_ROLES.includes(b.role as RecipientRole)) {
    throw new ValidationError(`role must be one of: ${VALID_ROLES.join(', ')}`, 'role');
  }

  return {
    name: b.name,
    relationship: isNonEmptyString(b.relationship) ? b.relationship : null,
    email: b.email,
    phone: isNonEmptyString(b.phone) ? b.phone : null,
    role: b.role as RecipientRole,
  };
}

function toRecipient(row: Record<string, unknown>): Recipient {
  return {
    id: String(row.id),
    name: String(row.name),
    relationship: (row.relationship as string | null) ?? null,
    email: String(row.email),
    phone: (row.phone as string | null) ?? null,
    role: row.role as RecipientRole,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function listRecipients(ownerId: string): Promise<Recipient[]> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM recipients WHERE owner_id = $1 ORDER BY name ASC`,
      [ownerId],
    ),
  );
  return result.rows.map(toRecipient);
}

export async function createRecipient(ownerId: string, input: RecipientInput): Promise<Recipient> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `INSERT INTO recipients (owner_id, name, relationship, email, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [ownerId, input.name, input.relationship, input.email, input.phone, input.role],
    ),
  );
  return toRecipient(result.rows[0]);
}

export async function updateRecipient(
  ownerId: string,
  id: string,
  input: RecipientInput,
): Promise<Recipient | null> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `UPDATE recipients
          SET name = $1, relationship = $2, email = $3, phone = $4, role = $5
        WHERE id = $6 AND owner_id = $7
       RETURNING ${COLUMNS}`,
      [input.name, input.relationship, input.email, input.phone, input.role, id, ownerId],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  return toRecipient(result.rows[0]);
}

/** Cascade-deletes access_rules for the recipient, then the recipient (Req 3.6). */
export async function deleteRecipient(ownerId: string, id: string): Promise<void> {
  await cascadeDelete('access_rules', id, 'recipient_id');
  await withOccRetry(() =>
    query(`DELETE FROM recipients WHERE id = $1 AND owner_id = $2`, [id, ownerId]),
  );
}
