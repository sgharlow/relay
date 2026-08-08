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
import { issueVerifierCode, formatCode } from '../auth/verifier-code';
import { formatCaseId } from '../release/case-id';
import { issueRecipientToken } from '../auth/recipient-token';
import { query } from '../db/connection';
import { getOwnerLabel } from '../people/owner-label';

/**
 * The origin every emailed link is built on.
 *
 * FOUND IN A REAL INBOX 2026-08-08. This read NEXTAUTH_URL, which in production
 * still pointed at the pre-domain deployment, so every access link, verifier
 * confirmation, owner challenge and check-in nudge we have ever sent linked to
 * `relay-three-henna.vercel.app`.
 *
 * That is not cosmetic. The recipient email arrives during someone's emergency
 * and asks them to open a vault of a family member's credentials; a raw
 * vercel.app hostname with a JWT in the query string is indistinguishable from
 * a phishing attempt, and telling caregivers to click links like that is the
 * opposite of what this product sells. It is also brittle — the deployment URL
 * is not ours to keep, and if it stops resolving every outstanding access link
 * dies with it.
 *
 * NEXT_PUBLIC_SITE_URL is preferred and set in Vercel production; the same
 * variable drives metadataBase, so the canonical origin is stated once.
 * NEXTAUTH_URL stays in the chain so local dev keeps working without extra
 * setup, and is deliberately NOT repurposed — auth configuration is not
 * something to change as a side effect of fixing an email link.
 */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

/**
 * Indefinite article for a trigger type.
 *
 * Two of the five trigger types begin with a vowel, so the templates read
 * "A emergency trigger was initiated" and "confirm a emergency trigger" — in
 * the subject line of the message that reaches someone during an actual
 * emergency. Small, but this product is asking a stranger to trust it with a
 * parent's credentials, and mail that cannot manage "an" reads like a phishing
 * kit. Caught by transcribing a full family scenario 2026-08-08.
 */
