/**
 * Human names for audit actors — resolved at READ time, never stored.
 *
 * ⚠️ THE STORED ENTRY IS NOT TOUCHED, AND MUST NEVER BE. `entry_hash` covers the
 * canonical JSON of the entry including `actor`, so rewriting the column — or
 * even substituting the value before `verifyAuditChain` runs — would break the
 * chain and destroy the only property that makes the log worth having. This
 * returns a SEPARATE lookup the renderer applies on top; verification still runs
 * on exactly the bytes that were written.
 *
 * WHY IT IS NEEDED. `/audit` leads with the story — "Dr. Alex Chen confirmed it
 * was real" — and then shows a table whose ACTOR column reads
 * `recipient:fc3ee2d3-eb86-40d1-b099-37fde0270656`. The summary exists because
 * the table could not be read; leaving the table unreadable means the proof
 * beneath the story stays unreadable too, which is the half that makes the story
 * trustworthy rather than merely reassuring. Found by writing the user manual.
 *
 * A person the owner has since deleted resolves to nothing and the raw actor is
 * shown unchanged — the record outlives the roster row on purpose, and inventing
 * a name for somebody who is gone would be worse than showing an id.
 *
 * Feature: relay-h0-mvp
 * Requirements: 8.6
 */

import { query } from '../db/connection';
import { formatOwnerLabel } from '../people/owner-label';

/** `recipient:<uuid>` → `Jordan Rivera`. Absent keys mean "render as stored". */
export type ActorNames = Record<string, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Splits `type:id` and keeps only the shapes we can resolve. Anything else —
 * `system`, `cron`, `simulate`, an unrecognised prefix, an id that is not a UUID
 * — is deliberately dropped rather than guessed at.
 */
function parseActors(actors: string[]): {
  recipients: string[];
  verifiers: string[];
  owners: string[];
  delegations: string[];
} {
  const recipients: string[] = [];
  const verifiers: string[] = [];
  const owners: string[] = [];
  const delegations: string[] = [];

  for (const raw of new Set(actors)) {
    const idx = raw.indexOf(':');
    if (idx < 0) continue;
    const kind = raw.slice(0, idx);
    const id = raw.slice(idx + 1);
    if (!UUID.test(id)) continue;
    if (kind === 'recipient') recipients.push(id);
    else if (kind === 'verifier') verifiers.push(id);
    else if (kind === 'owner') owners.push(id);
    /**
     * 🔴 DELEGATES WERE MISSING, added 2026-08-12. The helper's workspace and
     * this resolver were built the same day and left unconnected, so the one
     * actor type an owner is most likely to be curious about — somebody else
     * working inside their vault — rendered as a raw `delegate:<uuid>` while
     * everybody else had a name.
     *
     * The id here is a DELEGATION id, not a user id, so it needs one more hop
     * than the others: delegation → delegate_user_id → user.
     */
    else if (kind === 'delegate') delegations.push(id);
  }

  return { recipients, verifiers, owners, delegations };
}

/**
 * Names for the actors in one owner's log.
 *
 * SCOPED TO THE OWNER in every query. The audit log is already owner-scoped, so
 * a foreign id cannot appear — but this data layer has no foreign keys, and a
 * lookup that would happily resolve somebody else's recipient is the kind of
 * thing that becomes a leak the moment a caller changes. Refuse by construction.
 */
export async function resolveActorNames(ownerId: string, actors: string[]): Promise<ActorNames> {
  const { recipients, verifiers, owners, delegations } = parseActors(actors);
  const names: ActorNames = {};

  const [r, v, o, d] = await Promise.all([
    recipients.length
      ? query<{ id: string; name: string }>(
          `SELECT id, name FROM recipients WHERE owner_id = $1 AND id = ANY($2)`,
          [ownerId, recipients],
        )
      : Promise.resolve({ rows: [] as { id: string; name: string }[] }),
    verifiers.length
      ? query<{ id: string; name: string }>(
          `SELECT id, name FROM verifiers WHERE owner_id = $1 AND id = ANY($2)`,
          [ownerId, verifiers],
        )
      : Promise.resolve({ rows: [] as { id: string; name: string }[] }),
    owners.length
      ? query<{ id: string; display_name: string | null; email: string | null }>(
          `SELECT id, display_name, email FROM users WHERE id = $1 AND id = ANY($2)`,
          [ownerId, owners],
        )
      : Promise.resolve({ rows: [] as { id: string; display_name: string | null; email: string | null }[] }),
    delegations.length
      ? query<{ id: string; display_name: string | null; email: string | null }>(
          `SELECT d.id, u.display_name, u.email
             FROM delegations d
             JOIN users u ON u.id = d.delegate_user_id
            WHERE d.owner_id = $1 AND d.id = ANY($2)`,
          [ownerId, delegations],
        )
      : Promise.resolve({ rows: [] as { id: string; display_name: string | null; email: string | null }[] }),
  ]);

  for (const row of r.rows) names[`recipient:${row.id}`] = row.name;
  for (const row of v.rows) names[`verifier:${row.id}`] = row.name;
  // The owner is "you" on their own audit screen. Naming them by their own
  // display name reads oddly next to "Dr. Alex Chen confirmed"; "You" is what
  // they would say out loud reading the row.
  for (const row of o.rows) names[`owner:${row.id}`] = `You (${formatOwnerLabel(row.display_name, row.email)})`;
  // Named AS a helper, because "Jordan Rivera" alone would read as Jordan acting
  // for themselves. What the owner needs to see is that somebody was working on
  // their behalf, and who.
  for (const row of d.rows) {
    names[`delegate:${row.id}`] = `${formatOwnerLabel(row.display_name, row.email)} (helping you)`;
  }

  return names;
}
