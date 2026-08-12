/**
 * Verifier resolution from a session — the counterpart to `lib/access/session-access.ts`.
 *
 * THE GAP THIS CLOSES, and it was a gap in the PLAN before it was one in the code.
 * `docs/standby-architecture.md` §3.2 described the release-path swap entirely in
 * recipient vocabulary, §6 Phase 2 said "claimed *recipients* stop receiving
 * codes", and §5's change list named no verifier module. Sprint D implemented
 * exactly that and left the verifier on tokens.
 *
 * Two other parts of the same document assumed otherwise: §3.1 gives a standby
 * verifier an auth method of "passkey or bound device", and §4.4 rests its whole
 * derive-on-read argument on a verifier LOADING THEIR STANDBY DASHBOARD and
 * finding lapsed requests actionable there. Escalation therefore ran on dashboard
 * load — it is invoked from `resolveStandbyFor` — and computed actionability that
 * no surface could act on. Core principle 5, *every participant can do their job
 * by visiting the site*, was false for claimed verifiers. Both are now fixed, and
 * §3.2 records the omission.
 *
 * RULE 1 (§3.7): resolved from the DATABASE, never from the session token. The
 * JWT establishes who the person is; whether they may decide anything, and about
 * what, is a question only the row answers — otherwise revocation would be
 * delayed by the token lifetime, and revocation is the control behind the
 * coercion risk.
 *
 * This mints nothing and transmits nothing. It only answers "is there a decision
 * open for this human, and which roster row are they filling while they make it".
 *
 * Feature: relay-standby
 * Requirements: J7-R1, J7-R2, J7-R5, J4-R9
 */

import { query } from '../db/connection';

export interface ResolvedVerifier {
  /** The roster row they are acting as — `submitConfirmation` keys on this. */
  verifierId: string;
  ownerId: string;
  releaseStateId: string;
  /** `pending` or `grace`; both accept a decision. */
  state: string;
}

/**
 * The decision this signed-in verifier can currently make, if any.
 *
 * Only `pending` and `grace` qualify, matching `submitConfirmation`'s own guard —
 * a released or armed row is not a question anyone is being asked. Returning null
 * for an owner, a recipient, or a verifier with nothing open is the normal case
 * and must never read as an error.
 *
 * `releaseStateId` disambiguates the rare case of one person standing by for two
 * owners with simultaneous open releases; the dashboard always passes it. It is
 * not a credential — holding it grants nothing without a session, and the roster
 * row is re-checked here regardless of what was passed.
 */
export async function resolveVerifierFor(
  userId: string,
  opts: { releaseStateId?: string } = {},
): Promise<ResolvedVerifier | null> {
  const res = await query<{
    verifier_id: string;
    owner_id: string;
    release_state_id: string;
    state: string;
  }>(
    `SELECT v.id AS verifier_id, v.owner_id, rs.id AS release_state_id, rs.state
       FROM verifiers v
       JOIN release_state rs ON rs.owner_id = v.owner_id
      WHERE v.claimed_user_id = $1
        AND coalesce(v.standby_state, 'invited') <> 'revoked'
        AND rs.state IN ('pending', 'grace')
        AND ($2::uuid IS NULL OR rs.id = $2::uuid)
      ORDER BY CASE rs.state WHEN 'pending' THEN 0 ELSE 1 END,
               rs.initiated_at NULLS LAST,
               rs.id
      LIMIT 1`,
    [userId, opts.releaseStateId ?? null],
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    verifierId: row.verifier_id,
    ownerId: row.owner_id,
    releaseStateId: row.release_state_id,
    state: row.state,
  };
}
