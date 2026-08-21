/**
 * Sign-in upsert for the credentials provider — maps `auth_sub` → users row.
 *
 * Uses the app-level intent-read pattern (SELECT → UPDATE or INSERT) rather
 * than `INSERT … ON CONFLICT (auth_sub)`. Migration 001 indexes `auth_sub`
 * NON-uniquely, and Aurora DSQL may not enforce UNIQUE secondary indexes, so
 * `ON CONFLICT` can error on real infra and break every sign-in. The intent-
 * read approach needs no UNIQUE constraint and no schema change — the same
 * trade-off lib/release/provisioning.ts already makes (it accepts a small race
 * on concurrent first sign-ins of the same brand-new user).
 *
 * Writes go through `withOccRetry` so a DSQL snapshot-isolation conflict
 * (SQLSTATE 40001) is retried rather than surfaced to the sign-in flow.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { query } from '../db/connection';
import { withOccRetry } from '../db/occ';

export interface UserRecord {
  id: string;
  email: string;
  is_demo_account: boolean;
}

/**
 * Resolves the user identified by `authSub`, creating the row on first sign-in.
 * On a returning user the email is kept in sync and last_active_at is bumped.
 * Returns {id, email, is_demo_account} for the caller.
 */
export async function upsertUser(authSub: string, email: string): Promise<UserRecord> {
  /*
    🔴 ONE PERSON COULD BECOME TWO ROWS, and this is the seam where it happened
    (found 2026-08-21). `signup.ts` lowercases before it stores AND before it
    asks `emailIsTaken` (`WHERE email = $1`), and `resolveTotpSecret` looks up on
    a lowercased address. The standby paths did not: `lib/people/claim.ts` and
    `lib/people/break-glass.ts` lowercase the AUTH_SUB and then pass the email
    exactly as the owner typed it into the roster, which is not normalised on the
    way in either.

    So a contact entered as `Sarah@Example.com` got a users row with that casing.
    When Sarah later signed up as an owner, `emailIsTaken('sarah@example.com')`
    matched nothing and a SECOND identity was created — severing every standby
    link the first one held, which is exactly what §3.7 ("the roster row is the
    RELATIONSHIP, the user row is the IDENTITY") exists to prevent. Her first row
    was also unreachable by `resolveTotpSecret`, whose `ORDER BY (totp_secret IS
    NULL), created_at` hedge already anticipated "an email ending up on more than
    one row" without anything closing the way it got there.

    NORMALISED HERE rather than at the three call sites: a rule every caller must
    remember is the rule the fourth caller forgets, and this is the one function
    all of them go through. The UPDATE below runs on every sign-in, so it also
    repairs rows written before this existed, one sign-in at a time.

    ⚠️ THE AUTH_SUB IS THE CALLER'S, untouched. `credentials:` and `standby:` are
    deliberately different subjects for the same human, and folding them here
    would merge two identities rather than keep one.

    ⚠️ This does not retire the duplicates already in the table. Nothing in this
    repo can — that is a read (`SELECT lower(email), count(*) FROM users GROUP BY
    1 HAVING count(*) > 1`) and then a decision per collision.
  */
  const normalisedEmail = email.trim().toLowerCase();

  const existing = await query<UserRecord>(
    `SELECT id, email, is_demo_account FROM users WHERE auth_sub = $1 LIMIT 1`,
    [authSub],
  );

  if (existing.rowCount && existing.rows.length) {
    const updated = await withOccRetry(() =>
      query<UserRecord>(
        `UPDATE users
            SET email = $2,
                last_active_at = now()
          WHERE auth_sub = $1
        RETURNING id, email, is_demo_account`,
        [authSub, normalisedEmail],
      ),
    );
    const row = updated.rows[0];
    if (!row) throw new Error('Upsert UPDATE returned no rows');
    return row;
  }

  const inserted = await withOccRetry(() =>
    query<UserRecord>(
      `INSERT INTO users (email, auth_sub, status, last_active_at, checkin_interval_days, is_demo_account)
       VALUES ($1, $2, 'active', now(), 30, false)
       RETURNING id, email, is_demo_account`,
      [normalisedEmail, authSub],
    ),
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('Upsert INSERT returned no rows');
  return row;
}
