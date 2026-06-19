/**
 * POST /api/ai/triage — run the Triage Agent for a recipient + trigger.
 *
 * Body: { recipient_id, trigger_type }. Owner-authenticated. Returns the
 * dependency-ordered, time-bucketed handoff plan (or a flat importance-desc
 * fallback with a warning, Req 13.8). Non-secret metadata only.
 *
 * Feature: relay-h0-mvp
 * Requirements: 13.1–13.5, 13.8
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse } from '../../../../../lib/http/owner-route';
import { runTriage } from '../../../../../lib/ai/triage-agent';
import { VALID_TRIGGER_TYPES } from '../../../../../lib/rules/access-rules';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { recipient_id, trigger_type } = body as { recipient_id?: string; trigger_type?: string };
  if (!recipient_id || !trigger_type || !VALID_TRIGGER_TYPES.includes(trigger_type as never)) {
    return NextResponse.json(
      { error: 'BadRequest', message: 'recipient_id and a valid trigger_type are required' },
      { status: 400 },
    );
  }

  return NextResponse.json(await runTriage(auth.ownerId, recipient_id, trigger_type));
}
