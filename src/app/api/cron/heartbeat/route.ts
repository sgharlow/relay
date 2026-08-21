/**
 * POST /api/cron/heartbeat — scheduled heartbeat evaluation (Vercel Cron).
 *
 * Validates the shared `CRON_SECRET` (sent by Vercel Cron as
 * `Authorization: Bearer <CRON_SECRET>`), then sweeps overdue active owners and
 * arms their ARMED triggers to PENDING. Returns a summary.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.3, 4.6, 4.7
 */

import { NextResponse, type NextRequest } from 'next/server';
import { runHeartbeatSweep, resolveElapsedGrace } from '../../../../../lib/release/heartbeat';
import { ReleaseStateMachine } from '../../../../../lib/release/state-machine';
import { recordSchedulerRun } from '../../../../../lib/release/scheduler-ledger';
import { escalateLapsedRequests } from '../../../../../lib/release/escalation';
import { sweepSilentVerifiers } from '../../../../../lib/release/silence-sweep';
import { sweepCheckinReminders } from '../../../../../lib/release/checkin-reminder';
import { sweepExpiredChallenges } from '../../../../../lib/auth/challenge-store';
import { sweepOldSigninAttempts } from '../../../../../lib/auth/signin-attempts';
import { timingSafeEquals } from '../../../../../lib/http/timing-safe';

async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get('authorization');

  if (!secret || !timingSafeEquals(authz ?? '', `Bearer ${secret}`)) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or missing CRON_SECRET' },
      { status: 401 },
    );
  }

  const machine = new ReleaseStateMachine();
  const summary = await runHeartbeatSweep(machine);

  // The other half of the sweep: GRACE rows whose window has elapsed and whose
  // quorum is already met. Without this, GRACE_WINDOW_MS could not be raised
  // above 0 — a non-zero window would strand releases rather than create the
  // owner stand-down window (it was an owner-CANCEL window until Cancel was retired 2026-08-21) it appears to offer.
  const graceReleased = await resolveElapsedGrace(machine);

  // Requests the owner never answered. CHALLENGE_WINDOW_SECONDS promised that
  // verifiers get contacted once the window lapses; nothing read `expires_at`, so
  // when the owner was incapacitated — the case this product exists for — the
  // request sat in `awaiting_owner` forever. It runs HERE rather than on a reader
  // because the reader it is specified against (a verifier's standby dashboard)
  // does not exist yet, and it adds no second scheduler: this one is already
  // running. See lib/release/escalation.ts.
  const escalated = await escalateLapsedRequests(machine);

  /*
    The other direction of the same silence. `escalateLapsedRequests` handles the
    OWNER not answering; nothing handled the VERIFIERS not answering — which is
    now the likelier failure, because their notice is the one whose loss stalls a
    release and a junked notice is indistinguishable from a delivered one from
    inside this product.

    Moves no state. It sends the owner the phone numbers already in their own
    circle and tells them to ring. See lib/release/silence-sweep.ts.
  */
  const silent = await sweepSilentVerifiers();

  /*
    HOUSEKEEPING, NOT A GUARD — and it rides here rather than becoming a second
    scheduled thing precisely because it is not one. Single-use auth nonces
    (migration 029) expire by a predicate on the read path, in the database, on
    every burn; deleting the spent rows only reclaims space. If this line never
    ran again the table would grow and nothing would become less safe, which is
    the opposite of the ledger recorded below — whose ABSENCE is the failure and
    which is monitored for exactly that reason. Do not wire an alert to this.

    It swallows its own errors, so housekeeping can never fail the sweep it
    rides on.
  */
  const challengesSwept = await sweepExpiredChallenges();

  /*
    The same shape and the same ruling, for the sign-in attempt budget
    (migration 036). Expiry is a predicate on the READ path — a row older than
    the window counts for nothing whether or not this ever runs — so if this
    line stopped, the table would grow and nothing would become less safe.
    Housekeeping. Do not wire an alert to this one either.
  */
  const signinAttemptsSwept = await sweepOldSigninAttempts();

  // CC9: record the run so its ABSENCE is detectable by /api/health/scheduler.
  await recordSchedulerRun(summary);

  /*
    🔴 THE OWNER'S OWN WARNING, which did not exist until 2026-08-21 (J5-R4). A
    living owner who missed ONE interval had `runHeartbeatSweep` arm their trigger
    and their verifiers asked whether they were incapacitated; the first thing the
    owner heard was the message saying it had already started. This is the ladder
    that runs before that — see lib/release/checkin-reminder.ts.

    ⚠️ IT IS LAST ON PURPOSE, and both halves of that placement are asserted in
    route.test.ts rather than left to whoever reads this.

    AFTER `runHeartbeatSweep`, so a nudge can never postpone an arming. It reads a
    DISJOINT set of owners — approaching their interval, not past it — so the
    order cannot change any outcome; running it last means a future edit cannot
    quietly make it a precondition either.

    AFTER `recordSchedulerRun`, so a failing email cannot forge a dead scheduler.
    That ledger row is what /api/health/scheduler reads and its ABSENCE is the
    off-Vercel dead-man's switch; if this threw ahead of it, a Resend outage would
    be reported as the product's dead-man's switch having stopped.
    `sweepCheckinReminders` also never throws, for the same reason — belt and
    braces, because the alarm it would trip is the most expensive false alarm in
    the product.
  */
  const checkinReminders = await sweepCheckinReminders();

  return NextResponse.json({
    ...summary,
    graceReleased,
    escalated: escalated.length,
    silenceNotices: silent.length,
    checkinReminders: checkinReminders.length,
    challengesSwept,
    signinAttemptsSwept,
  });
}

/** Vercel Cron invokes cron paths with GET. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

/** Retained for manual invocation and any existing caller. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
