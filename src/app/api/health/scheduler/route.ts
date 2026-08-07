/**
 * GET /api/health/scheduler — the CC9 dead-man's-switch probe.
 *
 * Returns 503 when the heartbeat sweep has not run inside the staleness
 * threshold, so an external monitor alarms on the ABSENCE of the signal rather
 * than on an error the system was never going to emit.
 *
 * Public and unauthenticated by design: it exposes only a timestamp, an age,
 * and a boolean, and a monitor must be able to reach it without credentials.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC9, J5-R7
 */

import { NextResponse } from 'next/server';
import { getSchedulerHealth } from '../../../../../lib/release/scheduler-ledger';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const health = await getSchedulerHealth();
  return NextResponse.json(health, { status: health.healthy ? 200 : 503 });
}
