/**
 * Invitations — claim in calm, not in crisis.
 *
 * Today a recipient's first contact with Relay is a raw `?token=` URL arriving
 * at the worst moment of their life. Moving claim to designation time removes
 * all identity friction from the release path and creates the relationship the
 * referral loop depends on (J4-R9).
 *
 * Only a SHA-256 hash of the token is stored, so a database read cannot mint a
 * working invitation link. Single use, enforced by `claimed_at`.
 *
 * The standby view discloses the SHAPE of a grant — counts and categories.
 * Never item titles, never content (J4-R10).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { createHash, randomBytes } from 'crypto';

import { query } from '../db/connection';
import { ValidationError } from '../validation';

export const INVITE_TTL_DAYS = 30;

export type PersonType = 'recipient' | 'verifier';

const PERSON_TYPES: PersonType[] = ['recipient', 'verifier'];

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createInvitation(
  ownerId: string,
  input: { personId: string; personType: PersonType },
): Promise<{ token: string; expiresAt: string }> {
  if (!PERSON_TYPES.includes(input.personType)) {
    throw new ValidationError('personType must be recipient or verifier', 'personType');
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();

  await query(
    `INSERT INTO invitations (owner_id, person_id, person_type, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [ownerId, input.personId, input.personType, hashToken(token), expiresAt],
  );

  return { token, expiresAt };
}

export async function redeemInvitation(token: string): Promise<{
  ownerId: string;
  personId: string;
  personType: PersonType;
}> {
  // Expiry and single-use are filtered in SQL: a row that should not be
  // redeemable never reaches JS.
  const res = await query<{
    id: string;
    owner_id: string;
    person_id: string;
    person_type: PersonType;
  }>(
    `SELECT id, owner_id, person_id, person_type
       FROM invitations
      WHERE token_hash = $1
        AND claimed_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [hashToken(token)],
  );

  const row = res.rows[0];
  if (!row) {
    throw new ValidationError('That invitation link is not valid or has already been used.', 'token');
  }

  await query(`UPDATE invitations SET claimed_at = now() WHERE id = $1`, [row.id]);

  return { ownerId: row.owner_id, personId: row.person_id, personType: row.person_type };
}

export interface StandbyView {
  itemCount: number;
  categories: Record<string, number>;
  triggerTypes: string[];
}

/**
 * The shape of what this recipient would receive. Counts and categories only —
 * the SQL deliberately never touches `title` or any ciphertext column, so the
 * privacy guarantee holds at the query, not in the rendering (J4-R10).
 */
export async function buildStandbyView(
  ownerId: string,
  recipientId: string,
): Promise<StandbyView> {
  const res = await query<{ category: string | null; trigger_type: string; n: string }>(
    `SELECT vi.category AS category, ar.trigger_type AS trigger_type, COUNT(*)::text AS n
       FROM access_rules ar
       JOIN vault_items vi ON vi.id = ar.vault_item_id
      WHERE ar.owner_id = $1 AND ar.recipient_id = $2
      GROUP BY vi.category, ar.trigger_type`,
    [ownerId, recipientId],
  );

  const categories: Record<string, number> = {};
  const triggerTypes: string[] = [];
  let itemCount = 0;

  for (const row of res.rows) {
    const n = Number(row.n);
    itemCount += n;

    const cat = row.category ?? 'other';
    categories[cat] = (categories[cat] ?? 0) + n;

    if (!triggerTypes.includes(row.trigger_type)) triggerTypes.push(row.trigger_type);
  }

  return { itemCount, categories, triggerTypes };
}
