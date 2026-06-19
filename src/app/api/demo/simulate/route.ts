/**
 * POST /api/demo/simulate — demo-only fast-forward of the release state machine.
 *
 * Body: { trigger_type?: string }  (defaults to "emergency")
 *
 * Authentication AND demo-account status are checked BEFORE any state is read or
 * modified (Req 9.1/9.7): a non-demo owner gets 403 without touching state. The
 * run uses the production CAS transitions and takes ~10s (ARMED → PENDING →
 * GRACE → RELEASED).
 *
 * Feature: relay-h0-mvp
 * Requirements: 9.1, 9.2, 9.7
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getOwnerSession } from '../../../../../lib/auth/session';
import { runSimulation } from '../../../../../lib/release/simulate';
import { ReleaseStateMachine } from '../../../../../lib/release/state-machine';
import { TriggerError } from '../../../../../lib/release/triggers';
import { VALID_TRIGGER_TYPES } from '../../../../../lib/rules/access-rules';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth + demo gating FIRST — before any state is inspected (Req 9.1).
  let ownerId: string;
  let isDemo: boolean;
  try {
    ({ ownerId, isDemo } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
  }
  if (!isDemo) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Simulate is available to demo accounts only' },
      { status: 403 },
    );
  }

  // 2. Resolve the trigger type.
  const body = (await req.json().catch(() => ({}))) as { trigger_type?: string };
  const triggerType = body.trigger_type ?? 'emergency';
  if (!VALID_TRIGGER_TYPES.includes(triggerType as never)) {
    return NextResponse.json({ error: 'BadRequest', message: 'Unknown trigger type' }, { status: 400 });
  }

  // 3. Run the simulation (real CAS transitions, ~10s).
  try {
    const result = await runSimulation({
      ownerId,
      triggerType,
      machine: new ReleaseStateMachine(),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TriggerError) {
      return NextResponse.json({ error: 'TriggerError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}
