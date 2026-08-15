/**
 * GET /api/health/delivery-webhook — the dead-man's switch for mail telemetry.
 *
 * Sibling of `/api/health/scheduler`, and the same idea: alarm on the ABSENCE of
 * a signal rather than on an error the system was never going to emit. Returns
 * 503 when no provider event has ever arrived, which is the state that leaves
 * `/circle` silently blind about every address.
 *
 * Public and unauthenticated by design, exactly like its sibling: it exposes a
 * count, a timestamp, an age and a boolean — nothing about any recipient — and a
 * monitor has to reach it without credentials.
 *
 * ⚠️ It deliberately does NOT go 503 on a quiet period. Relay sends rarely by
 * design; see the reasoning in lib/notify/webhook-health.ts.
 *
 * Feature: relay-standby
 */

import { NextResponse } from 'next/server';
import { getDeliveryWebhookHealth } from '../../../../../lib/notify/webhook-health';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const health = await getDeliveryWebhookHealth();
  return NextResponse.json(health, { status: health.healthy ? 200 : 503 });
}
