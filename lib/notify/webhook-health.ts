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
 *   - A REFUSAL ABOUT ONE MESSAGE CANNOT LATCH EITHER. Added 2026-08-21 after
 *     the refusal condition below shipped and was reviewed the same day: it
 *     counted a mistyped recipient address the same as a revoked API key, so one
 *     owner typo held the endpoint at 503 for a month with the wrong diagnosis
 *     printed on it. Credential-shaped refusals still latch; the rest age out.
 *
 * Feature: relay-standby
 */

import { query } from '../db/connection';
import { REFUSED_PREFIX, refusalClassOf, isSystemicRefusalClass } from './delivery-events';

/**
 * The LIKE pattern that separates refused attempts from accepted ones.
 *
 * Interpolated from `REFUSED_PREFIX` rather than spelled again in four SQL
 * strings: the marker and the thing that reads it are one contract, and a
 * literal repeated per query is four places for it to drift. Safe to interpolate
 * because it is a module constant and never reaches here from a request — the
 * date bounds stay bound parameters, as they must.
 */
const REFUSED_LIKE = `${REFUSED_PREFIX}%`;

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

/**
 * How long a refusal that is NOT about the credential keeps meaning something.
 *
 * A refusal Resend gave for one message — a mistyped recipient address, a 429 —
 * is evidence about that message and about the minutes around it. Judged over
 * `WINDOW_MS` it became evidence about the next month: one typo held the health
 * endpoint at 503 until some later message happened to be accepted, which at
 * this product's send volume can be never. Two days is long enough for the daily
 * monitor to see it twice and short enough that it ages out on its own.
 *
 * ⚠️ IT DOES NOT APPLY TO THE CREDENTIAL CLASSES, and that asymmetry is the
 * whole design. A revoked key never recovers, so ageing that out would be the
 * monitor going quiet while the fault stands.
 */
export const RECENT_REFUSAL_MS = 48 * 60 * 60 * 1000;

/**
 * How many refusal rows are read back for classification.
 *
 * The NEWEST ones (`ORDER BY … DESC`), which is the direction that cannot hide
 * the current fault: a cap taken from the oldest end could bury a dead
 * credential behind a thousand older address typos, whereas capping from the
 * newest end can only move the judged start LATER, which makes the alarm
 * likelier rather than quieter. Relay sends rarely enough that reaching this at
 * all would itself be the emergency.
 */
export const REFUSAL_SAMPLE_LIMIT = 1000;

export interface DeliveryWebhookHealth {
  /** Has any provider event EVER arrived? False = the webhook is unproven. */
  everHeard: boolean;
  totalEvents: number;
  lastEventAt: string | null;
  /** Null when never heard, or when the stored timestamp will not parse. */
  ageSeconds: number | null;
  /** ACCEPTED sends old enough to have been reported on, inside the window. */
  ripeSends: number;
  /** How many of those we did hear about. The live half of the switch. */
  ripeSendsHeard: number;
  /**
   * Sends the provider refused, or could not be asked about, inside the window.
   * Reported for a human; it is NOT what decides — see `systemicRefusals`.
   * Capped at `REFUSAL_SAMPLE_LIMIT`.
   */
  refusedSends: number;
  /**
   * How many of those say Relay cannot send AT ALL — a credential, an account or
   * a sending-domain failure, rather than one bad recipient address or a 429.
   * `lib/notify/delivery-events.ts` holds the classification and the argument
   * for its direction.
   */
  systemicRefusals: number;
  /**
   * Sends accepted at or after the first refusal being JUDGED — the oldest
   * systemic one, or the oldest recent non-systemic one, whichever came first.
   * Zero alongside a non-zero refusal count means the provider stopped taking
   * our mail and has not started again.
   *
   * ZERO WHEN NOTHING IS BEING JUDGED, structurally: the query is not asked. It
   * used to fall back to the start of the whole window and count every accepted
   * send in it, which was a number on a public payload that did not match this
   * description. Nothing read it, so nothing failed — which is exactly how a
   * payload field goes wrong quietly.
   */
  acceptedSinceFirstRefusal: number;
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

