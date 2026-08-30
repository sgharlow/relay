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
import { CHECKIN_REMINDER_ACTIONS } from './checkin-reminder';
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

/**
 * Timeline events addressed to the RELEASE row itself.
 *
 * Kept beside the reminder actions rather than inline in the SQL because
 * `VerifyClient` has to have a sentence for every one of them: an action with no
 * label renders as its own raw identifier on the highest-stakes screen in the
 * product. `lib/ops/verify-timeline-is-labelled.test.ts` holds the two files
 * together in both directions — a new action with no sentence, and a sentence
 * for an action this query can no longer return, which is how
 * `checkin_reminder_sent` sat in the label map for nine days after it was known
 * to be unwritable.
 */
export const RELEASE_TIMELINE_ACTIONS: readonly string[] = [
  'release_transition_pending',
  'access_requested',
];

/** Every action `buildVerifierContext` can put on the verifier's timeline. */
export const TIMELINE_ACTIONS: readonly string[] = [
  ...RELEASE_TIMELINE_ACTIONS,
  ...CHECKIN_REMINDER_ACTIONS,
];

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

    🔴 THIS QUERY COULD NOT RETURN A REMINDER, IN TWO SEPARATE WAYS, and until
    2026-08-30 the header below described only the first of them. It filtered on
    `checkin_reminder_sent`, an action nothing writes; and it keyed the whole
    read on `entity_id = <release state id>`, while `sweepCheckinReminders`
    writes its rows against the OWNER with no `entityId` at all — so `entity_id`
    is NULL on every reminder ever written. Correcting the action name alone
    would have left the row just as unreachable, and would have looked like a
    fix. That is B15.5, and it is why the register called it a two-line change
    and it is not.

    The consequence was not cosmetic. `VerifyClient` renders these as "We tried
    to reach them", and the difference between a verifier being told the owner
    was nudged twice and heard nothing back, and a verifier being told nothing,
    is most of what makes an attestation informed. J7-R3 asks for what the
    system already tried; the screen promised it and the query could not supply
    it.

    TWO KEYINGS IN ONE READ, because the two kinds of event are genuinely
    addressed differently and neither addressing is wrong:
      - release events belong to THIS release row (`entity_id`), so a second
        trigger type on the same owner does not bleed onto this timeline;
      - reminders belong to the OWNER — the ladder runs before any release
        exists, so there is no release row for it to point at.

    ⚠️ THE REMINDER HALF IS DELIBERATELY NOT WINDOWED, and the alternative was
    considered rather than overlooked. Bounding it to the current check-in window
    (`ts > users.last_active_at`, the bound `rungsSentThisWindow` uses) reads
    tighter, but `last_active_at` MOVES: an owner who signs in after the release
    has started would make the "we tried to reach them" rows vanish from a page
    a verifier had already read. A timeline that loses entries is worse than one
    that carries an old rung, and the release half above is unwindowed for the
    same reason. The ladder writes at most one row per rung per window, so this
    grows by two per elapsed cycle, not without bound.

    The action lists are IMPORTED, not restated. `CHECKIN_REMINDER_ACTIONS` is
    derived from the rungs themselves in `checkin-reminder.ts`, so a third rung
    appears here without an edit — and, more to the point, a renamed one cannot
    leave this file quietly filtering on a string nothing writes, which is the
    exact defect being closed.
  */
  const history = await query<{ action: string; ts: string }>(
    `SELECT a.action, a.ts
       FROM audit_log a
      WHERE a.owner_id = $1
        AND (
              (a.entity_id = $2 AND a.action = ANY($3))
              OR a.action = ANY($4)
            )
      ORDER BY a.seq ASC`,
    [row.owner_id, releaseStateId, [...RELEASE_TIMELINE_ACTIONS], [...CHECKIN_REMINDER_ACTIONS]],
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
