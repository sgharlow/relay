/**
 * Human-readable case IDs for a release.
 *
 * During a crisis an owner, a recipient and two verifiers are coordinating by
 * phone across four different notifications. They need one shared referent that
 * survives being read aloud — which a UUID does not (CC7, J6-R11).
 *
 * Crockford-style base32 with the ambiguous characters removed: no I/1, no O/0,
 * no U. Derived deterministically from the release_state id, so the same
 * release always yields the same case ID with nothing extra to persist.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC7, J6-R11
 */

import { createHash } from 'crypto';

/** No I, O, U, 0 or 1 — the characters people mishear or mistype. */
export const CASE_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTVWXYZ';

export function formatCaseId(seed: string): string {
  const digest = createHash('sha256').update(seed).digest();

  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CASE_ID_ALPHABET[digest[i] % CASE_ID_ALPHABET.length];
  }

  return `RLY-${out.slice(0, 4)}-${out.slice(4)}`;
}

/**
 * The case ID for a release row, whatever its vintage.
 *
 * Rows provisioned before CC7 carry `case_id = NULL`; deriving from the id on
 * read means no release can ever lack a referent, and a stored value still wins
 * so the ID stays stable if this derivation is ever changed.
 */
export function caseIdFor(row: { id: string; case_id?: string | null }): string {
  return row.case_id ?? formatCaseId(row.id);
}
