/**
 * Notification messages for the release lifecycle.
 *
 * Composes subject/body and dispatches via the email boundary. All sends are
 * best-effort so a mail failure never rolls back a committed state transition.
 *
 * Verifiers never receive any secret material (Req 6.8), and since 2026-08-12
 * most of them receive no credential at all: a verifier who can sign in is told
 * to sign in, and a verifier whose answer would not count is told that instead
 * of being handed a code that buys nothing (`verifier-notice-class.ts`).
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.4, 6.2, 6.6
 */

import { sendEmailBestEffort, sendEmailToAllBestEffort } from './email';
import { addressesFor } from './fanout';
import { issueVerifierToken } from '../auth/verifier-token';
import { issueVerifierCode, formatCode } from '../auth/verifier-code';
import { issueRecipientCode } from '../auth/recipient-code';
import { formatCaseId } from '../release/case-id';
import { issueRecipientToken } from '../auth/recipient-token';
import { query } from '../db/connection';
import { getOwnerLabel } from '../people/owner-label';
import { classifyOrFailOpen, type VerifierNoticeClass } from './verifier-notice-class';
import { article, Article } from '../text/article';
import { isReversibleTrigger } from '../release/state-machine';
import { writeAuditEntry } from '../audit/audit-service';
import { reportServerError } from '../ops/error-reporter';

/**
 * The audit action recording that a release opened and nobody could be told.
 *
 * Exported so the test that proves it, and anyone reading the trail later, both
 * name the same string — a literal repeated in two places is a literal that
 * eventually disagrees with itself.
 */
export const RELEASE_NOTICE_UNDELIVERED_ACTION = 'release_notice_undelivered';

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
 * After a release is RELEASED, emails every scoped recipient a one-time access
 * link carrying their recipient JWT (`/access?token=…`), scoped to this
 * release_state + version (so re-arming invalidates the link). Best-effort —
 * a mail failure never affects the committed release. Returns the count sent.
 *
 * Requirements: 7.1, 15.2
 */
/*
  SkipCodeForClaimedRecipient is deliberately GONE. It signalled "no code" by
  throwing, the shared catch treated it like a real failure, and the fallback
  treated every failure as "send the legacy token link" — so the sentinel that
  meant "never send this person a credential" caused exactly that. The claimed
  case is now an ordinary branch, not an exception; see the note at the send
  site.
*/

