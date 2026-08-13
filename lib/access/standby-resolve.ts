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
import { formatOwnerLabel } from '../people/owner-label';
import { fingerprintFor } from '../people/fingerprint';

export type StandbyPersonType = 'recipient' | 'verifier';

export interface OpenRelease {
  releaseStateId: string;
  triggerType: string;
  state: string;
  caseId: string | null;
}

export interface StandbyRelationship {
  ownerId: string;
  /**
   * What to call them on screen.
   *
   * 🔴 THIS WAS `u.email`, FULL STOP, until 2026-08-12 — the query never even
   * selected `display_name`. So the one screen a standby contact returns to for
   * years said `someone@gmail.com` while every message Relay sent on the owner's
   * behalf said "Margaret", and the Account page's own copy states the cost
   * exactly: "the worst possible moment for it to say an email address they do
   * not recognise."
   *
   * Now routed through `formatOwnerLabel`, the same precedence every email uses.
   * One definition of how an owner is named, per the cross-boundary contract
   * rule — two was how this drifted in the first place.
   */
  ownerLabel: string;
  personId: string;
  personType: StandbyPersonType;
  state: StandbyState;
  /**
   * The four words the owner reads out on the verification call (§3.3).
   *
   * 🔴 THE CONTACT COULD NOT SEE THIS UNTIL 2026-08-12, while the owner's screen
   * told them "They see the same four words on their own screen." That sentence
   * was false: `fingerprintFor` was imported by `/api/circle` and nothing else,
   * so the owner was asked to make a COMPARISON the other side could not take
   * part in. A contact asked "do these match?" with nothing to match against
   * says yes — which is the rubber stamp this control exists to prevent, on the
   * one step the whole quorum model rests on, since `confirmed` is what makes an
   * answer count.
   *
   * Safe to show, by the argument `/api/circle` already makes: an attacker who
   * intercepted the ticket can see their own phrase too. What they cannot do is
   * be on the end of the owner's phone call.
   *
   * Derived through the same pure function, from the same three values, so the
   * two sides cannot drift.
   */
  fingerprint: string;
  /** Recipients only. Counts and categories — never titles (J4-R10). */
  grant?: StandbyView;
  openRelease: OpenRelease | null;
  /**
   * Verifiers only, and only while a release is open: is this person's answer
   * still outstanding? Undefined for recipients.
   *
   * The dashboard must not keep asking somebody who has already answered — see
   * the note in `verifier-session.ts`. Computed here rather than left to the
   * client so the card and `/api/verify` cannot disagree about whether a
   * decision is waiting.
   */
  awaitingDecision?: boolean;
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
    owner_display_name: string | null;
    standby_state: string | null;
  }>(
    `SELECT r.id AS person_id, 'recipient' AS person_type, r.owner_id, u.email AS owner_email,
            u.display_name AS owner_display_name, r.standby_state
       FROM recipients r JOIN users u ON u.id = r.owner_id
      WHERE r.claimed_user_id = $1 AND coalesce(r.standby_state, 'invited') <> 'revoked'
      UNION ALL
     SELECT v.id AS person_id, 'verifier' AS person_type, v.owner_id, u.email AS owner_email,
            u.display_name AS owner_display_name, v.standby_state
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

  // Which verifier rows have already answered, in one query rather than one per
  // person. Keyed by verifier+release because the same person may stand by for
  // several owners with separate open releases.
  const verifierIds = found.rows
    .filter((r) => r.person_type === 'verifier')
    .map((r) => r.person_id);
  const answered = new Set<string>();
  if (verifierIds.length > 0) {
    const decided = await query<{ verifier_id: string; release_state_id: string }>(
      `SELECT verifier_id, release_state_id FROM verifier_confirmations
        WHERE verifier_id = ANY($1)`,
      [verifierIds],
    );
    for (const d of decided.rows) answered.add(`${d.verifier_id}:${d.release_state_id}`);
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
      ownerLabel: formatOwnerLabel(row.owner_display_name, row.owner_email),
      fingerprint: fingerprintFor({
        ownerId: row.owner_id,
        personId: row.person_id,
        // The session user IS the bound identity — that is how this row was
        // found. Using it keeps both sides deriving from the same three values.
        claimedUserId: params.userId,
      }),
      personId: row.person_id,
      personType: row.person_type,
      state: readStandbyState(row.standby_state),
      openRelease: openByOwner.get(row.owner_id) ?? null,
    };

    // Only recipients. A verifier attests that a situation is real, which needs
    // no knowledge of what is inside — so we never even build the view.
    if (row.person_type === 'recipient') {
      rel.grant = await buildStandbyView(row.owner_id, row.person_id);
    } else if (rel.openRelease) {
      // `released` is not a question: the decision has already been made and
      // acted on, so nothing is outstanding regardless of who answered what.
      rel.awaitingDecision =
        rel.openRelease.state !== 'released' &&
        !answered.has(`${row.person_id}:${rel.openRelease.releaseStateId}`);
    }

    relationships.push(rel);
  }

  return {
    relationships,
    anythingOpen: relationships.some((r) => r.openRelease !== null),
  };
}
