/**
 * A rehearsal, in calm, that somebody has to actually answer.
 *
 * THE THING NOTHING ELSE IN THIS PRODUCT DOES: MEASURE A PERSON, NOT A SEND.
 * Every other reachability signal Relay has is a claim about a machine.
 * `email.delivered` is what the provider says about its own queue, and both
 * Outlook messages in the 2026-08-14 test recorded exactly that while sitting in
 * a junk folder. Resend accepts a send to a suppressed address and answers 200
 * with a message id. `sendEmailBestEffort` returning true means a request was
 * accepted, nothing more. Every one of those can be green while the human at the
 * other end knows nothing.
 *
 * A drill closes that loop the only way it can be closed: a person reads
 * something, signs in, and presses a button. An acknowledgement is evidence
 * about a HUMAN. Its absence is the finding this product has never been able to
 * produce — "this person could not be reached" — arriving on a day when it can
 * still be fixed rather than during the emergency.
 *
 * WHY IT REQUIRES A SIGN-IN, AND WHY THAT IS NOT PEDANTRY. A bare link that
 * recorded "acknowledged" on being clicked would be forgeable by anyone holding
 * the URL, and would happily record an acknowledgement from a mail scanner that
 * prefetched it. That is a false green built to look like the cure for false
 * greens. So the drill is only offered to verifiers who can already sign in, and
 * the ones who cannot come back to the owner as a NAMED GAP instead — which is
 * a true finding rather than a message they cannot act on.
 *
 * ⚠️ IT CANNOT PROVE THE OPPOSITE. An unanswered drill means "we have no
 * evidence this person can be reached", never "this person is unreachable" —
 * people are on holiday. That is why the copy says `did not answer` rather than
 * `cannot be reached`, and why nothing in the release path consults this.
 *
 * NO NEW TABLE. Sends and acknowledgements are audit entries, which is what the
 * audit log is for: append-only, per-owner, and already visible to the owner in
 * their own trail. It also means the drill leaves the same kind of record as
 * everything else the product does on somebody's behalf.
 *
 * Feature: relay-standby
 * Requirements: J4-R13, J7-R5
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { sendEmailToAllBestEffort } from '../notify/email';
import { addressesFor } from '../notify/fanout';
import { getOwnerLabel } from '../people/owner-label';
import { classifyOrFailOpen } from '../notify/verifier-notice-class';
import type { DrillState } from './drill-claim';

export const FIRE_DRILL_SENT = 'fire_drill_sent';
export const FIRE_DRILL_ACKNOWLEDGED = 'fire_drill_acknowledged';

function appUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

export interface DrillPerson {
  id: string;
  name: string;
}

export interface FireDrillResult {
  sent: DrillPerson[];
  /** Named, not mailed: answering would require a credential they do not have. */
  cannotAnswer: DrillPerson[];
}

/**
 * Runs one drill across an owner's verifiers.
 *
 * Reuses `classifyOrFailOpen` rather than re-deriving who can act, so the drill
 * and the real release path cannot come to disagree about who is able — a second
 * copy of that rule is exactly how the two ends of a contract stop agreeing.
 *
 * ⚠️ Its fail-open default is `code`, which here means "cannot answer a drill".
 * That is the right direction for a rehearsal: a classification failure produces
 * no mail rather than a burst of it, and the owner sees an honest "we could not
 * tell" rather than a fabricated pass.
 */
export async function runFireDrill(ownerId: string): Promise<FireDrillResult> {
  const roster = await query<{
    id: string;
    name: string;
    email: string;
    email_secondary: string | null;
    standby_state: string | null;
  }>(
    `SELECT id, name, email, email_secondary, standby_state
       FROM verifiers WHERE owner_id = $1 ORDER BY name ASC`,
    [ownerId],
  );

  const classes = await classifyOrFailOpen(roster.rows.map((v) => v.id));
  const ownerLabel = await getOwnerLabel(ownerId);

  const result: FireDrillResult = { sent: [], cannotAnswer: [] };

  for (const v of roster.rows) {
    const cls = classes.get(v.id) ?? 'code';

    // Removed on purpose. A rehearsal is not a reason to contact somebody the
    // owner took out of their circle.
    if (cls === 'skip') continue;

    if (cls !== 'sign_in') {
      result.cannotAnswer.push({ id: v.id, name: v.name });
      continue;
    }

    const ok = await sendEmailToAllBestEffort(
      // Credential-free by construction, so it uses both addresses — and this is
      // the message that should try hardest, since finding out whether somebody
      // can be reached is its entire purpose.
      addressesFor({ primary: v.email, secondary: v.email_secondary, carriesCredential: false }),
      {
        subject: `Practice only: ${ownerLabel} is testing that you can be reached`,
        text:
          `Hi ${v.name},\n\n` +
          `THIS IS A PRACTICE RUN. Nothing has happened, nothing is wrong, and nothing is ` +
          `being asked of you beyond one button.\n\n` +
          `${ownerLabel} has named you as one of the people who would be asked whether an ` +
          `emergency is real. That only works if the message reaches you on the day — and email ` +
          `is unreliable enough that we would rather find out now than then.\n\n` +
          `Sign in the way you normally do and press "I got this":\n\n` +
          `    ${appUrl()}/standby\n\n` +
          `There is no code in this message and no link that signs you in. If you cannot sign ` +
          `in, that is exactly the problem this is looking for — tell ${ownerLabel}.\n`,
      },
    );

    /*
      RECORDED WHETHER OR NOT THE SEND WAS ACCEPTED, and that is deliberate. The
      point of the drill is that the send being accepted proves nothing; what
      makes the silence afterwards meaningful is that we asked. Skipping the
      record on a failed send would erase the strongest case — we tried, the
      provider refused, and nobody heard — from the owner's view.
    */
    await writeAuditEntry(ownerId, {
      actor: `owner:${ownerId}`,
      action: FIRE_DRILL_SENT,
      entity: 'verifier',
      entityId: v.id,
      detail: { accepted: ok },
    });

    result.sent.push({ id: v.id, name: v.name });
  }

  return result;
}

