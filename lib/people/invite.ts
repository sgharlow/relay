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
  /**
   * The readable code, returned so the OWNER can deliver it themselves.
   *
   * Only a hash is persisted, so the caller's response is the one and only time
   * this exists in readable form — but it was previously computed here, put in
   * an email, and dropped. That left the owner dependent on the single channel
   * this architecture was reorganised around NOT trusting: delivery was measured
   * broken on 2026-08-11 (Outlook filing at SCL 5, Resend suppression returning
   * 200 on a muted recipient). Handing it back lets them read it down the phone,
   * which is both the reliable channel and the one that proves identity.
   */
  claimCode: string;
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
  /**
   * How the owner says they will actually deliver it. Defaults to `email` so
   * every existing caller behaves exactly as before.
   *
   * TWO REASONS THIS IS A PARAMETER, not an assumption. It is the split that
   * makes Phase 0 interpretable at all — without it, "nobody claimed" and "the
   * code never arrived" produce the same number, and those have opposite
   * consequences. And when an owner is going to read the code down the phone,
   * emailing it anyway puts a live credential into the channel measured broken
   * on 2026-08-11 for no benefit.
   */
  deliveryChannel: 'email' | 'owner' = 'email',
): Promise<InviteResult> {
  const { token, expiresAt } = await createInvitation(ownerId, {
    personId,
    personType,
    deliveryChannel,
  });
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
  // Not sent at all on the owner-delivered arm. Sending it "as a backup" would
  // put the code into both channels at once, which destroys the split — every
  // invitation would be in both arms and neither number would mean anything —
  // and it would do so by mailing a live credential the owner already intends
  // to speak aloud.
  const emailDelivered =
    deliveryChannel === 'email' && person.rows[0]
      ? await notifyInvitation({
          to: person.rows[0].email,
          name: person.rows[0].name,
          personType,
          claimUrl,
          claimCode,
          ownerLabel: await getOwnerLabel(ownerId),
        })
      : false;

  return { claimUrl, expiresAt, emailDelivered, claimCode };
}

/**
 * Which arm a newly-created person is invited through, during beta.
 *
 * 🔴 'owner' RATHER THAN 'email', ratified by Steve 2026-08-13. The email arm is
 * the product's front door and it rides a channel this project has MEASURED as
 * unreliable: Outlook SCL 5, and Resend suppression that returns 200 while the
 * recipient never sees anything. An invitation that silently does not arrive is
 * indistinguishable, from the owner's side, from one that was ignored.
 *
 * The owner arm sends nothing at all and hands the owner a code to read out.
 * That is worse for measurement and better for the thing being measured: with
 * founding families the owner is standing next to the person, and
 * docs/first-invitations.md already says the number that matters first is
 * "does anyone claim at all", not the channel split.
 *
 * ⚠️ THIS MAKES CREATING A PERSON SILENT. Nothing is sent, so the owner must
 * deliver the code themselves — the circle screen marks them "Has not accepted
 * yet — give them their code" and the readiness banner refuses to go green
 * until somebody is confirmed. Both were already there; this makes them
 * load-bearing rather than advisory.
 *
 * FLIP BACK TO 'email' when deliverability is proven, which is Phase B of the
 * 2026-08-13 plan. A test pins this to the guidance so it cannot drift silently.
 */
export const BETA_INVITE_CHANNEL: 'email' | 'owner' = 'owner';

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
    await inviteAndNotify(ownerId, personId, personType, BETA_INVITE_CHANNEL);
  } catch (err) {
    process.stderr.write(`[people] invitation on create failed for ${personId}: ${String(err)}\n`);
  }
}
