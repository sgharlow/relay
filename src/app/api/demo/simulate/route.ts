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
import { isUserSelectableTriggerType } from '../../../../../lib/domain/enums';
import { readJsonOptional, isResponse } from '../../../../../lib/http/owner-route';

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
  const parsed = await readJsonOptional(req);
  if (isResponse(parsed)) return parsed;
  const body = parsed as { trigger_type?: string };
  const triggerType = body.trigger_type ?? 'emergency';
  /*
    🔴 THIS READ `VALID_TRIGGER_TYPES` UNTIL 2026-08-21 — the DOMAIN enum, which
    still carries `estate` so rows written before the withdrawal keep parsing.
    Every other release-starting boundary asks the CLOSED list (rules, policies,
    initiate, config, the dropdown); this one, which drives ARMED → RELEASED in
    ten seconds and would do it on a NON-REVERSIBLE trigger, asked the open one.

    Nothing could reach it: the route is demo-gated, and `lib/seed/demo-data.ts`
    types its release states as `UserSelectableTriggerType`, so `runSimulation`
    404s at its own state read. That is a gap held shut by two circumstances
    rather than by a rule — structural safety over convention says the closed
    list is the only list a release-starting route consults.
  */
  if (!isUserSelectableTriggerType(triggerType)) {
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
