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
import { sweepExpiredChallenges } from '../../../../../lib/auth/challenge-store';
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
  // owner-cancel window it appears to offer.
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

  // CC9: record the run so its ABSENCE is detectable by /api/health/scheduler.
  await recordSchedulerRun(summary);

  return NextResponse.json({
    ...summary,
    graceReleased,
    escalated: escalated.length,
    silenceNotices: silent.length,
    challengesSwept,
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
