/**
 * Finding the releases nobody has answered, and saying so once.
 *
 * The impure half of `quiet-channel.ts` — that file holds the rule, this one
 * holds the queries. Runs from the heartbeat cron beside `escalateLapsedRequests`
 * for the reason that module already gives: you already carry one scheduler
 * ledger, and a second thing that can silently stop is worse than a slightly
 * busier sweep.
 *
 * WHAT IT IS FOR. `escalation.ts` handles the OWNER going quiet — the challenge
 * window lapses and the verifiers get asked. Nothing handled the verifiers going
 * quiet, which is the likelier failure now that it has been measured: their
 * notice is the message whose silent loss stalls a release, and a junked notice
 * is indistinguishable from a delivered one from inside this product.
 *
 * ⚠️ IT MOVES NO STATE. Nothing here transitions, confirms, or opens anything.
 * The only output is one email, to the owner, containing phone numbers the owner
 * can already see in their own circle.
 *
 * Feature: relay-standby
 * Requirements: J6-R7, J7-R5
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { notifyOwnerOfVerifierSilence } from '../notify/notifications';
import { formatCaseId } from './case-id';
import { readStandbyState } from '../people/standby-state';
import { callListLines, isVerifierSilence, type RingablePerson } from './quiet-channel';

/**
 * The audit action that records one silence notice — and, because it is written
 * before the next sweep looks, the thing that stops this mailing hourly.
 *
 * The same trick `reserveInviteEmail` uses: no new table, and the owner can see
 * in their own audit trail every message the product sent on their behalf.
 */
export const VERIFIER_SILENCE_ACTION = 'verifier_silence_notified';

interface WaitingRow {
  id: string;
  owner_id: string;
  trigger_type: string;
  state: string;
  initiated_at: string | null;
  received_confirmations: number;
  required_confirmations: number;
}

async function alreadyNotified(ownerId: string, releaseStateId: string): Promise<boolean> {
  const r = await query<{ n: string }>(
    `SELECT 1 AS n FROM audit_log
      WHERE owner_id = $1 AND action = $2 AND entity_id = $3 LIMIT 1`,
    [ownerId, VERIFIER_SILENCE_ACTION, releaseStateId],
  );
  return r.rows.length > 0;
}

/**
 * Sweeps every release that has been waiting on its verifiers too long.
 *
 * Returns the release ids actually notified about. One owner's failure must
 * never abort the sweep — these are independent families, and a conflict on one
 * is not a reason to leave the rest in silence.
 */
export async function sweepSilentVerifiers(now: Date = new Date()): Promise<string[]> {
  const waiting = await query<WaitingRow>(
    `SELECT id, owner_id, trigger_type, state, initiated_at::text,
            received_confirmations, required_confirmations
       FROM release_state
      WHERE state IN ('pending', 'grace')`,
  );

  const notified: string[] = [];

  for (const rs of waiting.rows) {
    try {
      if (!isVerifierSilence(rs, now)) continue;
      if (await alreadyNotified(rs.owner_id, rs.id)) continue;

      const [roster, answers, owner] = await Promise.all([
        query<{ id: string; name: string; phone: string | null; standby_state: string | null }>(
          `SELECT id, name, phone, standby_state FROM verifiers WHERE owner_id = $1`,
          [rs.owner_id],
        ),
        query<{ verifier_id: string }>(
          `SELECT verifier_id FROM verifier_confirmations WHERE release_state_id = $1`,
          [rs.id],
        ),
        query<{ email: string }>(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [rs.owner_id]),
      ]);

      const answered = new Set(answers.rows.map((a) => a.verifier_id));
      const people: RingablePerson[] = roster.rows.map((v) => ({
        id: v.id,
        name: v.name,
        phone: v.phone,
        answered: answered.has(v.id),
        revoked: readStandbyState(v.standby_state) === 'revoked',
      }));

      const lines = callListLines(people);
      // Nobody left to ring. Silence with no actionable name in it is not worth
      // an email during somebody's emergency.
      if (lines.length === 0) continue;

      const ownerEmail = owner.rows[0]?.email;
      if (!ownerEmail) continue;

      const started = new Date(rs.initiated_at ?? '').getTime();
      const hoursWaiting = Math.max(1, Math.floor((now.getTime() - started) / 3_600_000));

      await notifyOwnerOfVerifierSilence({
        ownerEmail,
        triggerType: rs.trigger_type,
        caseId: formatCaseId(rs.id),
        hoursWaiting,
        callList: lines,
      });

      /*
        Written AFTER the send, deliberately, and the opposite way round from
        `reserveInviteEmail`. That meter exists to bound a cost, so it must tick
        even if the send then fails. This marker exists to avoid repeating a
        message; if the send failed there is nothing to avoid repeating, and the
        next sweep should try again rather than record silence as handled.
      */
      await writeAuditEntry(rs.owner_id, {
        actor: 'system:verifier_silence',
        action: VERIFIER_SILENCE_ACTION,
        entity: 'release_state',
        entityId: rs.id,
        detail: { hoursWaiting, unanswered: lines.length },
      });

      notified.push(rs.id);
    } catch (err) {
      process.stderr.write(`[silence] sweep failed for release ${rs.id}: ${String(err)}\n`);
    }
  }

  return notified;
}
