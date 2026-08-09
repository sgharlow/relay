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

export interface VerifierContext {
  caseId: string;
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
  }>(
    `SELECT id, owner_id, case_id, trigger_type, grace_ends_at,
            required_confirmations, received_confirmations
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

  // "Why now" — what the system already tried before asking a human.
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
