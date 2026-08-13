/**
 * Typed access codes for recipients.
 *
 * Mirrors `verifier-code.ts`. The recipient link is the higher-value credential
 * of the two — it opens the vault rather than asking one question — so getting
 * the token out of the URL matters more here, not less. Verifiers were done
 * first only because a recipient is far more motivated to push through the
 * friction, which made the cheaper path the right place to measure the cost.
 *
 * ONE EXTRA RULE OVER THE VERIFIER VERSION: the code carries the release
 * version it was minted against, and redemption re-checks it against the row.
 * A re-arm bumps that version and kills every outstanding token; a code that
 * outlived it would be a way to reopen access the owner had already closed,
 * which is the exact guarantee this product is sold on.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1, J8-R1
 */

import { createHash, randomInt } from 'crypto';

import { query } from '../db/connection';
import { CASE_ID_ALPHABET } from '../release/case-id';

/** Matches the recipient JWT's 24-hour window. */
export const RECIPIENT_CODE_TTL_SECONDS = 24 * 60 * 60;
export const RECIPIENT_CODE_LENGTH = 8;
export const MAX_FAILED_ATTEMPTS = 10;

export type RecipientCodeReason = 'invalid' | 'expired' | 'used' | 'locked' | 'closed';

export class RecipientCodeError extends Error {
  constructor(message: string, public readonly reason: RecipientCodeReason) {
    super(message);
    this.name = 'RecipientCodeError';
    Object.setPrototypeOf(this, RecipientCodeError.prototype);
  }
}

export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function hashCode(code: string): string {
  return createHash('sha256').update(normaliseCode(code)).digest('hex');
}

export function formatCode(code: string): string {
  const c = normaliseCode(code);
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

export function generateCode(): string {
  let out = '';
  for (let i = 0; i < RECIPIENT_CODE_LENGTH; i++) {
    out += CASE_ID_ALPHABET[randomInt(CASE_ID_ALPHABET.length)];
  }
  return out;
}

/** Issues a code. Returns the plaintext — the only moment it exists. */
export async function issueRecipientCode(params: {
  recipientId: string;
  releaseStateId: string;
  ownerId: string;
  version: string | number | bigint;
  now?: Date;
}): Promise<string> {
  const code = generateCode();
  const now = params.now ?? new Date();

  await query(
    `INSERT INTO recipient_codes
       (code_hash, recipient_id, release_state_id, owner_id, release_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      hashCode(code),
      params.recipientId,
      params.releaseStateId,
      params.ownerId,
      String(params.version),
      new Date(now.getTime() + RECIPIENT_CODE_TTL_SECONDS * 1000).toISOString(),
    ],
  );

  return code;
}

export interface RedeemedRecipientCode {
  recipientId: string;
  releaseStateId: string;
  version: string;
}

/**
 * Exchanges a typed code for the identity and version it represents.
 *
 * The version check is the load-bearing part: if the owner has re-armed since
 * the code was issued, the access it stands for is gone and the code must go
 * with it. That case gets its own reason so the caller can show the graceful
 * close rather than an indistinguishable failure — the recipient did nothing
 * wrong, and the good outcome happened.
 */
export async function redeemRecipientCode(
  input: string,
  now: Date = new Date(),
): Promise<RedeemedRecipientCode> {
  const normalised = normaliseCode(input);
  if (normalised.length !== RECIPIENT_CODE_LENGTH) {
    throw new RecipientCodeError('That code does not look right. It is 8 characters.', 'invalid');
  }

  const r = await query<{
    id: string;
    recipient_id: string;
    release_state_id: string;
    release_version: string;
    expires_at: string;
    redeemed_at: string | null;
    failed_attempts: number;
    current_version: string;
    state: string;
  }>(
    `SELECT rc.id, rc.recipient_id, rc.release_state_id, rc.release_version,
            rc.expires_at, rc.redeemed_at, rc.failed_attempts,
            rs.version AS current_version, rs.state
       FROM recipient_codes rc
       JOIN release_state rs ON rs.id = rc.release_state_id
      WHERE rc.code_hash = $1 LIMIT 1`,
    [hashCode(normalised)],
  );

  const row = r.rows[0];
  if (!row) throw new RecipientCodeError('That code was not recognised.', 'invalid');

  if (Number(row.failed_attempts) >= MAX_FAILED_ATTEMPTS) {
    throw new RecipientCodeError('This code has been locked. Ask for a new one.', 'locked');
  }
  if (row.redeemed_at) {
    throw new RecipientCodeError('This code has already been used.', 'used');
  }
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new RecipientCodeError('This code has expired.', 'expired');
  }

  // The owner re-armed: the access this code stands for no longer exists.
  if (String(row.current_version) !== String(row.release_version)) {
    throw new RecipientCodeError('Access has been closed.', 'closed');
  }

  /*
    🔴 THIS WAS `WHERE id = $1` ALONE UNTIL 2026-08-13, and so were the other
    four redemption paths. The checks above run against a snapshot; under DSQL's
    snapshot isolation two requests can each read the same unredeemed row, both
    pass every guard, and both stamp it — so a single-use code was redeemable
    more than once, and "single use" was a claim the database was not making.

    The compare-and-swap makes the DATABASE decide who won: exactly one UPDATE
    can match `redeemed_at IS NULL`, and the loser sees rowCount 0. This is the
    same form lib/people/fingerprint.ts already used and fingerprint.test.ts
    already asserted — the pattern was in the repo, just not on the paths that
    hand out access.
  */
  const claimed = await query(
    `UPDATE recipient_codes SET redeemed_at = now()
      WHERE id = $1 AND redeemed_at IS NULL`,
    [row.id],
  );
  if (claimed.rowCount === 0) {
    // Somebody else redeemed it between the SELECT above and this write.
    throw new RecipientCodeError('This code has already been used.', 'used');
  }

  return {
    recipientId: row.recipient_id,
    releaseStateId: row.release_state_id,
    version: String(row.release_version),
  };
}

/** Counts a miss against a code that exists; silent when it does not. */
export async function recordFailedAttempt(input: string): Promise<void> {
  await query(`UPDATE recipient_codes SET failed_attempts = failed_attempts + 1 WHERE code_hash = $1`, [
    hashCode(input),
  ]);
}