export async function notifyRecipientsOfRelease(params: {
  releaseStateId: string;
  ownerId: string;
  triggerType: string;
  version: string | number;
}): Promise<number> {
  const recipients = await query<{
    id: string;
    name: string;
    email: string;
    email_secondary: string | null;
    claimed_user_id: string | null;
  }>(
    `SELECT DISTINCT r.id, r.name, r.email, r.email_secondary, r.claimed_user_id
       FROM recipients r
       JOIN access_rules ar ON ar.recipient_id = r.id
      WHERE ar.owner_id = $1 AND ar.trigger_type = $2`,
    [params.ownerId, params.triggerType],
  );

  const caseId = formatCaseId(params.releaseStateId);
  const ownerLabel = await getOwnerLabel(params.ownerId);

  const results = await Promise.all(
    recipients.rows.map(async (r) => {
      /*
        🔴 A CLAIMED RECIPIENT WAS EMAILED A LIVE SIGN-IN TOKEN, until
        2026-08-13 — the exact artifact this architecture exists never to send,
        delivered to the exact person it exists never to send it to.

        The intent was already written here: a claimed recipient signs into an
        account they already have, the release resolves server-side, and their
        message is purely a notification. The mechanism betrayed it. The skip
        was signalled by THROWING SkipCodeForClaimedRecipient, the shared catch
        below swallowed it exactly like a real code-issue failure, and the
        two-way fallback then treated "no code" as "send the legacy token
        link". So the sentinel that meant "this person must receive no
        credential" produced a clickable signed JWT in their inbox — while the
        code-branch email beside it promised "Relay will never send you a link
        that signs you in", and the product had trained that same person to
        treat such a link as phishing.

        Three cases, now told apart rather than collapsed into two:
          claimed             notification only — sign in as you normally do.
                              Mirrors the verifier sign_in notice: nothing in
                              the message is worth intercepting.
          unclaimed, code ok  the typed single-use code. Unchanged.
          unclaimed, FAILED   the legacy token link — the recorded, deliberate
                              last resort, because an unclaimed recipient has
                              no other way in and a locked-out recipient
                              mid-emergency is the worse outcome. This is the
                              one message that may carry a link, it goes only
                              to somebody with no account to sign into, and
                              lib/ops/gates.test.ts pins the claimed branch so
                              this ordering cannot silently regress.
      */
      let code: string | null = null;
      if (!r.claimed_user_id) {
        try {
          code = formatCode(
            await issueRecipientCode({
              recipientId: r.id,
              releaseStateId: params.releaseStateId,
              ownerId: params.ownerId,
              version: params.version,
            }),
          );
        } catch (err) {
          process.stderr.write(`[notify] recipient code issue failed: ${String(err)}\n`);
        }
      }

      const body = r.claimed_user_id
        ? `Hi ${r.name},\n\n` +
          `${ownerLabel} arranged for you to be able to reach some of their accounts, and that ` +
          `access is now open.\n\n` +
          `Sign in the way you normally do and it will be waiting for you:\n\n` +
          `    ${appUrl()}/standby\n\n` +
          `Case ${caseId}.\n\n` +
          `There is no code in this message, and no link that signs you in — deliberately. ` +
          `A real message from Relay never asks you to click a link and then enter anything. ` +
          `If a message claiming to be from us does, it is not from us.\n`
        : code
          ? `Hi ${r.name},\n\n` +
            `${ownerLabel} arranged for you to be able to reach some of their accounts, and that ` +
            `access is now open.\n\n` +
            `Go to ${appUrl()}/access and enter this code:\n\n` +
            `    ${code}\n\n` +
            `Case ${caseId} · the code expires in 24 hours and can be used once.\n\n` +
            /*
              🔴 THE OLD SENTENCE HERE WAS CONTRADICTED BY THE EMAIL CONTAINING IT.
              It read "A real message from Relay never asks you to click a link and
              then enter anything" — three lines under "Go to …/access and enter
              this code". Found by walking the product on 2026-08-14 and reading
              the mail as the recipient.

              That is worse than clumsy. It is the rule we give people for
              telling us from an impostor, and a recipient who learned it would
              correctly classify our genuine message as fake — while a phishing
              mail that simply omits the sentence looks cleaner than the real
              thing. The claimed-contact branch above states it truthfully
              because that message really does carry no code and no link.

              The honest version names the tell that actually distinguishes us:
              we never sign you in from a link and never ask for a password.
              Typing a one-time code on a page you navigated to yourself is a
              different act, and telling people to reach the page themselves is
              the safer habit anyway.
            */
            `Relay will never ask you for a password, and never sends a link that signs you in. ` +
            `If you would rather not use the address above, type relaystandby.com yourself and ` +
            `enter the code there.\n`
          : `Hi ${r.name},\n\n` +
            `Access you were granted has been released. Open your secure access plan here:\n\n` +
            `${appUrl()}/access?token=${encodeURIComponent(await issueRecipientToken(r.id, params.releaseStateId, BigInt(params.version)))}\n\n` +
            `This link is personal to you and expires in 24 hours.\n\n` +
            // The one message in the product that may carry a link, and it says the
            // truth about itself: even THIS link never asks for anything.
            `This link asks you for nothing after you follow it — no code and no password. ` +
            `A link that asks you to enter anything is not from us.\n`;

      /*
        ONLY THE CLAIMED BRANCH IS COPIED TO A SECOND ADDRESS. That message is a
        notification — "sign in the way you normally do" — with no code and no
        link that signs anyone in, which is exactly the property that makes a
        duplicate free. The other two branches carry a single-use code or a
        signed token in a URL; see `lib/notify/fanout.ts`.
      */
      return sendEmailToAllBestEffort(
        addressesFor({
          primary: r.email,
          secondary: r.email_secondary,
          carriesCredential: !r.claimed_user_id,
        }),
        {
          subject: `Your Relay access is now available (${caseId})`,
          text: body,
        },
      );
    }),
  );

  const reached = results.filter(Boolean).length;

  /*
    🔴 THE RELEASE OPENED AND NOBODY COULD BE TOLD, and until now that produced
    no record anywhere.

    Both release paths call this function and discard what it returns —
    `runHeartbeatSweep` with `.catch(() => undefined)` and the quorum path with
    `.catch(() => {})`. That is correct as far as it goes: a mail failure must
    never roll back a committed transition. But it meant the count was computed
    and thrown away, so the one case this product exists to prevent left no
    trace: `release_state` says `released`, the recipient never heard, the owner
    never heard, and `/circle` shows `unknown` — which its own module header is
    at pains to say means "we have not heard", never "fine".

    `sweepSilentVerifiers` does not cover this. It watches releases WAITING on
    confirmations; this is a release that already opened. Between them the
    before-state was watched and the after-state was not.

    THE CHECK LIVES HERE RATHER THAN AT THE TWO CALL SITES for the reason the
    rest of this codebase gives: a guard at the call site is a guard the next
    call site forgets, and there are already two. It is also the only place both
    numbers exist — the caller receives `reached` alone, and `0` on its own
    cannot tell "every send failed" from "nobody was scoped to this trigger".

    ⚠️ WHICH IS THE DISTINCTION THAT DECIDES WHETHER THIS IS NOISE. A release
    with no recipients configured returns 0 and is NOT a delivery failure — it is
    a configuration fact, and alarming on it would fire on every demo account
    with an unscoped trigger. Only `recipients existed AND none was reached` is
    reported, which is a state that should essentially never occur and therefore
    cannot flood the channel it uses.
  */
  if (recipients.rows.length > 0 && reached === 0) {
    await reportUndeliveredRelease({
      ownerId: params.ownerId,
      releaseStateId: params.releaseStateId,
      triggerType: params.triggerType,
      caseId,
      recipientCount: recipients.rows.length,
    });
  }

  return reached;
}