    ⚠️ REFUSALS ARE EXCLUDED HERE, and that is not tidiness. A message the
    provider never took can never be reported on — no webhook event will ever
    carry its id — so counting one as a ripe send would make `deaf` fire and send
    an operator to the Resend webhook configuration for a fault that is in the
    API key. Two different faults, two different pages. They are counted below
    instead, under their own condition.
  */
  const s = await query<{ ripe: string; heard: string }>(
    `SELECT count(*)::text AS ripe,
            COALESCE(sum(CASE WHEN EXISTS (
              SELECT 1 FROM email_delivery_events e WHERE e.provider_id = a.provider_id
            ) THEN 1 ELSE 0 END), 0)::text AS heard
       FROM email_send_attempts a
      WHERE a.occurred_at <= $1 AND a.occurred_at >= $2
        AND a.provider_id NOT LIKE '${REFUSED_LIKE}'`,
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
    🔴 THE THIRD WAY THIS SWITCH STAYS SILENT, and the one that hides the loudest
    failure available (found 2026-08-21). Everything above judges messages Resend
    ACCEPTED. Nothing judged the ones it refused — because until that date a
    refusal wrote no row at all: `email.ts` recorded an attempt only after
    acceptance, and `transcript.ts` is in-memory and refuses to arm in production
    because the bodies carry live access codes.

    So a revoked or wrongly-rotated `RESEND_API_KEY`, a suspended shared Resend
    account, a sending-domain restriction or any 4xx produced zero attempts and
    zero events, `ripeSends` fell to 0, and this file read that as "a quiet week"
    and reported healthy while EVERY message Relay sent was being refused.
    `docs/secret-rotation-runbook.md` asserted the opposite: "RESEND_API_KEY fails
    loudly — all mail stops, and delivery-webhook-monitor.yml notices."

    THE CONDITION IS "AND HAS NOT RECOVERED", not "any refusal at all". A key
    that no longer works never recovers, so that condition never clears on its
    own — which is right for a credential and, it turned out, wrong for
    everything else.

    🔴 AND THAT IS THE SECOND DEFECT, found in review the same day. `email.ts`
    records a refusal on ANY `result.error`, and the commonest error Resend
    returns is per-message: a mistyped recipient address comes back as
    `validation_error`. The condition was `refusedSends > 0 &&
    acceptedSinceFirstRefusal === 0`, cleared ONLY by a later ACCEPTED send,
    inside a 30-day window, at a product that sends almost nothing. So ONE owner
    typo held `/api/health/delivery-webhook` at 503 for up to a month, told an
    operator "Relay is currently sending no mail at all … check RESEND_API_KEY
    first" about a key that was working, and re-alarmed the daily monitor every
    morning until an unrelated message happened to be accepted. The comment here
    said "a single 429 that the next message sails past is a provider having a
    moment" — describing behaviour the code did not have, because at this volume
    the next message may never come.

    TWO POPULATIONS, THEREFORE, split on the class the marker already carried and
    nothing ever read back (`refused:<class>:<uuid>`):

      - SYSTEMIC — the credential, the account, the sending domain, or the
        provider unreachable. Latches until a send is accepted, as before,
        because it does not fix itself.
      - EVERYTHING ELSE — one bad address, a 429. Judged over
        `RECENT_REFUSAL_MS` instead, so it still reports while it is fresh (a
        sandboxed account also answers `validation_error`, and that IS an
        outage) and ages out on its own rather than latching for a month.

    Unknown classes count as systemic; `delivery-events.ts` carries the argument
    for that direction.

    CLASSIFIED HERE RATHER THAN IN SQL, deliberately. The predicate is then
    executed by tests instead of asserted as a substring — this file has already
    shipped two monitors whose tests passed while the condition could not fire —
    and the SQL stays the plainest form there is, which is what DSQL's subset of
    PostgreSQL rewards.

    NO SETTLE WINDOW, unlike the check above: a refusal is already final. Nothing
    is going to arrive later and change what it means.
  */
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const f = await query<{ provider_id: string; occurred_at: string }>(
    `SELECT provider_id, occurred_at::text AS occurred_at
       FROM email_send_attempts
      WHERE provider_id LIKE '${REFUSED_LIKE}' AND occurred_at >= $1
      ORDER BY occurred_at DESC
      LIMIT ${REFUSAL_SAMPLE_LIMIT}`,
    [windowStart],
  );

  const refusals = f.rows
    .map((r) => ({
      systemic: isSystemicRefusalClass(refusalClassOf(r.provider_id) ?? 'unknown'),
      at: new Date(r.occurred_at).getTime(),
    }))
    // An unparseable timestamp cannot be placed in either window, and a refusal
    // we cannot date cannot be judged. Same rule as `ageSeconds` above.
    .filter((r) => !Number.isNaN(r.at))
    .sort((a, b) => a.at - b.at); // Oldest first: "the first refusal" is [0].

  const refusedSends = refusals.length;
  const systemicRefusals = refusals.filter((r) => r.systemic).length;

  /*
    The refusal the judgement starts FROM. Not simply the oldest row: a bad
    address a fortnight before the credential died would move the lower bound
    back far enough to sweep up sends that predate the outage, and the alarm
    would never fire.
  */
  const recentStart = now.getTime() - RECENT_REFUSAL_MS;
  const firstJudged = refusals.find((r) => r.systemic || r.at >= recentStart);

  let acceptedSinceFirstRefusal = 0;
  if (firstJudged) {
    const a = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM email_send_attempts
        WHERE provider_id NOT LIKE '${REFUSED_LIKE}' AND occurred_at >= $1`,
      [new Date(firstJudged.at)],
    );
    acceptedSinceFirstRefusal = Number(a.rows[0]?.n ?? 0);
  }

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
  // `refusing` is the outage; `deaf` is only blindness about an outage. Named
  // first below because an operator reading this is looking for what to fix.
  const refusing = firstJudged !== undefined && acceptedSinceFirstRefusal === 0;
  const healthy = everHeard && !refusing && !deaf && !mute;

  return {
    everHeard,
    totalEvents,
    lastEventAt,
    ageSeconds,
    ripeSends,
    ripeSendsHeard,
    refusedSends,
    systemicRefusals,
    acceptedSinceFirstRefusal,
    writerProven,
    orphanEvents,
    healthy,
    meaning: !everHeard
      ? 'No delivery event has EVER arrived, so the Resend webhook is unconfigured or broken. ' +
        'DeliveryLine renders nothing without it, which reads to an owner as "no news" rather ' +
        'than "we cannot see". Run scripts/verify-delivery-webhook.ts.'
      : refusing && systemicRefusals > 0
        ? `${systemicRefusals} of ${refusedSends} refused send(s) point at the CREDENTIAL or the ` +
          'account rather than at one message, and nothing has been accepted since the first of ' +
          'them, so Relay is currently sending no mail at all — invitations, verifier notices ' +
          'and access codes are all failing. Check RESEND_API_KEY first (a revoked or ' +
          'wrongly-rotated key is the commonest cause and the one the rotation runbook covers), ' +
          'then that the Resend account is not suspended and the sending domain is still ' +
          // ⚠️ "§RESEND_API_KEY" until 2026-08-21. That heading does not exist —
          // the key is covered under "§6 — the rest" — so an operator searching
          // for the section they were handed, at 3am, found nothing. The
          // delivery-webhook-monitor workflow inherited the error verbatim from
          // this line, which is how a wrong pointer becomes two wrong pointers.
          'verified. docs/secret-rotation-runbook.md §6.'
        : refusing
        ? /*
             Deliberately NOT the key page. Every refusal here is one Resend
             classifies as being about the message — overwhelmingly a recipient
             address somebody typed — so sending an operator to rotate a working
             credential is the wrong instruction, and the one that teaches them
             to stop reading this line. It clears itself once these age past
             RECENT_REFUSAL_MS; the sandbox case is the reason it reports at all.
          */
          `${refusedSends} recent send(s) were refused for a reason Resend attributes to the ` +
          'MESSAGE rather than to us — most often a recipient address that cannot receive — and ' +
          'nothing has been accepted since. Check the address on the affected contact in ' +
          '/circle first; this clears itself once the refusals age out. If EVERY send is ' +
          'failing rather than one, the Resend account may be restricted to mailing its own ' +
          'owner (Resend calls that a validation error too) — that is a sending-domain ' +
          'verification, in the Resend dashboard, not a credential to rotate.'
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
            // ⚠️ "migration 030 already locked the application out of it once"
            // until 2026-08-21, which sends a reader to the wrong file. 030
            // created the role and its grant; `ON ALL TABLES` resolved once
            // against the tables existing then; 031 created THIS table, so the
            // first read of it failed; 032 is the fix and carries the account.
            '— 031 created this table after 030 had already granted on "all" of them, and the ' +
            'first read failed with permission denied. See db/migrations/032.'
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
