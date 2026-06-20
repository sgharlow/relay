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
        [authSub, email],
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
      [email, authSub],
    ),
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('Upsert INSERT returned no rows');
  return row;
}