/**
 * Records — durably, and to a human — that a release opened with nobody reached.
 *
 * TWO CHANNELS, because either alone is a shape this repo has already been
 * caught by. The audit entry is the durable half: it survives the process, it
 * sits in the owner's own trail beside the release it belongs to, and it is
 * queryable later. The ops alert is the half that means somebody LEARNS —
 * "reporting is not monitoring", and in the emergency case the owner is by
 * hypothesis the person who cannot check their audit log.
 *
 * `reportServerError` is reused rather than a second alerting path built beside
 * it. It already refuses to throw, already dedups per signature per window, and
 * is already gated to production by `alertEnvironmentLabel` — and a second
 * definition of "how this project alerts" is exactly how two copies drift.
 *
 * ⚠️ IT CANNOT THROW. The release is COMMITTED before this runs. An exception
 * here would propagate into the release path, where the callers' `.catch()`
 * would swallow it — turning a recorded delivery failure into an unrecorded one
 * and achieving the opposite of the point.
 */
async function reportUndeliveredRelease(params: {
  ownerId: string;
  releaseStateId: string;
  triggerType: string;
  caseId: string;
  recipientCount: number;
}): Promise<void> {
  const { ownerId, releaseStateId, triggerType, caseId, recipientCount } = params;
  const summary =
    `Release ${caseId} opened but NONE of its ${recipientCount} recipient(s) could be ` +
    `notified. The access is open and the people it was opened for have not been told.`;

  try {
    await writeAuditEntry(ownerId, {
      action: RELEASE_NOTICE_UNDELIVERED_ACTION,
      actor: 'system',
      entity: 'release_state',
      entityId: releaseStateId,
      detail: { triggerType, caseId, recipientCount, reached: 0 },
    });
  } catch (err) {
    process.stderr.write(`[notify] could not record undelivered release ${caseId}: ${String(err)}\n`);
  }

  try {
    await reportServerError(new Error(summary), { path: '/release/notify' });
  } catch (err) {
    process.stderr.write(`[notify] could not alert on undelivered release ${caseId}: ${String(err)}\n`);
  }
}

export interface VerifierContact {
  id: string;
  name: string;
  email: string;
  /**
   * Optional second mailbox. Used ONLY for the notice classes that carry no
   * credential — see `lib/notify/fanout.ts`. Optional rather than required so a
   * caller that has not been taught to select the column degrades to today's
   * behaviour (one address) rather than to a type error.
   */
  email_secondary?: string | null;
}

/**
 * Roster row → notification contact, in ONE place.
 *
 * 🔴 THE BUG THIS PREVENTS ALREADY HAPPENED, in triplicate. Three call sites —
 * the heartbeat sweep, the challenge-lapse escalation and the manual initiate
 * route — each loaded the roster with `listVerifiers` and then rebuilt the
 * contact inline as `{ id: v.id, name: v.name, email: v.email }`. The moment a
 * second address existed it was selected from the database and discarded one
 * line before the send, on every path a release actually takes. Nothing would
 * have failed; the redundancy would simply never have fired.
 *
 * Accepts anything with the three required fields so it works for a roster row,
 * a raw query result, or a future shape, without any of them having to know
 * which fields the notifier wants.
 */
export function toVerifierContact(v: {
  id: string;
  name: string;
  email: string;
  email_secondary?: string | null;
}): VerifierContact {
  return { id: v.id, name: v.name, email: v.email, email_secondary: v.email_secondary ?? null };
}

/**
 * Emails every verifier a confirmation request (Req 6.2). Returns the number of
 * messages successfully sent — which since 2026-08-12 can be lower than the
 * number of verifiers passed in, because a revoked one is deliberately skipped.
 *
 * WHAT IS IN THE MESSAGE NOW DEPENDS ON THE PERSON, and only one of the four
 * cases carries a credential. See `verifier-notice-class.ts`.
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

  // WHO ACTUALLY NEEDS A CREDENTIAL. Resolved here rather than passed in, so
  // that every caller — the initiate route, the escalation sweep, the demo
  // script — gets the same answer without any of them having to know the rule.
  // See `verifier-notice-class.ts` for why the condition is `confirmed` and not
  // `claimed`, and why a break-glass code does not suppress the mail.
  const classes = await classifyOrFailOpen(verifiers.map((v) => v.id));

  // WHOSE EMERGENCY THIS IS. The recipient mail has always named the owner
  // ("${ownerLabel} arranged for you to be able to reach…"); the verifier mail
  // never did, in any branch, so the person being asked to vouch for somebody
  // was not told who. Same omission as the decision page (J7-R3) — found by
  // writing the user manual, and fixed in the same pass.
  const ownerLabel = ownerId ? await getOwnerLabel(ownerId) : 'Someone';

  const results = await Promise.all(
    verifiers.map((v) =>
      notifyOneVerifier(v, {
        noticeClass: classes.get(v.id) ?? 'code',
        triggerType,
        releaseStateId,
        ownerId,
        ownerLabel,
        caseId,
      }),
    ),
  );
  return results.filter(Boolean).length;
}

/**
 * ONE VERIFIER, ONE MESSAGE — the single definition of what a verifier receives.
 *
 * Extracted 2026-08-12 so `notifyVerifiersForTrigger` and `/api/verify/resend`
 * cannot drift. A resend that re-derived "who gets a code" would be a second copy
 * of the adaptive-minting rule, and a second copy of a security rule is how the
 * two ends of a contract stop agreeing — the exact failure the cross-boundary
 * contract rule exists to prevent.
 *
 * Returns whether a message was actually sent. `skip` returns false and sends
 * nothing, which is why the caller's count can be lower than the roster.
 */