/** Records that a verifier answered a drill. Written from their own session. */
export async function acknowledgeFireDrill(params: {
  ownerId: string;
  verifierId: string;
}): Promise<void> {
  await writeAuditEntry(params.ownerId, {
    actor: `verifier:${params.verifierId}`,
    action: FIRE_DRILL_ACKNOWLEDGED,
    entity: 'verifier',
    entityId: params.verifierId,
    detail: {},
  });
}

/**
 * The verifier's side: "I got this", for every owner still waiting to hear it.
 *
 * One person may stand by for several families, and one press should answer all
 * of them — asking somebody to acknowledge the same thing three times is how a
 * rehearsal stops being run.
 *
 * ⚠️ IT REFUSES TO RECORD AN ANSWER TO A QUESTION NOBODY ASKED. Without the
 * pending check, merely opening the dashboard would put "answered the last
 * practice run" on an owner's screen — a green light generated by the product
 * rather than earned by a person, which is the failure this whole feature was
 * built to stop. Returns how many were actually recorded.
 */
export async function acknowledgePendingDrills(userId: string): Promise<number> {
  const pending = await pendingDrillsFor(userId);
  for (const p of pending) {
    await acknowledgeFireDrill({ ownerId: p.ownerId, verifierId: p.verifierId });
  }
  return pending.length;
}

/**
 * READ-ONLY: which drills is this person being waited on for?
 *
 * Split out from the write above so the standby dashboard can offer the button
 * only when there is something to press, without the act of LOOKING recording an
 * answer. A screen that acknowledged on render would manufacture exactly the
 * evidence this feature exists to earn honestly.
 */
export async function pendingDrillsFor(
  userId: string,
): Promise<{ ownerId: string; verifierId: string }[]> {
  const mine = await query<{ id: string; owner_id: string }>(
    `SELECT id, owner_id FROM verifiers
      WHERE claimed_user_id = $1 AND coalesce(standby_state, 'invited') <> 'revoked'`,
    [userId],
  );
  if (mine.rows.length === 0) return [];

  const out: { ownerId: string; verifierId: string }[] = [];
  for (const v of mine.rows) {
    const state = (await fireDrillStatus(v.owner_id)).get(v.id);
    if (!state?.sentAt) continue;

    const sent = new Date(state.sentAt).getTime();
    const acked = state.acknowledgedAt ? new Date(state.acknowledgedAt).getTime() : null;
    // Already answered THIS drill. A later one re-opens the question.
    if (acked !== null && !Number.isNaN(acked) && acked >= sent) continue;

    out.push({ ownerId: v.owner_id, verifierId: v.id });
  }
  return out;
}

/*
  The judgement and the grace window live in `drill-claim.ts` — a client
  component renders them, and importing them from HERE would drag `pg` into the
  browser bundle (it did: the build failed on `dns`, `fs`, `net`, `tls`).
  Re-exported so server callers still have one import to reach for.
*/
export { describeDrill, DRILL_GRACE_MS, type DrillState } from './drill-claim';

/**
 * The latest send and the latest acknowledgement per verifier.
 *
 * LATEST OF EACH, SEPARATELY, so an acknowledgement from a drill in May cannot
 * vouch for one run this morning. `describeDrill` compares the two timestamps
 * rather than merely checking that both exist, which is the difference between
 * "they answered" and "they answered something, once".
 */
export async function fireDrillStatus(ownerId: string): Promise<Map<string, DrillState>> {
  const rows = await query<{ entity_id: string; action: string; ts: string }>(
    `SELECT entity_id, action, ts::text
       FROM audit_log
      WHERE owner_id = $1 AND action = ANY($2)
      ORDER BY ts ASC`,
    [ownerId, [FIRE_DRILL_SENT, FIRE_DRILL_ACKNOWLEDGED]],
  );

  const out = new Map<string, DrillState>();
  for (const r of rows.rows) {
    if (!r.entity_id) continue;
    const cur = out.get(r.entity_id) ?? { sentAt: null, acknowledgedAt: null };
    if (r.action === FIRE_DRILL_SENT) cur.sentAt = r.ts;
    else cur.acknowledgedAt = r.ts;
    out.set(r.entity_id, cur);
  }
  return out;
}

