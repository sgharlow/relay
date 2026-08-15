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
import { ValidationError, isNonEmptyString, cleanPersonName, isEmailAddress } from '../validation';
import { readStandbyState, type StandbyState } from './standby-state';
import { readSecondaryAddress } from './secondary-address';
import { VALID_ROLES, type RecipientRole } from '../domain/enums';

export { VALID_ROLES, type RecipientRole };

export interface RecipientInput {
  name: string;
  relationship: string | null;
  email: string;
  phone: string | null;
  role: RecipientRole;
  /**
   * A second mailbox for the notices that carry no credential — see
   * `lib/notify/fanout.ts` for what it is and is not used for.
   *
   * `undefined` means the caller expressed no opinion and an update must LEAVE
   * THE STORED VALUE ALONE; `null` means remove it. See `secondary-address.ts`.
   */
  email_secondary?: string | null;
}

export interface Recipient extends RecipientInput {
  id: string;
  standby_state: StandbyState;
  created_at: string;
}

const COLUMNS =
  'id, name, relationship, email, email_secondary, phone, role, standby_state, created_at';

export function validateRecipientInput(body: unknown): RecipientInput {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;

  // Bounded and single-lined — see cleanPersonName; the value reaches an email.
  const name = cleanPersonName(b.name);
  if (!isEmailAddress(b.email)) throw new ValidationError('a valid email is required', 'email');
  if (!isNonEmptyString(b.role) || !VALID_ROLES.includes(b.role as RecipientRole)) {
    throw new ValidationError(`role must be one of: ${VALID_ROLES.join(', ')}`, 'role');
  }

  return {
    name,
    relationship: isNonEmptyString(b.relationship) ? b.relationship : null,
    email: b.email,
    phone: isNonEmptyString(b.phone) ? b.phone : null,
    role: b.role as RecipientRole,
    email_secondary: readSecondaryAddress(b.email_secondary, b.email),
  };
}

function toRecipient(row: Record<string, unknown>): Recipient {
  return {
    id: String(row.id),
    name: String(row.name),
    relationship: (row.relationship as string | null) ?? null,
    email: String(row.email),
    phone: (row.phone as string | null) ?? null,
    email_secondary: (row.email_secondary as string | null) ?? null,
    role: row.role as RecipientRole,
    standby_state: readStandbyState(row.standby_state),
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
  // One human, one row. Without this, approving a delegate proposal for someone
  // already in the circle silently creates a SECOND recipient with the same
  // email — splitting their access_rules across two rows and double-counting
  // them in the coverage matrix. DSQL has no unique constraints, so the check
  // is application-side (matching how all referential integrity works here).
  //
  // Compared on normalised email, the same key listPeople and
  // detectRoleConcentration use, so all three agree on what "the same person"
  // means.
  const existing = await query<{ id: string }>(
    `SELECT id FROM recipients WHERE owner_id = $1 AND lower(trim(email)) = lower(trim($2)) LIMIT 1`,
    [ownerId, input.email],
  );
  if (existing.rows.length > 0) {
    throw new ValidationError(
      `${input.email} is already a recipient for this vault`,
      'email',
    );
  }

  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `INSERT INTO recipients (owner_id, name, relationship, email, phone, role, email_secondary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [
        ownerId,
        input.name,
        input.relationship,
        input.email,
        input.phone,
        input.role,
        input.email_secondary ?? null,
      ],
    ),
  );
  return toRecipient(result.rows[0]);
}

export async function updateRecipient(
  ownerId: string,
  id: string,
  input: RecipientInput,
): Promise<Recipient | null> {
  /*
    THE SECOND ADDRESS IS ONLY TOUCHED WHEN THE CALLER SAID SOMETHING ABOUT IT.
    This route is a full replace and `RenameControl` sends four fields; a plain
    `email_secondary = $n` would make correcting a typo in a name delete the
    backup address, silently, on a row nobody was looking at. `undefined` here
    means "no opinion" and leaves the column out of the statement entirely.
  */
  const touchesSecondary = input.email_secondary !== undefined;
  const result = await withOccRetry(() =>
    query<Record<string, unknown>>(
      `UPDATE recipients
          SET name = $1, relationship = $2, email = $3, phone = $4, role = $5
              ${touchesSecondary ? ', email_secondary = $8' : ''}
        WHERE id = $6 AND owner_id = $7
       RETURNING ${COLUMNS}`,
      [
        input.name,
        input.relationship,
        input.email,
        input.phone,
        input.role,
        id,
        ownerId,
        ...(touchesSecondary ? [input.email_secondary] : []),
      ],
    ),
  );
  if (result.rowCount === 0 || result.rows.length === 0) return null;
  return toRecipient(result.rows[0]);
}

/** Cascade-deletes access_rules for the recipient, then the recipient (Req 3.6). */
export async function deleteRecipient(ownerId: string, id: string): Promise<void> {
  // Policies FIRST. Deleting only the rules would leave the generating policy
  // behind, and the next materialisation would recreate the grants for a
  // recipient who no longer exists (J4-R15).
  await cascadeDelete('access_policies', id, 'recipient_id', ownerId);
  await cascadeDelete('access_rules', id, 'recipient_id', ownerId);
  await withOccRetry(() =>
    query(`DELETE FROM recipients WHERE id = $1 AND owner_id = $2`, [id, ownerId]),
  );
}
