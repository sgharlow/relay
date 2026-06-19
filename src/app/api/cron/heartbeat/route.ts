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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get('authorization');

  if (!secret || authz !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or missing CRON_SECRET' },
      { status: 401 },
    );
  }

  const summary = await runHeartbeatSweep(new ReleaseStateMachine());
  return NextResponse.json(summary);
}