function article(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
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
  ownerId?: string,
): Promise<number> {
  // The case ID is the PUBLIC referent — derived from the release id and meant
  // to be read aloud between four people during a crisis. It authenticates
  // nothing; the code below is the secret.
  const caseId = formatCaseId(releaseStateId);

  const results = await Promise.all(
    verifiers.map(async (v) => {
      // A typed code, not a token in the URL. The link is BARE: clicking it
      // grants nothing, so a forwarded email — much the likeliest leak, since
      // forwarding one to a family member is a perfectly reasonable thing to do
      // — no longer hands over the ability to confirm someone's release.
      //
      // It also lets us say, and mean, that Relay never sends a link that signs
      // you in. That claim is worth more than any single control: once it holds
      // absolutely, an email containing such a link is self-evidently not us.
      let code: string | null = null;
      if (ownerId) {
        try {
          code = formatCode(await issueVerifierCode({ verifierId: v.id, releaseStateId, ownerId }));
        } catch (err) {
          process.stderr.write(`[notify] verifier code issue failed: ${String(err)}\n`);
        }
      }

      // Falls back to the legacy token link when a code cannot be issued. A
      // verifier who cannot answer at all is a worse outcome than a link.
      const body = code
        ? `Hi ${v.name},\n\n` +
          `You've been asked to confirm ${article(triggerType)} "${triggerType}" release trigger.\n\n` +
          `Go to ${appUrl()}/verify and enter this code:\n\n` +
          `    ${code}\n\n` +
          `Case ${caseId} · the code expires in 72 hours.\n\n` +
          `You will not be given access to any private data — you are only confirming ` +
          `whether the situation is genuine.\n\n` +
          `Relay will never send you a link that signs you in. If a message claiming to ` +
          `be from us asks you to click one, it is not from us.\n`
        : `Hi ${v.name},\n\n` +
          `You've been asked to confirm ${article(triggerType)} "${triggerType}" release trigger. ` +
          `If you recognise this request, confirm here:\n\n` +
          `${appUrl()}/verify?token=${encodeURIComponent(issueVerifierToken(v.id, releaseStateId))}\n\n` +
          `You will not be given access to any private data — you are only confirming the trigger.\n`;

      return sendEmailBestEffort({
        to: v.email,
        subject: `Action needed: confirm ${article(triggerType)} ${triggerType} trigger (${caseId})`,
        text: body,
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
    subject: `${article(triggerType) === 'an' ? 'An' : 'A'} ${triggerType} trigger was initiated on your account`,
    text:
      `${article(triggerType) === 'an' ? 'An' : 'A'} "${triggerType}" trigger has entered the pending state. ` +
      `If this wasn't expected, check in now to reset it:\n\n${appUrl()}/triggers\n`,
  });
}

// ---------------------------------------------------------------------------
// Sprint 2-4 flows. These surfaces existed but nothing told anyone to visit
// them: an invitation returned a claim URL nobody emailed, an access request
// reached the owner only if they happened to open /challenge, and a verifier
// was never told a decision was waiting. A journey with no notification is a
// journey that never starts.
// ---------------------------------------------------------------------------

/** Invitation to claim a recipient or verifier role, BEFORE any trigger (J4-R9). */
export async function notifyInvitation(params: {
  to: string;
  name: string;
  personType: 'recipient' | 'verifier';
  claimUrl: string;
  ownerLabel: string;
}): Promise<boolean> {
  const isVerifier = params.personType === 'verifier';

  return sendEmailBestEffort({
    to: params.to,
    subject: isVerifier
      ? `${params.ownerLabel} asked you to be a trusted contact`
      : `${params.ownerLabel} set something up for you`,
    text:
      `Hi ${params.name},

` +
      (isVerifier
        ? `${params.ownerLabel} has named you as someone they trust to confirm an emergency is real.

` +
          `Nothing is happening right now. If a day comes when someone asks for access to their ` +
          `accounts, we may ask you one question: is this genuine?

` +
          `You will never see any of their information. Not now, and not then.

`
        : `${params.ownerLabel} has arranged for you to be able to reach some of their accounts ` +
          `if something ever happens to them.

` +
          `Nothing is open right now, and nothing will be until a trigger is verified. Setting ` +
          `this up today means you will not be locked out at the worst possible moment.

`) +
      `Accept here:

${params.claimUrl}

` +
      `This link works once and expires in 30 days.
`,
  });
}

/**
 * The owner challenge — the whole point of asking them BEFORE the verifiers
 * (J6-R2, J6-R3). Sent to every channel we hold.
 */
export async function notifyOwnerOfAccessRequest(params: {
  to: string;
  requesterName: string;
  triggerType: string;
  reason: string | null;
  caseId: string;
  expiresAt: string;
}): Promise<boolean> {
  return sendEmailBestEffort({
    to: params.to,
    subject: `${params.requesterName} is asking for access — is that right?`,
    text:
      `${params.requesterName} has asked for ${params.triggerType} access to your vault.

` +
      (params.reason ? `They said: "${params.reason}"

` : '') +
      `If you are fine, say so and nothing opens:
${appUrl()}/challenge

` +
      `If you do not answer by ${new Date(params.expiresAt).toUTCString()}, we will ask the ` +
      `people you nominated whether this is genuine.

` +
      `Reference ${params.caseId}
`,
  });
}

/** Honest status back to the requester, whatever the outcome (J6-R10). */
export async function notifyRequesterOfOutcome(params: {
  to: string;
  name: string;
  outcome: 'denied_by_owner' | 'approved_by_owner' | 'escalated';
  ownerLabel: string;
  caseId: string;
}): Promise<boolean> {
  const body = {
    denied_by_owner:
      `${params.ownerLabel} let us know they are fine, so nothing has been opened.

` +
      `If you are still worried, contact them directly.`,
    approved_by_owner:
      `${params.ownerLabel} approved your request. Access is opening now — check your email ` +
      `for the link, or sign in.`,
    escalated:
      `We have not heard back from ${params.ownerLabel}, so we are now asking the people they ` +
      `nominated to confirm this is genuine. We will let you know either way.`,
  }[params.outcome];

  return sendEmailBestEffort({
    to: params.to,
    subject: `About your access request (${params.caseId})`,
    text: `Hi ${params.name},

${body}

Reference ${params.caseId}
`,
  });
}

/**
 * Social transparency: everyone in the circle learns a request was made,
 * whatever the outcome. A covert access attempt becomes impossible, which is
 * the deterrent that matters most in a family context (J6-R9).
 */
export async function notifyCircleOfRequest(
  contacts: { email: string; name: string }[],
  params: { requesterName: string; ownerLabel: string; caseId: string },
): Promise<number> {
  const results = await Promise.all(
    contacts.map((c) =>
      sendEmailBestEffort({
        to: c.email,
        subject: `For your awareness: someone asked for access to ${params.ownerLabel}'s vault`,
        text:
          `Hi ${c.name},

` +
          `${params.requesterName} has requested access to ${params.ownerLabel}'s accounts. ` +
          `You are receiving this because you are part of their circle.

` +
          `No action is needed from you right now — we are asking ${params.ownerLabel} first. ` +
          `We are telling you simply so that nothing happens quietly.

` +
          `Reference ${params.caseId}
`,
      }),
    ),
  );
  return results.filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// The quiet moments (added 2026-08-08 after transcribing a full family arc).
//
// The arc produced exactly three messages, and ALL THREE fired during the
// crisis. A family that sets Relay up in calm conditions heard nothing until
// the worst day, when people who had never seen the product were suddenly
// asked to act. The gaps below were not broken code — they were messages
// nobody had written, which is why a ten-journey sweep and 880 tests missed
// them entirely.
// ---------------------------------------------------------------------------

/**
 * Tells a recipient their access has closed (J9-R4).
 *
 * The graceful-close PAGE was built first, and nothing drove anyone to it: a
 * recipient would discover the closure days later by clicking a dead link, if
 * ever. Someone who dropped everything to help during a family emergency
 * should not learn it ended by finding a broken page.
 *
 * The summary is inline so it needs no click and no credential. Deliberately
 * no link: any URL here would either be dead or require minting a token that
 * grants nothing, and a message that closes a loop should not open one.
 */
export async function notifyRecipientAccessClosed(params: {
  to: string;
  name: string;
  ownerLabel: string;
  itemsGranted: number;
  itemsOpened: number;
}): Promise<boolean> {
  const { name, ownerLabel, itemsGranted, itemsOpened } = params;

  const whatYouSaw =
    itemsOpened === 0
      ? `You did not need to open any of them, and that is recorded too.`
      : `You opened ${itemsOpened} of them. The ${itemsGranted - itemsOpened === 1 ? 'other one is' : `other ${itemsGranted - itemsOpened} are`} on the record as never opened.`;

  return sendEmailBestEffort({
    to: params.to,
    subject: `Access closed — ${ownerLabel} is back`,
    text:
      `Hi ${name},\n\n` +
      `${ownerLabel} has checked in, so the access you were given is now closed. ` +
      `Nothing is wrong — this is how it was meant to work. Access was temporary, ` +
      `and it has ended.\n\n` +
      `You were trusted with ${itemsGranted} ${itemsGranted === 1 ? 'item' : 'items'}. ` +
      `${whatYouSaw}\n\n` +
      `Thank you for stepping in. If they need help again, you will get a new link.\n`,
  });
}

/**
 * Confirms to the OWNER that someone now has setup rights on their vault
 * (J3-R2).
 *
 * Consent is recorded before a delegation activates, so this cannot be a
 * surprise — but consent given verbally at a kitchen table leaves the owner
 * nothing to find afterwards. An older owner whose adult child set this up
 * deserves a durable record in their own inbox, in their own words, including
 * how to end it. It is also the honest check on a delegation model: the person
 * whose vault it is gets told, every time.
 */
export async function notifyOwnerOfDelegation(params: {
  ownerEmail: string;
  delegateLabel: string;
  consentMethod: string;
}): Promise<boolean> {
  const how =
    params.consentMethod === 'in_person'
      ? 'in person'
      : params.consentMethod === 'paper_upload'
        ? 'on paper'
        : 'by link';

  return sendEmailBestEffort({
    to: params.ownerEmail,
    subject: `${params.delegateLabel} can now help set up your vault`,
    text:
      `You agreed ${how} that ${params.delegateLabel} can help set up your Relay vault.\n\n` +
      `They can add accounts and suggest people. They CANNOT see anything already ` +
      `stored, and they cannot release anything to anyone.\n\n` +
      `If this is not what you agreed to, you can end it at any time here:\n\n` +
      `${appUrl()}/circle\n\n` +
      `Keep this message — it is your record of what was agreed and when.\n`,
  });
}

/**
 * Tells every scoped recipient that a released trigger has closed.
 *
 * Counts what each of them actually opened, so the message is specific rather
 * than a form letter. Best-effort throughout: a mail failure must never affect
 * a committed re-arm, and closing access is the safety-critical half.
 *
 * Returns the number notified. A no-op when nothing was ever released.
 */
export async function notifyRecipientsOfClosure(params: {
  ownerId: string;
  triggerType: string;
}): Promise<number> {
  const ownerLabel = await getOwnerLabel(params.ownerId);

  const recipients = await query<{ id: string; name: string; email: string; granted: string }>(
    `SELECT r.id, r.name, r.email, count(*)::text AS granted
       FROM recipients r
       JOIN access_rules ar ON ar.recipient_id = r.id
      WHERE ar.owner_id = $1 AND ar.trigger_type = $2
      GROUP BY r.id, r.name, r.email`,
    [params.ownerId, params.triggerType],
  );

  const results = await Promise.all(
    recipients.rows.map(async (r) => {
      const opened = await query<{ n: string }>(
        `SELECT count(DISTINCT entity_id)::text AS n
           FROM audit_log
          WHERE owner_id = $1 AND actor = $2
            AND action = 'vault_item_decrypted'
            AND detail->>'outcome' = 'authorized'`,
        [params.ownerId, `recipient:${r.id}`],
      );
      return notifyRecipientAccessClosed({
        to: r.email,
        name: r.name,
        ownerLabel,
        itemsGranted: Number(r.granted),
        itemsOpened: Number(opened.rows[0]?.n ?? 0),
      });
    }),
  );
  return results.filter(Boolean).length;
}
