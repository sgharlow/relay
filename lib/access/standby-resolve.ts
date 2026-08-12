/**
 * Standby resolution — "what am I on standby for, and is anything open?"
 *
 * THIS IS RUNG 0 (docs/standby-architecture.md §3.4). It is the surface a contact
 * can look at without being told anything, and it is the reason the architecture
 * stops depending on delivery: every channel above it is convenience, and any of
 * them may fail without the product failing.
 *
 * RULE 1, AND THE REASON THIS TAKES A userId RATHER THAN A TOKEN CLAIM (§3.7).
 * `standbyFor` may ride in the JWT as a RENDERING HINT and must never be an
 * authorization. Sessions are `strategy: 'jwt'` with no adapter, so the token is
 * a snapshot taken at sign-in; authorizing from it would delay REVOCATION by the
 * token lifetime, and revocation is the control that sits behind the coercion
 * risk. So every resolve reads the database, every time.
 *
 * WHAT EACH PRINCIPAL SEES (§3.1). A recipient gets the SHAPE of their grant —
 * counts and categories, never titles, never content (J4-R10). A verifier gets
 * pending decisions and never any vault shape at all: their job is to attest that
 * a situation is real, which requires knowing nothing about what is inside.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { query } from '../db/connection';
import { buildStandbyView, type StandbyView } from '../people/invitations';
import { escalateLapsedRequestsForOwners } from '../release/escalation';
import { ReleaseStateMachine } from '../release/state-machine';
import { readStandbyState, type StandbyState } from '../people/standby-state';

export type StandbyPersonType = 'recipient' | 'verifier';

export interface OpenRelease {
  releaseStateId: string;
  triggerType: string;
  state: string;
  caseId: string | null;
}

export interface StandbyRelationship {
  ownerId: string;
  /** What to call them on screen. The address the owner signed up with. */
  ownerLabel: string;
  personId: string;
  personType: StandbyPersonType;
  state: StandbyState;
  /** Recipients only. Counts and categories — never titles (J4-R10). */
  grant?: StandbyView;
  openRelease: OpenRelease | null;
}

export interface StandbyResolution {
  relationships: StandbyRelationship[];
  anythingOpen: boolean;
}

export async function resolveStandbyFor(params: {
  userId: string;
  now?: Date;
}): Promise<StandbyResolution> {
  const now = params.now ?? new Date();

  // One query across both roster tables. `revoked` is filtered in SQL rather
  // than in JS so a withdrawn person cannot be resurrected by a rendering bug.
  const found = await query<{
    person_id: string;
    person_type: StandbyPersonType;
    owner_id: string;
    owner_email: string;
    standby_state: string | null;
  }>(
    `SELECT r.id AS person_id, 'recipient' AS person_type, r.owner_id, u.email AS owner_email,
            r.standby_state
       FROM recipients r JOIN users u ON u.id = r.owner_id
      WHERE r.claimed_user_id = $1 AND coalesce(r.standby_state, 'invited') <> 'revoked'
      UNION ALL
     SELECT v.id AS person_id, 'verifier' AS person_type, v.owner_id, u.email AS owner_email,
            v.standby_state
       FROM verifiers v JOIN users u ON u.id = v.owner_id
      WHERE v.claimed_user_id = $1 AND coalesce(v.standby_state, 'invited') <> 'revoked'`,
    [params.userId],
  );

  if (found.rows.length === 0) return { relationships: [], anythingOpen: false };

  const ownerIds = [...new Set(found.rows.map((r) => r.owner_id))];

  // The derive-on-read half of §4.4. Somebody is looking, which is exactly the
  // condition that makes this viable — and the person looking is usually the
  // person waiting. Idempotent alongside the cron: first writer wins.
  await escalateLapsedRequestsForOwners(ownerIds, new ReleaseStateMachine(), now).catch(() => {
    // Rung 0 must render even if escalation cannot run. Showing someone their
    // standing is more important than advancing a state machine on this request;
    // the scheduled sweep will pick it up.
  });

  const open = await query<{
    owner_id: string;
    release_state_id: string;
    trigger_type: string;
    state: string;
    case_id: string | null;
  }>(
    `SELECT owner_id, id AS release_state_id, trigger_type, state, case_id
       FROM release_state
      WHERE owner_id = ANY($1) AND state IN ('pending', 'grace', 'released')`,
    [ownerIds],
  );

  const openByOwner = new Map<string, OpenRelease>();
  for (const r of open.rows) {
    openByOwner.set(r.owner_id, {
      releaseStateId: r.release_state_id,
      triggerType: r.trigger_type,
      state: r.state,
      caseId: r.case_id,
    });
  }

  const relationships: StandbyRelationship[] = [];
  for (const row of found.rows) {
    // Belt and braces. The SQL above already excludes `revoked`; this repeats it
    // in JS because revocation is the control behind the coercion risk, and a
    // future edit to that query must not be able to quietly resurrect a
    // withdrawn person by dropping one clause.
    if (readStandbyState(row.standby_state) === 'revoked') continue;

    const rel: StandbyRelationship = {
      ownerId: row.owner_id,
      ownerLabel: row.owner_email,
      personId: row.person_id,
      personType: row.person_type,
      state: readStandbyState(row.standby_state),
      openRelease: openByOwner.get(row.owner_id) ?? null,
    };

    // Only recipients. A verifier attests that a situation is real, which needs
    // no knowledge of what is inside — so we never even build the view.
    if (row.person_type === 'recipient') {
      rel.grant = await buildStandbyView(row.owner_id, row.person_id);
    }

    relationships.push(rel);
  }

  return {
    relationships,
    anythingOpen: relationships.some((r) => r.openRelease !== null),
  };
}
