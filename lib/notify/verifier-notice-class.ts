/**
 * How to notify each verifier when a trigger fires — and, critically, whether
 * to put a working credential in the message at all.
 *
 * ADAPTIVE MINTING (Option 2, ratified by Steve 2026-08-12). Until now this
 * path minted a verifier code for EVERY verifier, unconditionally. Two things
 * had changed underneath it and neither had been carried through:
 *
 *   1. Claimed verifiers can act from a session (`resolveVerifierFor`). Mailing
 *      them a live credential they do not need is the exact thing hybrid+6
 *      exists to stop — core principle 1, *nothing secret is transmitted at
 *      release time*. `docs/user-journeys.md` J7-R2 already SAID a claimed
 *      verifier receives no code; the code had simply never been changed to
 *      match, so the spec was describing a product we had not built.
 *   2. Quorum tightened to `confirmed` (§4.3). An unconfirmed verifier's answer
 *      is recorded and does not count, so a code mailed to them is a live
 *      credential bought at full risk for an outcome of exactly nothing.
 *
 * THE CONDITION IS `confirmed`, NOT `claimed`. Claiming gets you an account;
 * being confirmed is what makes your answer count. Keying on `claimed` — the
 * obvious mirror of the recipient branch — would suppress the code for someone
 * whose answer counts and who has no other way to sign in.
 *
 * AN UNREDEEMED BREAK-GLASS CODE DOES NOT SUPPRESS THE MAIL. `lib/vault/readiness.ts`
 * counts one as a way back in, and for its question — *did the owner leave this
 * person a fallback* — that is right. Here the question is *can this person act
 * in the next hour*, and an issued code that is lost looks identical in the
 * database to one held in a wallet. Suppressing on it would silently strand the
 * person whose quorum depends on them.
 *
 * Feature: relay-standby
 * Requirements: J7-R1, J7-R2, J7-R5
 */

import { query } from '../db/connection';
import { readStandbyState } from '../people/standby-state';

export type VerifierNoticeClass =
  /** Revoked. Send nothing at all — the owner removed this person on purpose. */
  | 'skip'
  /** Confirmed, and no way to sign in unaided. Mint a single-use code. */
  | 'code'
  /** Confirmed, and holds a passkey or an authenticator. Tell them; mint nothing. */
  | 'sign_in'
  /** Named but not verified. Their answer would not count; mint nothing. */
  | 'not_counted';

interface VerifierRow {
  id: string;
  standby_state: string | null;
  claimed_user_id: string | null;
}

/**
 * Classifies each verifier id. Ids that resolve to no row are omitted from the
 * map; callers treat an absent entry as `code`, which is the fail-open default
 * (see `classifyOrFailOpen`).
 */
export async function classifyVerifiersForNotice(
  verifierIds: string[],
): Promise<Map<string, VerifierNoticeClass>> {
  const out = new Map<string, VerifierNoticeClass>();
  if (verifierIds.length === 0) return out;

  const rows = await query<VerifierRow>(
    `SELECT id, standby_state, claimed_user_id FROM verifiers WHERE id = ANY($1)`,
    [verifierIds],
  );

  const userIds = rows.rows.map((r) => r.claimed_user_id).filter((id): id is string => Boolean(id));

  // Two narrow lookups rather than one join with a correlated EXISTS: this is
  // the shape `lib/vault/readiness.ts` already runs against live Aurora DSQL,
  // and a release-path query is the wrong place to find out whether DSQL plans
  // something more ambitious.
  const [passkeys, authenticators] = userIds.length
    ? await Promise.all([
        query<{ user_id: string }>(
          `SELECT DISTINCT user_id FROM webauthn_credentials WHERE user_id = ANY($1)`,
          [userIds],
        ),
        // A verifier may be an OWNER of their own vault as well as a standby for
        // someone else's (§3.7 rule 2 links rather than mints). They sign in with
        // email + TOTP and need no code either — keying on passkeys alone would
        // mail a live credential to the one class of person who most obviously
        // already has an account.
        query<{ id: string }>(`SELECT id FROM users WHERE id = ANY($1) AND totp_secret IS NOT NULL`, [
          userIds,
        ]),
      ])
    : [{ rows: [] as { user_id: string }[] }, { rows: [] as { id: string }[] }];

  const canSignIn = new Set<string>([
    ...passkeys.rows.map((r) => r.user_id),
    ...authenticators.rows.map((r) => r.id),
  ]);

  for (const r of rows.rows) {
    const state = readStandbyState(r.standby_state);
    if (state === 'revoked') {
      out.set(r.id, 'skip');
    } else if (state !== 'confirmed') {
      out.set(r.id, 'not_counted');
    } else if (r.claimed_user_id && canSignIn.has(r.claimed_user_id)) {
      out.set(r.id, 'sign_in');
    } else {
      out.set(r.id, 'code');
    }
  }

  return out;
}

/**
 * Classification, with the failure mode chosen deliberately.
 *
 * If the lookup fails we mint for everyone — the behaviour this change replaces.
 * Failing the other way would leave a confirmed verifier with no passkey unable
 * to answer at all, stalling a real release; failing this way costs one
 * unnecessary code in an email to somebody who could also have signed in. The
 * runtime quorum gate still refuses to count an unconfirmed answer, so a stray
 * code cannot open anything it should not.
 */
export async function classifyOrFailOpen(
  verifierIds: string[],
): Promise<Map<string, VerifierNoticeClass>> {
  try {
    return await classifyVerifiersForNotice(verifierIds);
  } catch (err) {
    process.stderr.write(`[notify] verifier classification failed, minting for all: ${String(err)}\n`);
    return new Map();
  }
}
