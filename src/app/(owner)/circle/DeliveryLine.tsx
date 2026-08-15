'use client';

/**
 * Did the last thing we sent this person actually arrive?
 *
 * 🔴 THE QUESTION THE PRODUCT COULD NOT ANSWER, and the one whose wrong answer
 * is worst. Resend accepts a send to a SUPPRESSED address and returns 200 with
 * a message id — a previously-bounced contact is muted permanently, silently,
 * and every caller reports success. On the day a release fires that means
 * verifier notices going nowhere, nobody answering, quorum never met, and
 * access never opening on the one day the product exists for.
 *
 * It is shown HERE, on the screen where the owner builds their circle in calm,
 * because that is the only moment they can act on it. The same fact delivered
 * during the emergency reaches an owner who is, by hypothesis, not reading.
 *
 * ⚠️ SILENCE IS NOT REASSURANCE. `delivery` is null until Resend's webhook is
 * configured AND that address has been mailed at least once — so this component
 * renders NOTHING rather than "reachable". A screen that reported delivery on
 * the basis of no evidence would be precisely the false green this codebase
 * keeps finding; the only claims made here are ones an event actually supports.
 *
 * 🔴 AND IT GOT THE OTHER HALF WRONG UNTIL 2026-08-14. The silence case was
 * careful and the DELIVERED case said "Email reached {name}" — while both
 * Outlook messages in that day's A/B test recorded `email.delivered` here and
 * sat in the junk folder. `delivered` and `junked` are the same event, so this
 * screen was reassuring an owner in calm on evidence that cannot reassure.
 *
 * Every sentence now comes from `lib/notify/delivery-claim.ts`, which is where
 * the reasoning and the tests live. This file is only the paint.
 *
 * Feature: relay-h0-mvp
 */

import { describeDelivery } from '../../../../lib/notify/delivery-claim';

export interface DeliveryState {
  event: string;
  detail: string | null;
  occurredAt: string;
  verdict: 'delivered' | 'undeliverable' | 'delayed' | 'unknown';
}

export default function DeliveryLine({
  name,
  email,
  delivery,
}: {
  name: string;
  /** Their address — the provider on the far end changes what we may claim. */
  email: string;
  delivery?: DeliveryState | null;
}) {
  if (!delivery) return null;

  const line = describeDelivery({
    name,
    email,
    verdict: delivery.verdict,
    occurredAt: delivery.occurredAt,
  });
  if (!line) return null;

  return (
    <div
      style={{
        fontSize: 'var(--t1)',
        color: line.tone === 'warn' ? 'var(--ochre-text)' : 'var(--ink-muted)',
        marginTop: '4px',
      }}
    >
      {line.text}
    </div>
  );
}
