/**
 * Is the delivery-event stream alive? The dead-man's switch for `DeliveryLine`.
 *
 * 🔴 WHAT GOES WRONG WITHOUT IT. `/circle` can only tell an owner what happened
 * to their mail because Resend pushes events to `/api/resend/webhook`. That
 * endpoint can be deleted in a dashboard, or its signing secret rotated, and
 * nothing in this application would notice: events simply stop, every address
 * falls back to `unknown`, and the circle screen returns to saying nothing at
 * all. Which looks exactly like "no news" — not like "the sensor is dead".
 *
 * That is the shape this codebase keeps getting caught by, and the portfolio
 * rule is explicit: when a job's success signal is a side effect, the ABSENCE of
 * that signal is the thing that must be monitored. `getSchedulerHealth` does
 * this for the cron; this does it for the mail telemetry.
 *
 * ⚠️ WHY THERE IS NO FRESHNESS ALARM, deliberately. Relay's sending is bursty by
 * design — a release is a rare event and most weeks should send almost nothing —
 * so "no events in 24h" is an ordinary quiet week, not a fault. A threshold here
 * would fire constantly and be muted within a fortnight, which is how monitors
 * die; `lib/ops/canary.ts` says the same thing in its own header. So age is
 * REPORTED for a human to judge and does not decide `healthy`.
 *
 * ⚠️ AND WHAT IT CANNOT SEE. The strongest check would be "we accepted N sends
 * and heard nothing back", but there is no send-side record to compare against:
 * `lib/notify/transcript.ts` is in-memory and refuses to arm in production, by
 * design, because message bodies contain live credentials. So this answers the
 * weaker but honest question — *have we ever heard anything at all* — which is
 * precisely the state that silently blinds the screen.
 *
 * Feature: relay-standby
 */

import { query } from '../db/connection';

export interface DeliveryWebhookHealth {
  /** Has any provider event EVER arrived? False = the webhook is unproven. */
  everHeard: boolean;
  totalEvents: number;
  lastEventAt: string | null;
  /** Null when never heard, or when the stored timestamp will not parse. */
  ageSeconds: number | null;
  healthy: boolean;
  /** What it means for a human. Required, for the same reason the canary's is. */
  meaning: string;
}

export async function getDeliveryWebhookHealth(
  now: Date = new Date(),
): Promise<DeliveryWebhookHealth> {
  const r = await query<{ n: string; newest: string | null }>(
    `SELECT count(*)::text AS n, max(occurred_at)::text AS newest FROM email_delivery_events`,
  );

  const totalEvents = Number(r.rows[0]?.n ?? 0);
  const lastEventAt = r.rows[0]?.newest ?? null;
  const everHeard = totalEvents > 0;

  const parsed = lastEventAt ? new Date(lastEventAt).getTime() : NaN;
  const ageSeconds = Number.isNaN(parsed) ? null : Math.floor((now.getTime() - parsed) / 1000);

  return {
    everHeard,
    totalEvents,
    lastEventAt,
    ageSeconds,
    // The ONLY condition that is unambiguously wrong. See the header.
    healthy: everHeard,
    meaning: everHeard
      ? 'Delivery events are arriving, so DeliveryLine can report what happened to a message. ' +
        'A long age here is normal — this product sends rarely by design.'
      : 'No delivery event has EVER arrived, so the Resend webhook is unconfigured or broken. ' +
        'DeliveryLine renders nothing without it, which reads to an owner as "no news" rather ' +
        'than "we cannot see". Run scripts/verify-delivery-webhook.ts.',
  };
}