export async function notifyOneVerifier(
  v: VerifierContact,
  ctx: {
    noticeClass: VerifierNoticeClass;
    triggerType: string;
    releaseStateId: string;
    ownerId?: string;
    ownerLabel: string;
    caseId: string;
  },
): Promise<boolean> {
  const { noticeClass, triggerType, releaseStateId, ownerId, ownerLabel, caseId } = ctx;

  // Revoked. The owner removed this person deliberately; telling them an
  // emergency is under way — which this path did until 2026-08-12, with a
  // working code attached — is a leak, not a courtesy.
  if (noticeClass === 'skip') return false;

  // A typed code, not a token in the URL. The link is BARE: clicking it
  // grants nothing, so a forwarded email — much the likeliest leak, since
  // forwarding one to a family member is a perfectly reasonable thing to do
  // — no longer hands over the ability to confirm someone's release.
  //
  // It also lets us say, and mean, that Relay never sends a link that signs
  // you in. That claim is worth more than any single control: once it holds
  // absolutely, an email containing such a link is self-evidently not us.
  let code: string | null = null;
  if (ownerId && noticeClass === 'code') {
    try {
      code = formatCode(await issueVerifierCode({ verifierId: v.id, releaseStateId, ownerId }));
    } catch (err) {
      process.stderr.write(`[notify] verifier code issue failed: ${String(err)}\n`);
    }
  }

  // Someone who can sign in gets told, and gets nothing to lose. This is
  // core principle 1 finally holding on the verifier side: there is no
  // secret in this message, so intercepting it accomplishes nothing.
  /*
    BOTH ADDRESSES, because there is nothing in this message to lose. A verifier
    who is junked here is the single failure that stalls a release — nobody
    answers, quorum is never met, and access never opens on the one day the
    product exists for — and this branch is precisely the one where redundancy
    costs nothing. See `lib/notify/fanout.ts` for why the `code` branch below
    does NOT get the same treatment.
  */
  if (noticeClass === 'sign_in') {
    return sendEmailToAllBestEffort(
      addressesFor({ primary: v.email, secondary: v.email_secondary, carriesCredential: false }),
      {
        subject: `Action needed: confirm ${article(triggerType)} ${triggerType} trigger (${caseId})`,
        text:
          `Hi ${v.name},\n\n` +
          `${ownerLabel} named you as one of the people who would be asked whether an emergency is real, ` +
          `and ${article(triggerType)} "${triggerType}" release has now been started on their ` +
          `account.\n\n` +
          `Sign in the way you normally do and the request will be waiting for you:\n\n` +
          `    ${appUrl()}/standby\n\n` +
          `Case ${caseId}.\n\n` +
          `There is no code in this message, and no link that signs you in — deliberately. ` +
          `A real message from Relay never asks you to click a link and then enter anything. ` +
          `If a message claiming to be from us does, it is not from us.\n\n` +
          `You will not be given access to any private data — you are only confirming ` +
          `whether the situation is genuine.\n`,
      },
    );
  }

  // Named, never verified. Since quorum tightened to `confirmed` (§4.3) an
  // answer from this person is recorded and counts towards nothing, so a
  // code would be a live credential bought for no outcome. They are still
  // told — they were named, the request is real, and being able to say "I
  // was never set up" to whoever is in the room is worth more than silence.
  if (noticeClass === 'not_counted') {
    const who = ownerLabel;
    // Also credential-free, so also both addresses. Being told you were named
    // is worth nothing to anyone who intercepts it.
    return sendEmailToAllBestEffort(
      addressesFor({ primary: v.email, secondary: v.email_secondary, carriesCredential: false }),
      {
        subject: `${who} named you — but you are not set up to answer (${caseId})`,
        text:
          `Hi ${v.name},\n\n` +
          `${who} named you as one of the people who would be asked whether an emergency is real. ` +
          `That question has just been raised.\n\n` +
          `You cannot answer it yet. Setting you up was never finished — ${who} still has to ` +
          `confirm it is really you — so an answer from you would not count towards anything, ` +
          `and we would rather say that than let you believe you had helped.\n\n` +
          `Nothing is expected of you right now. If you would like to be able to help next ` +
          `time, ask ${who}, or whoever is with them, to finish setting you up.\n\n` +
          `Case ${caseId}.\n`,
      },
    );
  }

  // Falls back to the legacy token link when a code cannot be issued. A
  // verifier who cannot answer at all is a worse outcome than a link.
  const body = code
    ? `Hi ${v.name},\n\n` +
      `${ownerLabel} named you as one of the people who would be asked whether an emergency is real, ` +
      `and ${article(triggerType)} "${triggerType}" release has now been started on their ` +
      `account.\n\n` +
      `Go to ${appUrl()}/verify and enter this code:\n\n` +
      `    ${code}\n\n` +
      `Case ${caseId} · the code expires in 72 hours.\n\n` +
      `You will not be given access to any private data — you are only confirming ` +
      `whether the situation is genuine.\n\n` +
      // Same correction as the recipient code branch above: this message DOES
      // ask you to go to a page and type something, so it cannot also claim we
      // never do that. See the note there.
      `Relay will never ask you for a password, and never sends a link that signs you in. ` +
      `If you would rather not use the address above, type relaystandby.com yourself and ` +
      `enter the code there.\n`
    : `Hi ${v.name},\n\n` +
      `${ownerLabel} named you as one of the people who would be asked whether an emergency is real, ` +
      `and ${article(triggerType)} "${triggerType}" release has now been started on their ` +
      `account. If you recognise this request, confirm here:\n\n` +
      `${appUrl()}/verify?token=${encodeURIComponent(await issueVerifierToken(v.id, releaseStateId))}\n\n` +
      `You will not be given access to any private data — you are only confirming the trigger.\n\n` +
      `This link asks you for nothing after you follow it — no code and no password. ` +
      `A link that asks you to enter anything is not from us.\n`;

  return sendEmailBestEffort({
    to: v.email,
    subject: `Action needed: confirm ${article(triggerType)} ${triggerType} trigger (${caseId})`,
    text: body,
  });
}

