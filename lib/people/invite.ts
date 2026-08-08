/**
 * Naming someone tells them (J4-R9).
 *
 * WHY THIS EXISTS. Transcribing a full family scenario on 2026-08-08 produced
 * three messages across the entire arc, and all three fired during the crisis.
 * Adding a recipient or a verifier notified nobody: `notifyInvitation` was
 * wired only to a separate `/api/invitations` action the owner had to know
 * about and remember. So the first a trusted contact heard of any of it was
 * "Action needed" mid-emergency, from a domain they had never seen — the exact
 * moment they are most likely to dismiss it as phishing, and J7's whole premise
 * is that verifiers answer.
 *
 * The invitation body is written for precisely this moment: it says nothing is
 * happening, and that a verifier will never see the owner's information.
 * Sending it when the relationship is created is what it was for.
 *
 * Best-effort throughout. Being named is a durable fact recorded in the
 * database; the email is a courtesy on top of it, and a mail failure must never
 * prevent someone from being added to a circle of trust.
 *
 * Feature: relay-caregiver
 * Requirements: J4-R9
 */

import { createInvitation, formatInviteCode, type PersonType } from './invitations';
import { notifyInvitation } from '../notify/notifications';
import { query } from '../db/connection';
import { getOwnerLabel } from './owner-label';

/**
 * The origin claim links are built on.
 *
 * Mirrors `appUrl()` in the notification layer, and for the same reason: the
 * invitations route read `NEXTAUTH_URL ?? ''`, which in production still held
 * the pre-domain deployment — and when unset produced a RELATIVE url, so the
 * claim link in an email would have pointed nowhere at all.
 */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

export interface InviteResult {
  claimUrl: string;
  expiresAt: string;
  emailDelivered: boolean;
}

/**
 * Mints a claim token for a person and emails them the invitation.
 *
 * Throws only if the invitation itself cannot be created; delivery failure is
 * reported in `emailDelivered` so the caller can offer the URL another way.
 */
export async function inviteAndNotify(
  ownerId: string,
  personId: string,
  personType: PersonType,
): Promise<InviteResult> {
  const { token, expiresAt } = await createInvitation(ownerId, { personId, personType });
  // BARE link plus a typed code. The credential no longer travels in the URL,
  // so a forwarded invitation grants nothing, and Relay's claim that it never
  // sends a sign-in link now holds across every message it sends.
  const claimUrl = `${appUrl()}/claim`;
  const claimCode = formatInviteCode(token);

  const table = personType === 'recipient' ? 'recipients' : 'verifiers';
  const person = await query<{ name: string; email: string }>(
    `SELECT name, email FROM ${table} WHERE id = $1 AND owner_id = $2 LIMIT 1`,
    [personId, ownerId],
  );
  const emailDelivered = person.rows[0]
    ? await notifyInvitation({
        to: person.rows[0].email,
        name: person.rows[0].name,
        personType,
        claimUrl,
        claimCode,
        ownerLabel: await getOwnerLabel(ownerId),
      })
    : false;

  return { claimUrl, expiresAt, emailDelivered };
}

/**
 * Fire-and-forget invitation for the moment a person is created.
 *
 * Swallows everything. Adding someone to a circle of trust is a database fact
 * that must not fail because a mailbox is full, and the owner can always resend
 * from the invitations surface.
 */
export async function inviteOnCreateBestEffort(
  ownerId: string,
  personId: string,
  personType: PersonType,
): Promise<void> {
  try {
    await inviteAndNotify(ownerId, personId, personType);
  } catch (err) {
    process.stderr.write(`[people] invitation on create failed for ${personId}: ${String(err)}\n`);
  }
}
