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
import { runHeartbeatSweep } from '../../../../../lib/release/heartbeat';
import { ReleaseStateMachine } from '../../../../../lib/release/state-machine';
import { recordSchedulerRun } from '../../../../../lib/release/scheduler-ledger';

async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get('authorization');

  if (!secret || authz !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or missing CRON_SECRET' },
      { status: 401 },
    );
  }

  const summary = await runHeartbeatSweep(new ReleaseStateMachine());

  // CC9: record the run so its ABSENCE is detectable by /api/health/scheduler.
  await recordSchedulerRun(summary);

  return NextResponse.json(summary);
}

/** Vercel Cron invokes cron paths with GET. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

/** Retained for manual invocation and any existing caller. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
