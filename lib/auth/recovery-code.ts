/**
 * Recovery codes — the way back in after losing the authenticator.
 *
 * Relay has no password: authentication is an email address plus a TOTP code.
 * Until now there was no path back if the phone holding that authenticator was
 * lost, replaced, wiped or died, which for an older owner over a few years is
 * the expected case rather than an edge one.
 *
 * WHAT IS ACTUALLY AT STAKE. Data keys come from AWS KMS and are unwrapped
 * server-side for an authenticated caller; nothing is derived from key material
 * the owner holds. So losing the authenticator loses LOGIN, not DATA — this is
 * an authentication problem, and that is why a set of one-time codes solves it
 * completely rather than partially.
 *
 * Redeeming a code does NOT sign anyone in. It authorises re-enrolment of a new
 * authenticator, and the account is only reachable once that new authenticator
 * produces a valid code. A stolen recovery code alone is therefore not a
 * session; it is one half of a two-step change that still requires control of
 * the email address it was issued against.
 *
 * Feature: relay-h0-mvp
 * Requirements: J11-R1, 17.1
 */

import { createHash, randomInt } from 'crypto';

import { query } from '../db/connection';
import { CASE_ID_ALPHABET } from '../release/case-id';
import { notifyOwnerRecoveryCodesLow } from '../notify/notifications';
import { recordCodeMiss } from '../ops/guess-watch';

/**
 * Enough that losing a few to a house move does not matter, few enough that a
 * person will actually keep the list.
 */
// Defined in its own import-free module so the signup screen (a client
// component) can state the same number without dragging the database pool into
// the browser bundle. See lib/auth/recovery-code-count.ts.
import { RECOVERY_CODE_COUNT } from './recovery-code-count';
export { RECOVERY_CODE_COUNT };

/** ~50 bits each. Long enough that guessing is hopeless, short enough to copy. */
export const RECOVERY_CODE_LENGTH = 10;

export class RecoveryCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryCodeError';
    Object.setPrototypeOf(this, RecoveryCodeError.prototype);
  }
}

/** Formatting and case are the user's business, not ours. */
export function normaliseRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

/** Display form — two groups of five, which people transcribe accurately. */
export function formatRecoveryCode(code: string): string {
  const c = normaliseRecoveryCode(code);
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

export function generateRecoveryCode(): string {
  let out = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    out += CASE_ID_ALPHABET[randomInt(CASE_ID_ALPHABET.length)];
  }
  return out;
}

/**
 * Issues a fresh set, replacing any that exist.
 *
 * Returns PLAINTEXT codes — the only moment they exist in readable form. The
 * caller shows them once and forgets them; only hashes are persisted.
 *
 * Replacing rather than appending is deliberate: after a recovery the old list
 * is of unknown provenance (it may be why the account needed recovering), and
 * an owner who regenerates expects the previous sheet to stop working.
 */
export async function issueRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);

  await query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);
  for (const code of codes) {
    await query(`INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)`, [
      userId,
      hashRecoveryCode(code),
    ]);
  }

  return codes;
}

/**
 * Consumes one code for the given email.
 *
 * Scoped by email as well as by hash so a code can only ever act on the account
 * it was issued for — a code is not a bearer token for whichever account
 * happens to share the hash.
 *
 * Returns the user id on success. Throws with a message that is deliberately
 * identical for "no such account" and "wrong code": distinguishing them would
 * turn this endpoint into a way to test whether an address has a Relay account.
 */
export async function redeemRecoveryCode(email: string, code: string): Promise<string> {
  const generic = 'That email and recovery code did not match.';

  const normalised = normaliseRecoveryCode(code);
  if (normalised.length !== RECOVERY_CODE_LENGTH) {
    throw new RecoveryCodeError(generic);
  }

  const r = await query<{ id: string; user_id: string }>(
    `SELECT rc.id, rc.user_id
       FROM recovery_codes rc
       JOIN users u ON u.id = rc.user_id
      WHERE rc.code_hash = $1
        AND lower(u.email) = lower($2)
        AND rc.used_at IS NULL
      LIMIT 1`,
    [hashRecoveryCode(normalised), email.trim()],
  );

  const row = r.rows[0];
  if (!row) {
    // No matching row for this email+code pair. Recovery codes have NO
    // failed_attempts budget at all — entropy is their whole defence
    // (code-entropy.test.ts) — so this is the only trace a guess leaves.
    await recordCodeMiss('recovery');
    throw new RecoveryCodeError(generic);
  }

  /*
    Compare-and-swap — see lib/auth/recipient-code.ts. The SELECT above already
    filters on `used_at IS NULL`, but that is a snapshot read: two concurrent
    redemptions of one recovery code could both pass it. This code is the last
    way into an account whose authenticator is gone, so "spent exactly once" has
    to be the database's answer rather than the reader's.
  */
  const spent = await query(
    `UPDATE recovery_codes SET used_at = now()
      WHERE id = $1 AND used_at IS NULL`,
    [row.id],
  );
  if (spent.rowCount === 0) throw new RecoveryCodeError(generic);

  /*
    Warn while there is still time to act, ratified 2026-08-13. Spending a code
    is the only moment the count changes, and the Account screen — which shows
    it — is seen only by somebody who already went looking. Running the sheet
    down to zero with no authenticator is terminal: nobody can restore that
    account, us included.

    THRESHOLD, not every time: at two or fewer. Mail on every recovery would
    train the owner to ignore it, and an ignored warning is the same as none.

    Best-effort and AFTER the code is spent. Getting back in is the operation;
    the warning is a courtesy, and a courtesy must never be able to fail the
    thing it is attached to.
  */
  try {
    const left = await remainingRecoveryCodes(row.user_id);
    if (left <= LOW_RECOVERY_CODE_THRESHOLD) {
      const u = await query<{ email: string | null }>(
        `SELECT email FROM users WHERE id = $1 LIMIT 1`,
        [row.user_id],
      );
      const email = u.rows[0]?.email;
      if (email) await notifyOwnerRecoveryCodesLow({ ownerEmail: email, remaining: left });
    }
  } catch (err) {
    process.stderr.write(`[recovery] low-code notice failed for ${row.user_id}: ${String(err)}
`);
  }

  return row.user_id;
}

/** At or below this many unused codes, the owner is told. */
export const LOW_RECOVERY_CODE_THRESHOLD = 2;

/** How many codes remain, so the owner can be warned before running out. */
export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Replaces the account's authenticator. Called only after a code is redeemed. */
export async function replaceTotpSecret(userId: string, secret: string): Promise<void> {
  await query(`UPDATE users SET totp_secret = $2 WHERE id = $1`, [userId, secret]);
}
