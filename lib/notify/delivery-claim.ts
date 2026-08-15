/**
 * The one place that decides what a delivery event is allowed to CLAIM.
 *
 * 🔴 THE FALSE GREEN THIS EXISTS TO KILL. `/circle` rendered "Email reached
 * {name}" whenever the latest provider event was `email.delivered` — and both
 * Outlook messages in the 2026-08-14 A/B test recorded `email.delivered` in
 * Relay's own `email_delivery_events` table while sitting in the junk folder at
 * SCL 5. `delivered` and `junked` are THE SAME EVENT to us. So the screen told
 * an owner, in calm, that the channel worked, on the exact evidence that cannot
 * show it — the same shape as every other false green this codebase has found:
 * a green signal that was measuring something adjacent.
 *
 * The module it replaced already got the SILENCE case right ("renders NOTHING
 * rather than 'reachable'") and the delivered case wrong. What a provider
 * accepting a message actually licenses is a claim about the provider's queue,
 * never about a human's inbox, and that is the strongest sentence permitted
 * here.
 *
 * Kept out of the component so it is testable in the `node` environment the rest
 * of the suite runs in, and so a future edit that re-inlines the copy has to
 * delete a test to do it.
 *
 * Feature: relay-standby
 */

import type { DeliveryVerdict } from './delivery-events';
import { isMicrosoftMailbox } from './mailbox-provider';

/** `warn` is the ochre "worth attention" line; `note` is muted and settled. */
export type DeliveryTone = 'warn' | 'note';

export interface DeliverySentence {
  tone: DeliveryTone;
  text: string;
}

/** ` on 14/08/2026`, or nothing at all rather than `Invalid Date`. */
function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : ` on ${d.toLocaleDateString()}`;
}

export function describeDelivery(params: {
  name: string;
  email: string;
  verdict: DeliveryVerdict;
  occurredAt: string;
}): DeliverySentence | null {
  const { name, email, verdict, occurredAt } = params;
  const date = when(occurredAt);

  // Nothing heard, or nothing worth saying. Absent is not fine, it is unheard —
  // and unheard is not a sentence worth putting on the screen.
  if (verdict === 'unknown') return null;

  if (verdict === 'undeliverable') {
    return {
      tone: 'warn',
      text:
        `Email to ${name} did not arrive${date} — it bounced or was refused, and we cannot reach ` +
        `them this way. Give them their code by phone, and ask them to add a passkey so a release ` +
        `never depends on email.`,
    };
  }

  if (verdict === 'delayed') {
    return {
      tone: 'note',
      text: `The last email to ${name} was delayed${date}. It may still arrive.`,
    };
  }

  // A provider we have measured filing us as junk. The event says the same word
  // it says for a message nobody will ever see, so it gets the harder sentence.
  if (isMicrosoftMailbox(email)) {
    return {
      tone: 'warn',
      text:
        `${name}'s provider accepted our last email${date} — but they are on Outlook, where we ` +
        `have measured Relay's mail being filed as junk. Accepted is not the same as seen: give ` +
        `them anything urgent by phone, and ask them to check their junk folder.`,
    };
  }

  return {
    tone: 'note',
    text:
      `${name}'s provider accepted our last email${date}. That is as much as we can know — ` +
      `accepted is not the same as sitting in their inbox, and a junk folder looks identical ` +
      `from here.`,
  };
}
