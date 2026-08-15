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
 * 🔴 AND FOR ITS FIRST WEEK, THIS FILE DID NOT NOTICE EITHER. `healthy` was
 * `count(*) > 0` over `email_delivery_events`, which is append-only. The moment
 * the first event landed that condition was true forever — 113 rows had landed
 * by 2026-08-15 — so the switch could no longer fire for any reason. Everything
 * built on top of it was real: a public health endpoint, a daily GitHub Actions
 * probe deliberately hosted off Vercel so it could outlive what it watches, a
 * retry so it would not cry wolf, an error message naming the three things to
 * check. All of it downstream of a condition that had already latched.
 *
 * The paragraph above about a rotated signing secret was written INTO the
 * monitor that could not detect a rotated signing secret. That is the shape this
 * codebase keeps getting caught by, and it is why the fix is a condition that
 * can still become false rather than a louder alarm on the old one.
 *
 * ⚠️ WHY THERE IS STILL NO FRESHNESS ALARM. Relay's sending is bursty by design
 * — a release is a rare event and most weeks should send almost nothing — so "no
 * events in 24h" is an ordinary quiet week, not a fault. A threshold there would
 * fire constantly and be muted within a fortnight, which is how monitors die;
 * `lib/ops/canary.ts` says the same thing in its own header. Age is still
 * REPORTED for a human to judge and still does not decide anything.
 *
 * WHAT DECIDES INSTEAD is the comparison this file's previous header called
 * impossible: *we accepted N sends and heard nothing back about any of them*.
 * It said there was no send-side record because `lib/notify/transcript.ts` is
 * in-memory and refuses to arm in production, bodies being full of live access
 * codes. True of transcript, and the wrong conclusion — the switch never needed
 * the message, only the fact that one was accepted. `email_send_attempts` holds
 * Resend's id and a timestamp, no recipient and no body (migration 031).
 *
 * Three properties make it quiet enough to survive, and each is pinned by a test:
 *
 *   - A QUIET WEEK CANNOT FIRE IT. No sends in the window means nothing to
 *     conclude, and it concludes nothing.
 *   - ONE SLOW MESSAGE CANNOT FIRE IT. Attempts younger than SETTLE_MS are not
 *     yet judged, and a partial match — some heard, some not — is reported but
 *     never decides. Only total silence about every ripe send does.
 *   - IT CANNOT LATCH. The window is trailing, so a period of health cannot
 *     immunise the future the way `ever heard anything` did.
 *
 * Feature: relay-standby
 */

import { query } from '../db/connection';

/**
 * How long a send is given before its silence means anything.
 *
 * Six hours, and generous on purpose. `email.delivery_delayed` exists precisely
 * because receiving mail servers defer, and a greylisted first contact can sit
 * for an hour or more before anything is reported. The cost of being generous is
 * that a truly dead webhook is noticed up to six hours late; the cost of being
 * tight is a monitor that fires on ordinary slowness and gets muted, and this
 * file already has one story about an alarm nobody could act on.
 */
export const SETTLE_MS = 6 * 60 * 60 * 1000;

/**
 * How far back the judgement looks. Beyond this, a send is history rather than
 * evidence — a webhook fixed a month ago should not be alarmed about forever.
 */
