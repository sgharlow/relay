/**
 * Notification messages for the release lifecycle.
 *
 * Composes subject/body and dispatches via the email boundary. All sends are
 * best-effort so a mail failure never rolls back a committed state transition.
 *
 * Verifier confirmation requests carry a scoped verifier JWT in the link
 * (issued per (verifier, release_state)); verifiers never receive any secret
 * material (Req 6.8).
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.4, 6.2, 6.6
 */

import { sendEmailBestEffort } from './email';
import { issueVerifierToken } from '../auth/verifier-token';
import { issueRecipientToken } from '../auth/recipient-token';
import { query } from '../db/connection';

function appUrl(): string {
  return process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

/**
 * After a release is RELEASED, emails every scoped recipient a one-time access
 * link carrying their recipient JWT (`/access?token=…`), scoped to this
 * release_state + version (so re-arming invalidates the link). Best-effort —
 * a mail failure never affects the committed release. Returns the count sent.
 *
 * Requirements: 7.1, 15.2
 */
export async function notifyRecipientsOfRelease(params: {
  releaseStateId: string;
  ownerId: string;
  triggerType: string;
  version: string | number;
}): Promise<number> {
  const recipients = await query<{ id: string; name: string; email: string }>(
    `SELECT DISTINCT r.id, r.name, r.email
       FROM recipients r
       JOIN access_rules ar ON ar.recipient_id = r.id
      WHERE ar.owner_id = $1 AND ar.trigger_type = $2`,
    [params.ownerId, params.triggerType],
  );

  const results = await Promise.all(
    recipients.rows.map((r) => {
      const token = issueRecipientToken(r.id, params.releaseStateId, BigInt(params.version));
      const link = `${appUrl()}/access?token=${encodeURIComponent(token)}`;
      return sendEmailBestEffort({
        to: r.email,
        subject: 'Your Relay access is now available',
        text:
          `Hi ${r.name},\n\n` +
          `Access you were granted has been released. Open your secure access plan here:\n\n${link}\n\n` +
          `This link is personal to you and expires in 24 hours.\n`,
      });
    }),
  );
  return results.filter(Boolean).length;
}

export interface VerifierContact {
  id: string;
  name: string;
  email: string;
}

/**
 * Emails every verifier a confirmation request with a scoped token link
 * (Req 6.2). Returns the number of messages successfully sent.
 */
export async function notifyVerifiersForTrigger(
  verifiers: VerifierContact[],
  triggerType: string,
  releaseStateId: string,
): Promise<number> {
  const results = await Promise.all(
    verifiers.map((v) => {
      const token = issueVerifierToken(v.id, releaseStateId);
      const link = `${appUrl()}/confirm?token=${encodeURIComponent(token)}`;
      return sendEmailBestEffort({
        to: v.email,
        subject: `Action needed: confirm a ${triggerType} trigger`,
        text:
          `Hi ${v.name},\n\n` +
          `You've been asked to confirm a "${triggerType}" release trigger. ` +
          `If you recognise this request, confirm here:\n\n${link}\n\n` +
          `You will not be given access to any private data — you are only confirming the trigger.\n`,
      });
    }),
  );
  return results.filter(Boolean).length;
}

/** Notifies the owner that confirmations are met but the grace window is still open (Req 6.6). */
export async function notifyOwnerReleasePendingGrace(
  ownerEmail: string,
  triggerType: string,
): Promise<void> {
  await sendEmailBestEffort({
    to: ownerEmail,
    subject: `Your ${triggerType} release is pending the grace window`,
    text:
      `All required confirmations for your "${triggerType}" trigger have been received. ` +
      `Release will complete when the grace window elapses. ` +
      `If this is a false alarm, check in now to cancel.\n`,
  });
}

/** Looks up the owner's email by id and sends the grace-pending notice (Req 6.6). */
export async function notifyOwnerReleasePendingGraceById(
  ownerId: string,
  triggerType: string,
): Promise<void> {
  const r = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [ownerId]);
  const email = r.rows[0]?.email;
  if (email) await notifyOwnerReleasePendingGrace(email, triggerType);
}

/** Notifies the owner that a trigger entered PENDING (Req 4.4). */
export async function notifyOwnerTriggerPending(
  ownerEmail: string,
  triggerType: string,
): Promise<void> {
  await sendEmailBestEffort({
    to: ownerEmail,
    subject: `A ${triggerType} trigger was initiated on your account`,
    text:
      `A "${triggerType}" trigger has entered the pending state. ` +
      `If this wasn't expected, check in now to reset it:\n\n${appUrl()}/triggers\n`,
  });
}
