/**
 * Everything a verifier needs to render a real decision — and nothing more.
 *
 * The recruitment blocker for verifiers is the belief that saying yes means
 * seeing someone's private life. It does not, and the page has to say so. This
 * builder therefore returns counts and categories only: the SQL never touches
 * `title` or any ciphertext column, so the guarantee holds at the query rather
 * than at the rendering (R6.8, J7-R3, J7-R11).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R3, J7-R11
 */

import { query } from '../db/connection';
import { TriggerError } from './triggers';
import { isReversibleTrigger } from './state-machine';
import { caseIdFor } from './case-id';
import { getOwnerLabel } from '../people/owner-label';

/**
 * `initiated_by` in a sentence a human can act on.
 *
 * The column is already structured — `owner:<id>`, `cron`, `owner_consent:<id>`,
 * `challenge_lapsed:<requestId>`, `simulate` — so J7-R3's *why now* needs no new
 * data, only reading what is already written. The distinction is not cosmetic:
 * "they started this themselves" and "nobody has heard from them" call for
 * different answers from the same verifier.
 *
 * An unrecognised value falls back to the vaguest true sentence rather than
 * echoing the raw string, which would leak an internal id onto a page reachable
 * with a mailed code.
 */
export function describeInitiation(initiatedBy: string | null): string {
  const kind = (initiatedBy ?? '').split(':')[0];
  switch (kind) {
    case 'owner':
      return 'They started this themselves, before becoming unreachable.';
    case 'owner_consent':
      return 'They were asked, and they agreed to it.';
    case 'cron':
      return 'Nobody has heard from them for longer than they said to wait.';
    case 'challenge_lapsed':
      return 'Someone asked for access, they were given the chance to answer, and they did not.';
    case 'simulate':
      return 'This is a demonstration, not a real emergency.';
    default:
      return 'A release was started on their account.';
  }
}

export interface VerifierContext {
  caseId: string;
  /**
   * WHOSE VAULT THIS IS. J7-R3 puts "who is asking" first in the list of things
   * the decision page SHALL state, and until 2026-08-12 the page said "Someone
   * has asked for … access to a vault you agreed to help protect" — this row
   * loaded `owner_id` and never resolved it.
   *
   * A verifier who cannot be told whose emergency they are attesting to cannot
   * answer responsibly, and the request is indistinguishable from a phishing
   * attempt. It is also unanswerable in the multi-hat case §3.7 designs for:
   * somebody standing by for two people has no way to tell which one this is.
   *
   * NOT A LEAK. Anyone who reaches this page already holds the power to CONFIRM
   * the release — strictly greater than knowing whose it is — and the standby
   * dashboard already names the owner to the same person.
   */
  ownerLabel: string;
  /**
   * Why this is being asked NOW, derived from `release_state.initiated_by`
   * rather than from new data. The other half of J7-R3's requirement, and the
   * difference between "they asked for this themselves" and "nobody has heard
   * from them" changes what a reasonable answer is.
   */
  whyNow: string;
  triggerType: string;
  /** How many items the requester would reach — not which. */
  itemCount: number;
  categories: string[];
  requiredConfirmations: number;
  receivedConfirmations: number;
  graceEndsAt: string | null;
  /** False for estate: the verifier must know this one cannot be undone. */
  reversible: boolean;
  escalationHistory: { action: string; ts: string }[];
}

export async function buildVerifierContext(
  releaseStateId: string,
  _verifierId: string,
): Promise<VerifierContext> {
  const release = await query<{
    id: string;
    owner_id: string;
    case_id: string | null;
    trigger_type: string;
    grace_ends_at: string | null;
    required_confirmations: number;
    received_confirmations: number;
    initiated_by: string | null;
  }>(
    `SELECT id, owner_id, case_id, trigger_type, grace_ends_at,
            required_confirmations, received_confirmations, initiated_by
       FROM release_state
      WHERE id = $1
      LIMIT 1`,
    [releaseStateId],
  );

  const row = release.rows[0];
  if (!row) {
    // Typed, so the route can tell "this release is gone" apart from "the
    // database is down" and answer each honestly. A bare Error forced the
    // caller to choose between swallowing both — hiding an outage behind a
    // friendly message — or neither, which is the 500 a verifier hit in
    // production on 2026-08-08. The id stays out of the message: it is echoed
    // back to whoever holds the link.
    throw new TriggerError('Release state not found', 404);
  }

  // Counts and categories only. Deliberately no title, no ciphertext column.
  const grants = await query<{ category: string | null; n: string }>(
    `SELECT vi.category AS category, COUNT(*)::text AS n
       FROM access_rules ar
       JOIN vault_items vi ON vi.id = ar.vault_item_id
      WHERE ar.owner_id = $1
        AND ar.trigger_type = $2
      GROUP BY vi.category`,
    [row.owner_id, row.trigger_type],
  );

  let itemCount = 0;
  const categories: string[] = [];
  for (const g of grants.rows) {
    itemCount += Number(g.n);
    const cat = g.category ?? 'other';
    if (!categories.includes(cat)) categories.push(cat);
  }

  /*
    "Why now" — what the system already tried before asking a human.

    ⚠️ `checkin_reminder_sent` IS NEVER WRITTEN. Noted 2026-08-21: grep finds no
    producer anywhere outside this file's own test fixture, because the J5-R4
    escalation ladder (reminders before ARMED → PENDING) is OPEN, not built. The
    row is kept in the filter so a ladder, if one is ever ruled in, appears on
    this timeline without a second edit — but nothing here should be read as
    evidence that an owner was nudged first. `VerifyClient.tsx` renders this
    action as "We tried to reach them", which is a sentence the product cannot
    currently earn; it is unreachable today only because the query returns
    nothing.
  */
  const history = await query<{ action: string; ts: string }>(
    `SELECT action, ts
       FROM audit_log
      WHERE entity_id = $1
        AND action IN ('checkin_reminder_sent', 'release_transition_pending', 'access_requested')
      ORDER BY seq ASC`,
    [releaseStateId],
  );

  return {
    caseId: caseIdFor(row),
    // Resolved through the shared helper rather than joined into the SELECT
    // above. One extra query on a page that already makes three is nothing; two
    // definitions of how an owner is named is the drift that put an email
    // address on the standby dashboard while every message said "Margaret".
    ownerLabel: await getOwnerLabel(row.owner_id),
    whyNow: describeInitiation(row.initiated_by),
    triggerType: row.trigger_type,
    itemCount,
    categories,
    requiredConfirmations: row.required_confirmations,
    receivedConfirmations: row.received_confirmations,
    graceEndsAt: row.grace_ends_at,
    reversible: isReversibleTrigger(row.trigger_type),
    escalationHistory: history.rows.map((h) => ({ action: h.action, ts: h.ts })),
  };
}
