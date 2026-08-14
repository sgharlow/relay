/**
 * Withdrawing a removed verifier's attestations from the tallies.
 *
 * 🔴 A REMOVED VERIFIER'S VOTE STILL COUNTED TOWARD OPENING THE VAULT.
 * `deleteVerifier` cascade-deleted the `verifier_confirmations` rows and stopped
 * there — but the quorum is not counted from those rows at read time. It is a
 * COUNTER on release_state (`received_confirmations`), incremented once when the
 * attestation arrives. Deleting the row left the counter untouched, so an owner
 * who removed somebody mid-release — which is exactly what an owner does when
 * they stop trusting that person — left their vote behind, still counting toward
 * the threshold that opens their vault to everyone.
 *
 * Worse in the direction that matters: with a quorum of 2 and one confirmation
 * already in, removing that verifier leaves the tally at 1. The next single
 * attestation from anybody reaches quorum, carrying a vote from a person the
 * owner explicitly removed.
 *
 * ONLY PENDING AND GRACE ARE ADJUSTED. A released row is history: the release
 * already happened, the recipients were already told, and the hash-chained audit
 * log records the tally it happened at. Rewriting that counter afterwards would
 * make the log disagree with the row and change nothing about the world. An
 * armed row has no live tally to correct.
 *
 * WHY THE COUNTER IS NOT SIMPLY RECOMPUTED FROM THE ROWS. It could be — but the
 * increment path is CAS-guarded against a version, and a recompute racing an
 * in-flight confirmation would clobber it. Decrementing through the same
 * compare-and-swap keeps one writer discipline for one number.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.7, 6.3, 6.9
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { isSqlState40001 } from '../db/occ';

const MAX_RETRIES = 3;
const BASE_MS = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface LiveAttestation {
  release_state_id: string;
  decision: string | null;
  owner_id: string;
}

/**
 * Removes this verifier's attestations from every tally still in play.
 *
 * Best-effort per release: a row that cannot be adjusted within the retry budget
 * is left alone rather than throwing, because the caller is deleting a verifier
 * and failing that delete would leave the owner with a person they asked to
 * remove. The attestation ROW is deleted either way, so a later recount cannot
 * see it.
 *
 * Returns the number of release states adjusted, for the audit trail and tests.
 */
export async function withdrawVerifierAttestations(
  ownerId: string,
  verifierId: string,
): Promise<number> {
  // NULL decision reads as 'confirm': it is the backward-compatible reading for
  // rows written before the decision column existed (migration 011).
  const live = await query<LiveAttestation>(
    `SELECT vc.release_state_id, vc.decision, rs.owner_id
       FROM verifier_confirmations vc
       JOIN release_state rs ON rs.id = vc.release_state_id
      WHERE vc.verifier_id = $1
        AND rs.owner_id = $2
        AND rs.state IN ('pending', 'grace')`,
    [verifierId, ownerId],
  );

  let adjusted = 0;

  for (const row of live.rows) {
    const isDenial = row.decision === 'deny';
    // Abstentions were never counted, so there is nothing to take back.
    if (row.decision === 'abstain') continue;

    const column = isDenial ? 'received_denials' : 'received_confirmations';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const cur = await query<{ version: string }>(
          `SELECT version FROM release_state WHERE id = $1`,
          [row.release_state_id],
        );
        const version = cur.rows[0]?.version;
        if (version === undefined) break;

        // GREATEST floors at zero. The counter and the rows can already
        // disagree on data written before this function existed, and a negative
        // tally would be a worse bug than the one being fixed.
        const upd = await query(
          `UPDATE release_state
              SET ${column} = GREATEST(COALESCE(${column}, 0) - 1, 0),
                  version = version + 1
            WHERE id = $1 AND version = $2`,
          [row.release_state_id, String(version)],
        );

        if (upd.rowCount) {
          adjusted++;
          await writeAuditEntry(row.owner_id, {
            actor: `owner:${ownerId}`,
            action: 'verifier_attestation_withdrawn',
            entity: 'release_state',
            entityId: row.release_state_id,
            detail: { verifierId, decision: row.decision ?? 'confirm', reason: 'verifier_removed' },
          });
          break;
        }
        // CAS mismatch — another writer bumped the version. Re-read and retry.
      } catch (err) {
        if (!isSqlState40001(err)) throw err;
      }
      if (attempt < MAX_RETRIES - 1) await sleep(BASE_MS * 2 ** attempt);
    }
  }

  return adjusted;
}
