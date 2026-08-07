/**
 * Per-user TOTP secret resolution.
 *
 * Before this module, `authorize` validated every owner's second factor against
 * a single `process.env.TOTP_SECRET`, so a code minted for one account was
 * valid for every account. Resolution now prefers the owner's own
 * `users.totp_secret`.
 *
 * The env fallback is retained ONLY for accounts that predate self-serve signup
 * (`totp_secret IS NULL`) so the existing dogfood account keeps authenticating.
 * Once every account carries its own secret, `TOTP_SECRET` can be retired.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { query } from '../db/connection';

export async function resolveTotpSecret(email: string): Promise<string> {
  const normalised = email.trim().toLowerCase();

  const res = await query<{ totp_secret: string | null }>(
    // Deterministic: prefer a row that actually carries a per-user secret, then
    // the oldest. An unordered LIMIT 1 would pick arbitrarily if an email ever
    // ends up on more than one row.
    `SELECT totp_secret FROM users
      WHERE email = $1
      ORDER BY (totp_secret IS NULL), created_at ASC
      LIMIT 1`,
    [normalised],
  );

  const perUser = res.rows[0]?.totp_secret;
  if (perUser) return perUser;

  const envSecret = process.env.TOTP_SECRET;
  if (!envSecret) {
    throw new Error(
      'No per-user TOTP secret for this account and TOTP_SECRET is not set',
    );
  }

  return envSecret;
}