/**
 * Notifies the owner that confirmations are met (Req 6.6).
 *
 * 🔴 THIS PROMISED A DELAY THAT DOES NOT EXIST, corrected 2026-08-12. It said
 * "Release will complete when the grace window elapses. If this is a false
 * alarm, check in now to cancel" — and `GRACE_WINDOW_MS` is **0**, deliberately,
 * with an invariant test guarding it. So "when the grace window elapses" means
 * "at the next sweep", and "check in now to cancel" invited the owner into a
 * race they would lose. Found by walking a real release on production.
 *
 * What is actually true is stronger, and it is the reversibility story rather
 * than a countdown: access opens as soon as enough people agree, and checking in
 * CLOSES IT AGAIN — `processCheckin` reverses pending, grace and released alike.
 * The owner is not protected by a delay; they are protected by being able to
 * undo it the moment they surface.
 *
 * ⏸️ Whether the window should be non-zero is a PRODUCT decision that the
 * constant's own comment defers — "how long should an owner get to stop a false
 * alarm?" Rewording this does not settle it, and must not imply it has been.
 */
export async function notifyOwnerReleasePendingGrace(
  ownerEmail: string,
  triggerType: string,
): Promise<void> {
  await sendEmailBestEffort({
    to: ownerEmail,
    subject: isReversibleTrigger(triggerType)
      ? `Your ${triggerType} release has been confirmed`
      : `Your ${triggerType} handover starts in three days — read this if you are well`,
    text: isReversibleTrigger(triggerType)
      ? `Everyone you asked has now confirmed your "${triggerType}" trigger, so the access you ` +
        `arranged is opening.\n\n` +
        `If this is a false alarm, check in and it closes again — everything reversible you set ` +
        `up shuts immediately, and you do not have to undo anything by hand.\n`
      : /**
         * ⚠️ TRIGGER-AWARE SINCE THE 2026-08-12 GRACE RULING. The reversible
         * wording above would be false twice over for an estate handover: it
         * does NOT open at once — it waits three days — and checking in will
         * never close it, because `processCheckin` blocks estate. Telling an
         * owner to check in would reintroduce, from the other direction, the
         * same false promise this message was rewritten to remove.
         */
        `Everyone you asked has now confirmed your "${triggerType}" trigger.\n\n` +
        `Nothing has moved yet. Because ${article(triggerType)} ${triggerType} handover is ` +
        `PERMANENT, Relay waits three days before it completes — and those three days are the ` +
        `only chance anyone has to stop it. Checking in will not reverse this one, and neither ` +
        `can we.\n\n` +
        `If you are reading this and you are well, go to ${appUrl()}/triggers and stand it down ` +
        `now.\n`,
  });
}

/**
 * NOBODY HAS ANSWERED — the message that stops depending on email.
 *
 * Every other notice in this file asks somebody to go to a screen. This one
 * exists precisely because the screen and the inbox may both be silent: the
 * release opened, the verifier notices went out, the provider said `delivered`,
 * and the window is running down with no human aware of it. That is not a bug
 * in the state machine — the state machine is correct — it is the measured
 * behaviour of a channel this project cannot fix from inside this repo.
 *
 * So it hands the reader the one channel Relay does not own: the phone numbers
 * already sitting in their own circle, which the product has held since the
 * first sprint and never once used.
 *
 * ⚠️ IT CHANGES NOTHING. No transition, no quorum, no access. A lapse is the
 * absence of a signal and `escalation.ts` is explicit that absence must never be
 * read as consent. All this does is stop the silence being invisible.
 *
 * ⏸️ SENT TO THE OWNER ONLY, for now, and that is a real limitation rather than
 * an oversight: in the emergency case the owner is by hypothesis the person who
 * cannot answer. Widening it to the requester or the rest of the circle means
 * disclosing verifiers' phone numbers to people who cannot see them today — a
 * product and privacy decision, not a refactor.
 */