export const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeliveryWebhookHealth {
  /** Has any provider event EVER arrived? False = the webhook is unproven. */
  everHeard: boolean;
  totalEvents: number;
  lastEventAt: string | null;
  /** Null when never heard, or when the stored timestamp will not parse. */
  ageSeconds: number | null;
  /** Sends old enough to have been reported on, inside the window. */
  ripeSends: number;
  /** How many of those we did hear about. The live half of the switch. */
  ripeSendsHeard: number;
  /** Has the send-side recorder ever written a row? False = it is unproven. */
  writerProven: boolean;
  /**
   * Events about messages we have no send record for, since the recorder
   * started working. Non-zero means the recorder has stopped — see below.
   */
  orphanEvents: number;
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

  /*
    Ripe sends, and how many were reported on. One round trip, matched on
    Resend's own id — the value the send API returns is the `email_id` the
    webhook echoes back, so this is an identity match rather than a heuristic on
    addresses or timing.

    PER-SEND, not two independent counts. Asking "how many attempts" and "how
    many events" separately would let an unrelated event from elsewhere in the
    window make a dead pipe look alive — which is the mistake the old version
    made at a larger scale, and the one that let another product's traffic stand
    in for our own.

    A correlated EXISTS rather than a LATERAL join or an aggregate FILTER: DSQL
    implements a subset of PostgreSQL, and this is the form with the least
    surface to be missing from it. Proven against the live cluster, not assumed.
  */
  const s = await query<{ ripe: string; heard: string }>(
    `SELECT count(*)::text AS ripe,
            COALESCE(sum(CASE WHEN EXISTS (
              SELECT 1 FROM email_delivery_events e WHERE e.provider_id = a.provider_id
            ) THEN 1 ELSE 0 END), 0)::text AS heard
       FROM email_send_attempts a
      WHERE a.occurred_at <= $1 AND a.occurred_at >= $2`,
    [new Date(now.getTime() - SETTLE_MS), new Date(now.getTime() - WINDOW_MS)],
  );

  const ripeSends = Number(s.rows[0]?.ripe ?? 0);
  const ripeSendsHeard = Number(s.rows[0]?.heard ?? 0);

  /*
    🔴 THE WAY THIS SWITCH GETS DISARMED A SECOND TIME. Everything above rests on
    `email_send_attempts` having rows in it. `recordSendAttempt` is best-effort
    and swallows its own failures — deliberately, because telemetry must not be
    able to fail a send — so if it ever stops working, `ripeSends` falls to zero,
    that reads as "a quiet week", and this file returns to reporting healthy
    forever. Exactly the shape it was just rebuilt to escape, one layer down.

    It is not hypothetical. Migration 030's grant did not cover tables created
    afterwards, so the first read of this very table failed with `permission
    denied` — a privilege change is precisely the kind of thing that would mute
    the recorder while leaving everything else running.

    THE INCONSISTENCY IS DETECTABLE, and exactly, because since the webhook
    boundary started refusing other products' mail every event we store is about
    a message WE sent. So an event whose `provider_id` matches no attempt row is
    a message the recorder missed. Attempts are written at send time and events
    arrive afterwards, so the ordering is never ambiguous.

    ⚠️ COUNTED ONLY FROM THE FIRST ATTEMPT ONWARD, which is what makes this safe
    to switch on. Every event recorded before this code shipped has no attempt
    row and never will; without that bound, deploying it would alarm immediately
    about mail that was sent correctly months earlier. Until the first attempt
    exists the recorder is UNPROVEN — reported, not alarmed — and it becomes
    decisive the moment one send goes out.
  */
  const w = await query<{ attempts: string; orphans: string }>(
    `SELECT (SELECT count(*) FROM email_send_attempts)::text AS attempts,
            COALESCE((
              SELECT count(*) FROM email_delivery_events e
               WHERE e.provider_id IS NOT NULL
                 AND e.occurred_at >= (SELECT min(occurred_at) FROM email_send_attempts)
                 AND NOT EXISTS (
                   SELECT 1 FROM email_send_attempts a WHERE a.provider_id = e.provider_id
                 )
            ), 0)::text AS orphans`,
  );

  const writerProven = Number(w.rows[0]?.attempts ?? 0) > 0;
  const orphanEvents = Number(w.rows[0]?.orphans ?? 0);

  /*
    THE TWO CONDITIONS THAT ARE UNAMBIGUOUSLY WRONG, and nothing else.

    `!everHeard` is the original: we have never heard anything at all, so the
    webhook is unproven. It is kept because it is the correct reading of a fresh
    deployment, and it is no longer the ONLY reading, which was the defect.

    `ripeSends > 0 && ripeSendsHeard === 0` is the live one: we handed Resend
    messages, every one is old enough that something should have come back, and
    nothing did about any of them. That is a dead pipe, not a slow day.
  */
  const deaf = ripeSends > 0 && ripeSendsHeard === 0;
  const mute = writerProven && orphanEvents > 0;
  const healthy = everHeard && !deaf && !mute;

  return {
    everHeard,
    totalEvents,
    lastEventAt,
    ageSeconds,
    ripeSends,
    ripeSendsHeard,
    writerProven,
    orphanEvents,
    healthy,
    meaning: !everHeard
      ? 'No delivery event has EVER arrived, so the Resend webhook is unconfigured or broken. ' +
        'DeliveryLine renders nothing without it, which reads to an owner as "no news" rather ' +
        'than "we cannot see". Run scripts/verify-delivery-webhook.ts.'
      : deaf
        ? `${ripeSends} message(s) were accepted by Resend more than ${SETTLE_MS / 3600_000}h ` +
          'ago and NOTHING has been reported back about any of them. Events arrived in the past, ' +
          'so this is a stream that has stopped: check that the webhook endpoint still exists in ' +
          'the Resend dashboard and that RESEND_WEBHOOK_SECRET still matches its signing secret. ' +
          'While this lasts, /circle cannot tell an owner what became of any message.'
        : mute
          ? `${orphanEvents} delivery event(s) arrived for messages with no send record, so ` +
            'recordSendAttempt has stopped writing. It swallows its own failures by design, and ' +
            'without those rows this check silently reverts to reporting healthy no matter what ' +
            'happens to the mail. Look for a privilege or schema change on email_send_attempts ' +
            '— migration 030 already locked the application out of it once.'
          : writerProven
            ? 'Delivery events are arriving for the messages we send. A long age here is normal ' +
              '— this product sends rarely by design, and the judgement above is made against ' +
              'sends, not against the clock.'
            : 'Events are arriving, but no send has been recorded yet, so the comparison this ' +
              'check depends on is UNPROVEN. Expected immediately after deploying the send-side ' +
              'recorder; it resolves itself on the first message Relay sends. If it persists ' +
              'past the next send, recordSendAttempt is not writing.',
  };
}
