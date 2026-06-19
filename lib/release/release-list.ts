/**
 * Read/settings helpers for the Triggers screen (Requirement 4.1, 5.1).
 *
 *  - listReleaseStates  — the owner's release_state rows (state badges).
 *  - getCheckinInterval / updateCheckinInterval — the owner's check-in cadence
 *    (validated 1–365, Req 4.1).
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.1, 5.1
 */

import { query } from '../db/connection';
import { ValidationError } from '../validation';

export interface ReleaseStateSummary {
  id: string;
  trigger_type: string;
  state: string;
  required_confirmations: number;
  received_confirmations: number;
  version: string | number;
  grace_ends_at: string | null;
}

export async function listReleaseStates(ownerId: string): Promise<ReleaseStateSummary[]> {
  const r = await query<Record<string, unknown>>(
    `SELECT id, trigger_type, state, required_confirmations, received_confirmations, version, grace_ends_at
       FROM release_state WHERE owner_id = $1 ORDER BY trigger_type`,
    [ownerId],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    trigger_type: String(row.trigger_type),
    state: String(row.state),
    required_confirmations: Number(row.required_confirmations),
    received_confirmations: Number(row.received_confirmations),
    version: row.version as string | number,
    grace_ends_at: (row.grace_ends_at as string | null) ?? null,
  }));
}

export async function getCheckinInterval(ownerId: string): Promise<number> {
  const r = await query<{ checkin_interval_days: number | string }>(
    `SELECT checkin_interval_days FROM users WHERE id = $1 LIMIT 1`,
    [ownerId],
  );
  return Number(r.rows[0]?.checkin_interval_days ?? 30);
}

/** Validates 1–365 (Req 4.1) then persists the cadence. */
export async function updateCheckinInterval(ownerId: string, days: number): Promise<number> {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new ValidationError('checkin_interval_days must be an integer between 1 and 365', 'checkin_interval_days');
  }
  await query(`UPDATE users SET checkin_interval_days = $2 WHERE id = $1`, [ownerId, days]);
  return days;
}

/** Count of the owner's verifiers — the "M" in N-of-M. */
export async function getVerifierCount(ownerId: string): Promise<number> {
  const r = await query<{ count: string | number }>(
    `SELECT COUNT(*)::int AS count FROM verifiers WHERE owner_id = $1`,
    [ownerId],
  );
  return Number(r.rows[0]?.count ?? 0);
}
