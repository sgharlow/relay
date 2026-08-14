/**
 * Typed access codes for verifiers.
 *
 * Replaces a signed JWT in a query string with a short code the verifier types
 * at a bare URL. The credential leaves the link, so a forwarded email — the
 * likeliest leak by far, because forwarding one to a family member is a
 * completely reasonable thing to do — no longer hands over the ability to
 * confirm someone's release.
 *
 * It also lets Relay say, and mean, that it never sends a link that logs you
 * in. That claim is the anti-phishing value, and it is worth more than any
 * single control: once it holds absolutely, an email containing such a link is
 * self-evidently not us.
 *
 * ⚠️ NOT THE CASE ID. `formatCaseId` derives a public referent from the
 * release_state id, deterministically, specifically so four people can say it
 * out loud to each other. It authenticates nothing. This is a separate secret.
 *
 * Entropy: 8 characters over a 31-character alphabet ≈ 2^39.6. Combined with
 * per-code and per-IP throttling that is far out of reach of guessing, and it
 * stays short enough to read over the phone or type on a hospital-corridor
 * phone screen.
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R1
 */

import { createHash, randomInt } from 'crypto';

import { query } from '../db/connection';
import { CASE_ID_ALPHABET } from '../release/case-id';
import { recordCodeMiss } from '../ops/guess-watch';

/** Matches the verifier JWT's lifetime so nothing changes for the verifier. */
export const CODE_TTL_SECONDS = 72 * 60 * 60;

export const CODE_LENGTH = 8;

/** A code is dead after this many wrong guesses, regardless of their source. */
export const MAX_FAILED_ATTEMPTS = 10;

export class VerifierCodeError extends Error {
  constructor(message: string, public readonly reason: 'invalid' | 'expired' | 'used' | 'locked') {
    super(message);
    this.name = 'VerifierCodeError';
    Object.setPrototypeOf(this, VerifierCodeError.prototype);
  }
}

/**
 * Strips formatting and case so a verifier can type what they see, however
 * they see it: "7k4m p2xw", "7K4M-P2XW" and "7k4mp2xw" are the same code.
 */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function hashCode(code: string): string {
  return createHash('sha256').update(normaliseCode(code)).digest('hex');
}

/** Display form — grouped in fours, which is how people read digits back. */
export function formatCode(code: string): string {
  const c = normaliseCode(code);
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/**
 * Generates a code using rejection-free uniform selection.
 *
 * `randomInt` is drawn from the CSPRNG and is unbiased across the alphabet;
 * `Math.random()` would be neither, and this value is a credential.
 */
export function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CASE_ID_ALPHABET[randomInt(CASE_ID_ALPHABET.length)];
  }
  return out;
}

/**
 * Issues a code for one (verifier, release_state) pair.
 *
 * Returns the PLAINTEXT, which is the only time it exists — the caller puts it
 * in the email and drops it. Only the hash is persisted.
 */
export async function issueVerifierCode(params: {
  verifierId: string;
  releaseStateId: string;
  ownerId: string;
  now?: Date;
}): Promise<string> {
  const code = generateCode();
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_SECONDS * 1000);

  await query(
    `INSERT INTO verifier_codes (code_hash, verifier_id, release_state_id, owner_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashCode(code), params.verifierId, params.releaseStateId, params.ownerId, expiresAt.toISOString()],
  );

  return code;
}

export interface RedeemedCode {
  verifierId: string;
  releaseStateId: string;
  ownerId: string;
}

/**
 * Exchanges a typed code for the identity it represents.
 *
 * A wrong code increments the failure counter on nothing (there is no row to
 * increment), which is correct: only a code that EXISTS can be worn down, and
 * that is the case worth throttling. Per-IP limiting at the route covers blind
 * guessing.
 *
 * Distinguishes "already used" from "invalid" on purpose. A verifier who
 * reloads their confirmation page deserves to know what happened; the value of
 * hiding it is negligible, because reaching this branch already required
 * presenting a valid code.
 */
export async function redeemVerifierCode(input: string, now: Date = new Date()): Promise<RedeemedCode> {
  const normalised = normaliseCode(input);
  if (normalised.length !== CODE_LENGTH) {
    throw new VerifierCodeError('That code does not look right. It is 8 characters.', 'invalid');
  }

  const r = await query<{
    id: string;
    verifier_id: string;
    release_state_id: string;
    owner_id: string;
    expires_at: string;
    redeemed_at: string | null;
    failed_attempts: number;
  }>(
    `SELECT id, verifier_id, release_state_id, owner_id, expires_at, redeemed_at, failed_attempts
       FROM verifier_codes WHERE code_hash = $1 LIMIT 1`,
    [hashCode(normalised)],
  );

  const row = r.rows[0];
  if (!row) {
    // Matched no row at all — see lib/ops/guess-watch. Never passes the code.
    await recordCodeMiss('verifier');
    throw new VerifierCodeError('That code was not recognised.', 'invalid');
  }

  if (Number(row.failed_attempts) >= MAX_FAILED_ATTEMPTS) {
    throw new VerifierCodeError('This code has been locked. Ask for a new one.', 'locked');
  }

  if (row.redeemed_at) {
    throw new VerifierCodeError('This code has already been used.', 'used');
  }

  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new VerifierCodeError('This code has expired. Ask for a new one.', 'expired');
  }

  /*
    Compare-and-swap, not a bare stamp — see lib/auth/recipient-code.ts for the
    reasoning. The checks above read a snapshot; only this predicate makes the
    database pick a single winner, and the loser sees rowCount 0.
  */
  const claimed = await query(
    `UPDATE verifier_codes SET redeemed_at = now()
      WHERE id = $1 AND redeemed_at IS NULL`,
    [row.id],
  );
  if (claimed.rowCount === 0) {
    throw new VerifierCodeError('This code has already been used.', 'used');
  }

  return {
    verifierId: row.verifier_id,
    releaseStateId: row.release_state_id,
    ownerId: row.owner_id,
  };
}

/**
 * Records a failed guess against a code that exists.
 *
 * Called by the route on a near-miss so a targeted attack on one known code is
 * throttled even from rotating addresses. Silent when the code is unknown —
 * there is nothing to count, and creating a row would let an attacker fill the
 * table with garbage.
 */
export async function recordFailedAttempt(input: string): Promise<void> {
  await query(
    `UPDATE verifier_codes SET failed_attempts = failed_attempts + 1 WHERE code_hash = $1`,
    [hashCode(input)],
  );
}