export async function notifyOwnerOfVerifierSilence(params: {
  ownerEmail: string;
  triggerType: string;
  caseId: string;
  hoursWaiting: number;
  callList: string[];
}): Promise<boolean> {
  const { triggerType, caseId, hoursWaiting, callList } = params;
  const hours = hoursWaiting === 1 ? 'an hour' : `${hoursWaiting} hours`;

  return sendEmailBestEffort({
    to: params.ownerEmail,
    subject: `Nobody has confirmed your ${triggerType} release yet (${caseId})`,
    text:
      `A "${triggerType}" release has been waiting ${hours} and none of the people you named ` +
      `has answered.\n\n` +
      `That may mean nothing is wrong. It may also mean they never saw the message — our email ` +
      `is filed as junk by some providers even when everything about it is correct, and we ` +
      `cannot see which folder anything landed in.\n\n` +
      `The fastest thing you can do is ring them:\n\n` +
      callList.map((l) => `    ${l}`).join('\n') +
      `\n\nThey do not need anything from this message. Ask them to sign in to Relay the way ` +
      `they normally do, and the request will be waiting for them.\n\n` +
      `Nothing has opened, and nothing opens until enough of them agree.\n\n` +
      `Case ${caseId}.\n`,
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
    subject: `${Article(triggerType)} ${triggerType} trigger was initiated on your account`,
    text:
      `${Article(triggerType)} "${triggerType}" trigger has entered the pending state. ` +
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
  claimCode?: string;
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
      (params.claimCode
        ? `Go to ${params.claimUrl} and enter this code:

    ${params.claimCode}

` +
          `It works once and expires in 30 days.

` +
          `A real message from Relay never asks you to click a link and then enter anything. If a ` +
          `message claiming to be from us does, it is not from us.
`
        : `Accept here:

${params.claimUrl}

` +
          `This link works once and expires in 30 days.
`),
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
      (params.reason
        ? `They said: "${params.reason}"

` +
          `(That is their wording, not ours. We remove any links other people write, because a ` +
          `message from Relay never asks you to click one.)

`
        : '') +
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

/**
 * Somebody used a break-glass code (§3.6).
 *
 * This message is the reason a break-glass code is permitted to exist. §8.1 is
 * blunt that until it is redeemed it is "functionally indistinguishable from the
 * standing printed credential this architecture exists to eliminate" — what
 * bounds it is that using it is *loud*: single-use, audited, and this.
 *
 * So it is written to be acted on by someone who may be reading it in a hurry:
 * it says who, it says the light has gone amber and why, and it gives the one
 * response that matters if this was not them. No reassuring preamble.
 *
 * Deliberately says nothing about what the person can now reach. If the code was
 * used by the wrong hands, this email is going to the right ones — and it must
 * not become a map.
 */
export async function notifyOwnerOfBreakGlass(params: {
  to: string;
  personName: string;
  personType: 'recipient' | 'verifier';
}): Promise<boolean> {
  return sendEmailBestEffort({
    to: params.to,
    subject: `${params.personName} used their emergency code`,
    text:
      `${params.personName}, who you named as a ${params.personType}, has just used the emergency ` +
      `code you gave them to get back into Relay.

` +
      `That code is now used up and cannot be used again.

` +
      `We have set them back to "not yet verified", so your circle shows them amber until you ` +
      `confirm it really was them. That check is worth doing — a code can be found, and this is ` +
      `the moment to be sure.

` +
      `If this was NOT them, remove them now and everything they hold closes:
` +
      `${appUrl()}/circle
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
    /*
      🔴 THIS SENTENCE WAS WRONG ON TIMING AND ON MECHANISM, AND IT TRAINED THE
      EXACT BEHAVIOUR THE PRODUCT WARNS AGAINST. It read: "Access is opening now
      — check your email for the link, or sign in."

      TIMING: approval does not open anything. respondToChallenge takes the
      release to GRACE, and only resolveElapsedGrace — which runs on the hourly
      heartbeat — moves GRACE to RELEASED. Even for a reversible trigger, whose
      grace window is zero, "now" means "at the next sweep", up to an hour away.
      Someone refreshing a page during an emergency because we told them it was
      already open is a cruel way to be inaccurate.

      MECHANISM: "check your email for the link" is not how this works and is not
      what we want anyone doing. Under the standby architecture a claimed contact
      SIGNS IN AS THEMSELVES and no link is emailed at release time; only an
      unclaimed contact gets a code, and they already have it. Meanwhile
      /security tells people in as many words that we will never email them a
      link asking for credentials — so this message taught the habit the rest of
      the product spends its time discouraging, in the one message a person reads
      while frightened and least likely to be careful.

      NOT FIXED BY FORCING A RELEASE HERE. resolveElapsedGrace is a global sweep
      with no owner filter: calling it from this route would transition other
      owners' releases and send their mail inside one requester's HTTP request.
      The honest sentence is cheaper and carries no such risk.
    */
    approved_by_owner:
      `${params.ownerLabel} agreed to your request. Access is not open yet — there is a short ` +
      `wait built in so a decision made in a hurry can still be undone. You will get a message ` +
      `the moment it opens.\n\n` +
      `When it does, sign in to Relay the way you normally would. We will never email you a ` +
      `link or a code that asks for your password.`,
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

  /*
    🔴 THE UNOPENED CLAUSE WAS UNGUARDED AT ZERO, AND COULD GO NEGATIVE.
    A recipient who opened everything they were given — the diligent case —
    was told "You opened 3 of them. The other 0 are on the record as never
    opened." And the two numbers do not describe the same set: itemsGranted is
    counted from access_rules as they stand NOW, while itemsOpened comes from
    the append-only audit log across all of this recipient's history. Delete an
    item after a release, or run a second narrower one, and the subtraction
    yields "The other -1 are on the record as never opened."

    The web version of this same summary has always guarded it
    (AccessClient.tsx: `grantedCount > opened.length ? … : null`), so the two
    surfaces disagreed — and email is the one that arrives unbidden, at the end
    of somebody's worst week.

    Math.max floors the count, and the clause is dropped entirely when there is
    nothing unopened to report. A sentence about zero items is not information.
  */
  const unopened = Math.max(0, itemsGranted - itemsOpened);

  const whatYouSaw =
    itemsOpened === 0
      ? `You did not need to open any of them, and that is recorded too.`
      : unopened === 0
        ? `You opened ${itemsOpened === 1 ? 'it' : 'all of them'}.`
        : `You opened ${itemsOpened} of them. The ${unopened === 1 ? 'other one is' : `other ${unopened} are`} on the record as never opened.`;

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
 * Tells the owner that somebody has left their circle.
 *
 * 🔴 THIS DID NOT EXIST until 2026-08-13, and the user manual claimed it did:
 * "Step down from this removes them, tells you, and recalculates your plan."
 * The removal and the recalculation were real; the telling was not. The owner
 * found out only by opening the app and noticing a roster row had gone red.
 *
 * That is the wrong shape for this particular event. Every other notification
 * here fires when something is HAPPENING and the owner is presumed present.
 * This one fires when the plan quietly stops being able to run — a verifier
 * resigning can take a circle from "this works" to "nothing can open", and the
 * owner has no reason to look. A continuity product that lets its own readiness
 * decay silently has the failure mode it exists to prevent.
 *
 * The two reasons are worded differently on purpose. "I am stepping down" is a
 * decision to respect; "I do not know this person" means an invitation reached
 * the wrong inbox, which is a security event and needs a different next step.
 *
 * Best-effort: leaving must never fail because mail did.
 */
export async function notifyOwnerOfResignation(params: {
  ownerEmail: string;
  personName: string;
  personType: 'recipient' | 'verifier';
  reason: 'resigned' | 'rejected';
}): Promise<boolean> {
  const role =
    params.personType === 'verifier'
      ? 'one of the people who would confirm an emergency'
      : 'one of the people you set things aside for';

  if (params.reason === 'rejected') {
    return sendEmailBestEffort({
      to: params.ownerEmail,
      subject: `${params.personName} did not recognise the invitation you sent`,
      text:
        `${params.personName} — ${role} — opened the invitation you sent and said they ` +
        `do not know what it is about.

` +
        `The likeliest explanation is that it reached the wrong address. Worth checking ` +
        `the one you used before sending another, because an invitation sitting in a ` +
        `stranger's inbox is the one thing the phone call afterwards exists to catch.

` +
        `Their place in your circle is still there and is waiting to be filled:

` +
        `    ${appUrl()}/circle

` +
        `Nothing was opened and nothing was lost.
`,
    });
  }

  return sendEmailBestEffort({
    to: params.ownerEmail,
    subject: `${params.personName} has stepped down from your Relay circle`,
    text:
      `${params.personName} was ${role}, and has stepped down.

` +
      `That is their right and it is better than a person who quietly stopped agreeing. ` +
      `But your plan is weaker than it was, and it may no longer be able to run at all — ` +
      `so this is worth a few minutes rather than a shrug.

` +
      `Your circle will tell you exactly where you now stand:

` +
      `    ${appUrl()}/circle

` +
      `Nothing was opened, and nothing in your vault changed.
`,
  });
}

/**
 * Tells the owner their recovery codes are nearly gone.
 *
 * Ratified by Steve 2026-08-13, over my objection, and the objection is worth
 * recording because it shapes what this message is allowed to contain. Relay's
 * central promise is that it NEVER sends a link that signs you in, and a
 * security prompt arriving by email is the exact shape a phishing message
 * imitates. Sending one at all spends a little of that.
 *
 * So this message is built to be worthless to an attacker who intercepts it. It
 * carries no code, no token, no link that authenticates, and asks for nothing —
 * it states a fact the owner can verify by signing in the way they always do.
 * Forwarding it accomplishes nothing; imitating it gains nothing, because there
 * is nothing in it to act on but "go and look".
 *
 * The counterweight is real: running out is terminal. No codes and no
 * authenticator means nobody can let that owner back in, including us, and the
 * Account screen only says so to somebody who has already opened it — which is
 * precisely the person who does not need telling.
 */
/**
 * Tells the owner their account was just RECOVERED — an account-takeover-shaped
 * event, whoever performed it. If it was them: confirmation and next steps. If
 * it was not: this message is the only way they find out while it still
 * matters, which is why it cannot be skipped and must not be quiet about what
 * to do.
 */
export async function notifyOwnerOfRecovery(ownerEmail: string): Promise<boolean> {
  return sendEmailBestEffort({
    to: ownerEmail,
    subject: 'Your Relay account was just recovered with a recovery code',
    text:
      `Someone — hopefully you — just used a recovery code to enrol a new authenticator ` +
      `on your Relay account. Every signed-in session was signed out, your old recovery ` +
      `codes stopped working, and a fresh list was issued to whoever did this.

` +
      `If this was you: nothing more to do. Keep the new list; only it works now.

` +
      `If this was NOT you: somebody had one of your recovery codes and now controls the ` +
      `sign-in. Recover the account back the same way with one of YOUR remaining codes — ` +
      `that signs them out and cuts off their authenticator — then check your audit page, ` +
      `and write to us so a person is looking too.

` +
      `    ${appUrl()}/auth/recover

` +
      `There is no code in this message and no link that signs anyone in. A message that ` +
      `asks you to click and log in is not from us.
`,
  });
}

export async function notifyOwnerRecoveryCodesLow(params: {
  ownerEmail: string;
  remaining: number;
}): Promise<boolean> {
  const { remaining } = params;
  const count = remaining === 1 ? 'one recovery code' : `${remaining} recovery codes`;

  /*
    🔴 THE SEVERITY INVERTED AT EXACTLY THE TERMINAL STATE. `remaining === 1`
    got the severe warning and EVERYTHING ELSE got "Worth topping up before it
    becomes urgent" — including zero. So the owner with one code left was told
    the truth, and the owner with NONE was told it was not urgent yet, when it
    had already happened: they are one lost authenticator away from a vault
    nobody on earth can open, including us.

    Zero is not a smaller version of one, it is a different fact, and it is the
    only state in this product that cannot be undone by anybody. It gets its own
    branch and the plainest sentence in the file.
  */
  const isTerminal = remaining <= 0;

  return sendEmailBestEffort({
    to: params.ownerEmail,
    subject: isTerminal
      ? 'You have NO Relay recovery codes left'
      : remaining === 1
        ? 'You have one Relay recovery code left'
        : `You have ${remaining} Relay recovery codes left`,
    text:
      (isTerminal
        ? `You just used your LAST recovery code to get back into Relay. You have none left.

` +
          `Please issue a fresh list today. Until you do, your authenticator is the only way ` +
          `into your account — and if you lose it, nobody can let you back in. Not us either. ` +
          `That is the same encryption promise that keeps your vault private, working in the ` +
          `direction that hurts.

`
        : `You just used a recovery code to get back into Relay, and you now have ${count} left.

` +
          (remaining === 1
            ? `That is the last one. If you use it and then lose your authenticator again, nobody ` +
              `can let you back in — not us either. That is the same encryption promise that keeps ` +
              `your vault private, working in the direction that hurts.

`
            : `Worth topping up before it becomes urgent.

`)) +
      `Sign in the way you normally do, open Account, and issue a fresh list. The new list ` +
      `replaces the old one, so keep only the newest.

` +
      `    ${appUrl()}/account

` +
      `There is nothing in this message to act on except that sentence — no code, and no link ` +
      `that signs you in. A message that asks you to ` +
      `click and log in is not from us.
`,
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
      /*
        Counted over the SAME set the grant was counted over. This used to scope
        only by owner and actor, so it swept in every item this recipient had
        ever opened under any trigger type, across every past release — while
        `granted` above counts the rules that exist right now for THIS trigger.
        Two different sets subtracted from one another is how "the other -1"
        became reachable: audit_log is append-only per the audit invariant, so
        opened never shrinks, while access_rules is deleted by both
        deleteItem's cascade and policy rematerialisation.

        The join makes the subtraction meaningful — every counted open is an
        item that is still granted under this trigger.
      */
      const opened = await query<{ n: string }>(
        `SELECT count(DISTINCT a.entity_id)::text AS n
           FROM audit_log a
           JOIN access_rules ar ON ar.vault_item_id = a.entity_id
                               AND ar.recipient_id = $3
                               AND ar.owner_id = $1
                               AND ar.trigger_type = $4
          WHERE a.owner_id = $1 AND a.actor = $2
            AND a.action = 'vault_item_decrypted'
            AND a.detail->>'outcome' = 'authorized'`,
        [params.ownerId, `recipient:${r.id}`, r.id, params.triggerType],
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
