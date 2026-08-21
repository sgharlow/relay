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

import { createHash, randomInt } from 'crypto';

import { query } from '../db/connection';
import { CASE_ID_ALPHABET } from '../release/case-id';
import { ValidationError } from '../validation';

export const INVITE_TTL_DAYS = 30;

export type PersonType = 'recipient' | 'verifier';

const PERSON_TYPES: PersonType[] = ['recipient', 'verifier'];

/**
 * Normalises a typed claim code so formatting and case do not matter:
 * "4KMPQ-7XR2W", "4kmpq 7xr2w" and "4KMPQ7XR2W" are the same code.
 *
 * Applied inside hashToken so every caller gets it for free — a redeem path
 * that forgot to normalise would reject perfectly correct codes.
 */
export function normaliseToken(token: string): string {
  return token.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(normaliseToken(token)).digest('hex');
}

/** Display form — two groups of five, which people transcribe accurately. */
export function formatInviteCode(code: string): string {
  const c = normaliseToken(code);
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

/**
 * TEN characters, not the eight used for verifier and recipient codes.
 *
 * Those live 24–72 hours; an invitation lives 30 days, so the guessing window
 * is roughly an order of magnitude longer and the entropy is raised to match
 * (~50 bits rather than ~40). Copying the shorter format would have been
 * consistent-looking and wrong.
 */
export const INVITE_CODE_LENGTH = 10;

function generateInviteCode(): string {
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += CASE_ID_ALPHABET[randomInt(CASE_ID_ALPHABET.length)];
  }
  return out;
}

export async function createInvitation(
  ownerId: string,
  input: {
    personId: string;
    personType: PersonType;
    /** How the owner intends to get this to them. Splitting on it is what isolates delivery. */
    deliveryChannel?: 'email' | 'owner';
    /** Free-text tag so a deliberate Phase 0 run reads apart from ordinary traffic. */
    cohort?: string;
  },
): Promise<{ token: string; expiresAt: string }> {
  if (!PERSON_TYPES.includes(input.personType)) {
    throw new ValidationError('personType must be recipient or verifier', 'personType');
  }

  // A typed code, not a URL token. Every other credential Relay emails is now
  // typed, and the rule "we never send a link that signs you in" is only useful
  // to a recipient if it holds for ALL of our mail — one exception makes it
  // unusable as a way to spot a fake.
  const token = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();

  /*
    🔴 REISSUING USED TO ADD A CODE RATHER THAN REPLACE ONE. This function
    INSERTed unconditionally and nothing anywhere retired a prior row, so an
    owner who pressed Invite three times left THREE independently redeemable
    thirty-day credentials for one seat — `redeemInvitation` and `claimStandbyRole`
    both match on `token_hash` alone with `claimed_at IS NULL AND expires_at >
    now()`, so every earlier code stayed good and the owner had no way to
    withdraw it. "Reissue" is the word the interface uses; the database was
    doing something else.

    Retired by EXPIRY rather than DELETE on purpose: the row carries
    `delivery_channel`, `cohort` and `created_at`, which is what makes the
    Phase 0 arms interpretable, and deleting it would erase the measurement to
    fix the credential. Expiring does both — `expires_at > now()` is false for
    it by the time any read happens.

    It also cleans up after the create-time mint: `inviteOnCreateBestEffort`
    discards the code it receives, and on the owner-delivered arm nothing is
    sent, so creating a person left one invitation that no human could ever type.
  */
  await query(
    `UPDATE invitations
        SET expires_at = now()
      WHERE owner_id = $1
        AND person_id = $2
        AND claimed_at IS NULL
        AND expires_at > now()`,
    [ownerId, input.personId],
  );

  await query(
    `INSERT INTO invitations
       (owner_id, person_id, person_type, token_hash, expires_at, delivery_channel, cohort)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      ownerId,
      input.personId,
      input.personType,
      hashToken(token),
      expiresAt,
      input.deliveryChannel ?? null,
      input.cohort ?? null,
    ],
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

  /*
    Compare-and-swap — see lib/people/claim.ts, which carries the full reasoning.
    The `claimed_at IS NULL` filter in the SELECT above is a snapshot read; only
    this predicate makes the database pick one winner.
  */
  const claimed = await query(
    `UPDATE invitations SET claimed_at = now()
      WHERE id = $1 AND claimed_at IS NULL`,
    [row.id],
  );
  if (claimed.rowCount === 0) {
    throw new ValidationError('That invitation link is not valid or has already been used.', 'token');
  }

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

/**
 * Records that the claim page loaded with this code — the middle of the funnel.
 *
 * First open wins: this measures "did it reach a human", not how many times they
 * looked. Failures are swallowed because a measurement must never be able to stop
 * somebody claiming; a missing timestamp costs us a data point, and a thrown
 * error would cost them their place in a family's plan.
 */
export async function markInvitationOpened(token: string): Promise<void> {
  try {
    await query(
      // `claimed_at IS NULL` was a condition here until 2026-08-12 and it
      // corrupted the funnel it exists to measure. ClaimClient fires this
      // fire-and-forget and then immediately calls signIn, so the two race —
      // and when the claim wins, `opened_at` is never set. That loses the marker
      // precisely on the SUCCESSFUL claims, which can make `opened` read lower
      // than `claimed`: an impossible funnel, and one that would have been read
      // as "people are not opening it" when they were opening and finishing.
      // `opened_at IS NULL` alone is all the idempotency this needs.
      `UPDATE invitations SET opened_at = now()
        WHERE token_hash = $1 AND opened_at IS NULL`,
      [hashToken(token)],
    );
  } catch {
    // Instrumentation is never load-bearing.
  }
}
