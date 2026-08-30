/**
 * GET /api/health/orphans — did a walk leave rows on production?
 *
 * The fourth probe, and the one that closes D4's countable half. Its siblings
 * ask whether the cron ticked, whether mail telemetry arrives, and whether an
 * owner was warned. This asks whether the live verifications are cleaning up
 * after themselves — a question nothing has ever asked on a schedule, while the
 * script that answers it sat reporting a FAIL nobody had seen.
 *
 * 503 when a reserved-domain account has been on the cluster for more than a
 * day, or when the dangling-row count has grown past its recorded baseline.
 * See `lib/ops/orphan-health.ts` for why those two are treated differently.
 *
 * Public and unauthenticated, on the same terms as its three siblings and for
 * the same reason: a monitor must be able to reach it holding nothing, or it
 * shares fate with the thing it watches. It exposes COUNTS and one age — never
 * an email, never an id, never a table name. A leaked walk account's address is
 * usually `relay-e2e-<timestamp>@example.test`, which says which walk ran and
 * when, and that is nobody's business on an open endpoint.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4, CC9
 */

import { NextResponse } from 'next/server';

import { getOrphanHealth } from '../../../../../lib/ops/orphan-health';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const health = await getOrphanHealth();
  return NextResponse.json(health, { status: health.healthy ? 200 : 503 });
}
