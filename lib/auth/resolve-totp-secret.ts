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

export async function resolveTotpSecret(email: string): Promise<string | null> {
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

  const row = res.rows[0];

  // No account. Not "no secret" — no account, so there is nothing to fall back
  // FOR. The env fallback is scoped to rows that predate signup, and stretching
  // it to cover an absent row is what made sign-in answer an unregistered
  // address differently from a registered one.
  if (!row) return null;

  if (row.totp_secret) return row.totp_secret;

  // A pre-signup account (totp_secret IS NULL) still authenticates against the
  // shared env secret. Absent or unusable, the caller rejects like any other
  // bad code — it never becomes an error the caller can distinguish.
  return process.env.TOTP_SECRET ?? null;
}
