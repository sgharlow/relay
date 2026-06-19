/**
 * Verifier validation + persistence (Requirement 3.2, 3.7).
 *
 * Verifiers are owner-scoped. Deleting a verifier first removes all of its
 * verifier_confirmations rows in application logic (Req 3.7). A verifier may
 * also be a recipient — they are independent records.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.2, 3.7
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';
import { cascadeDelete } from '../db/integrity';
import { ValidationError, isNonEmptyString } from '../validation';

export interface VerifierInput {
  name: string;
  email: string;
  phone: string | null;
}

export interface Verifier extends VerifierInput {
  id: string;
  verification_status: string;
  created_at: string;
}

const COLUMNS = 'id, name, email, phone, verification_status, created_at';

function isEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

export function validateVerifierInput(body: unknown): VerifierInput {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.name)) throw new ValidationError('name is required', 'name');
  if (!isEmail(b.email)) throw new ValidationError('a valid email is required', 'email');
  return {
    name: b.name,
    email: b.email,
    phone: isNonEmptyString(b.phone) ? b.phone : null,
  };
}

function toVerifier(row: Record<string, unknown>): Verifier {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: (row.phone as string | null) ?? null,
    verification_status: String(row.verification_status ?? 'pending'),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function listVerifiers(ownerId: string): Promise<Verifier[]> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM verifiers WHERE owner_id = $1 ORDER BY name ASC`,
      [ownerId],
    ),
  );
  return result.rows.map(toVerifier);
}

export async function createVerifier(ownerId: string, input: VerifierInput): Promise<Verifier> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `INSERT INTO verifiers (owner_id, name, email, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [ownerId, input.name, input.email, input.phone],
    ),
  );
  return toVerifier(result.rows[0]);
}

export async function updateVerifier(
  ownerId: string,
  id: string,
  input: VerifierInput,
): Promise<Verifier | null> {
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `UPDATE verifiers
          SET name = $1, email = $2, phone = $3
        WHERE id = $4 AND owner_id = $5
       RETURNING ${COLUMNS}`,
      [input.name, input.email, input.phone, id, ownerId],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  return toVerifier(result.rows[0]);
}

/** Removes verifier_confirmations for the verifier, then the verifier (Req 3.7). */
export async function deleteVerifier(ownerId: string, id: string): Promise<void> {
  await cascadeDelete('verifier_confirmations', id, 'verifier_id');
  await withOccRetry(() =>
    query(`DELETE FROM verifiers WHERE id = $1 AND owner_id = $2`, [id, ownerId]),
  );
}
