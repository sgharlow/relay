/**
 * Per-user TOTP secret resolution.
 *
 * Before this module, `authorize` validated every owner's second factor against
 * a single `process.env.TOTP_SECRET`, so a code minted for one account was valid
 * for every account. Resolution is now strictly the owner's own
 * `users.totp_secret`, and an account without one cannot use email+TOTP at all.
 *
 * 🔴 THE ENV FALLBACK WAS RETIRED 2026-08-13, and it was never what its own
 * comment said it was. That comment claimed the fallback was "retained ONLY for
 * accounts that predate self-serve signup" — but the code applied it to ANY row
 * with a NULL secret, and nothing in the product ever writes one except
 * `signup.ts`. Every contact account is created by `upsertUser`
 * (lib/people/claim.ts, lib/people/break-glass.ts, lib/seed/seed-runner.ts),
 * which does not set `totp_secret`. So the population covered by the "legacy"
 * fallback was not one dogfood account frozen in the past — it was every person
 * who has ever claimed a standby role, and it grew with the beta.
 *
 * That made `TOTP_SECRET` a master key: anyone holding it could sign in as any
 * contact, knowing only their email address. Measured on production 2026-08-13,
 * five of six accounts resolved through it, including the seeded demo account
 * that holds 25 items and whose `is_demo_account` flag gates
 * `/api/demo/simulate`.
 *
 * THREE WRITTEN CLAIMS DEPENDED ON THE OPPOSITE BEING TRUE, and all three were
 * false while this stood: this file's own header; the sprint plan's §14
 * "non-finding" (*"nothing grants a standby row a totp_secret, so email+TOTP is
 * refused for them"* — the reverse: because nothing grants them one, it was
 * ACCEPTED); and §19's *"nobody can sign into"* the demo account. Removing the
 * fallback is what makes all three true, rather than correcting them to describe
 * a weaker product.
 *
 * WHAT THIS COSTS: nothing that was working. Only NULL-secret rows are affected
 * and every one of them is a fixture; the single real account carries its own
 * secret. Contacts sign in the way they always have — a claim code, an emergency
 * code, or a passkey — none of which touch this path.
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

  /*
    Both branches now return the same thing, and that is the point: an unknown
    address and a known address with no secret of its own are indistinguishable
    from outside. `authorize` maps null to the same rejection as a wrong code, so
    neither reveals whether an account exists.

    An account with no `totp_secret` is not locked out of Relay — it is locked
    out of THIS factor, which it never had. Contacts hold a claim code, an
    emergency code or a passkey.
  */
  if (!row) return null;

  return row.totp_secret ?? null;
}
