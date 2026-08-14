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
 * Feature: relay-h0-mvp
 */

export interface DeliveryState {
  event: string;
  detail: string | null;
  occurredAt: string;
  verdict: 'delivered' | 'undeliverable' | 'delayed' | 'unknown';
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : ` on ${d.toLocaleDateString()}`;
}

export default function DeliveryLine({
  name,
  delivery,
}: {
  name: string;
  delivery?: DeliveryState | null;
}) {
  // Nothing heard, or nothing worth saying. See the header: absent is not fine,
  // it is unheard — and unheard is not a sentence worth putting on the screen.
  if (!delivery || delivery.verdict === 'unknown') return null;

  if (delivery.verdict === 'undeliverable') {
    return (
      <div style={{ fontSize: 'var(--t1)', color: 'var(--ochre-text)', marginTop: '4px' }}>
        Email to {name} did not arrive{when(delivery.occurredAt)} — it bounced or was refused, and
        we cannot reach them this way. Give them their code by phone, and ask them to add a passkey
        so a release never depends on email.
      </div>
    );
  }

  if (delivery.verdict === 'delayed') {
    return (
      <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: '4px' }}>
        The last email to {name} was delayed{when(delivery.occurredAt)}. It may still arrive.
      </div>
    );
  }

  // The quiet, good case: an event actually said delivered. Stated plainly and
  // without colour, because a working plan should read as settled.
  return (
    <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: '4px' }}>
      Email reached {name}{when(delivery.occurredAt)}.
    </div>
  );
}
