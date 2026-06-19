/**
 * /api/rules — Owner access-rules collection (GET list, POST create).
 *
 * POST validates required fields + estate-irreversible (Property 7) and asserts
 * both refs belong to the owner (cross-owner → 403, Req 3.8).
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.3, 3.4, 3.5, 3.8
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { listRules, createRule, validateAccessRuleInput } from '../../../../lib/rules/access-rules';
import { ensureReleaseState } from '../../../../lib/release/provisioning';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  return NextResponse.json({ rules: await listRules(auth.ownerId) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const input = validateAccessRuleInput(body);
    const rule = await createRule(auth.ownerId, input);
    // Creating a rule for a trigger provisions that trigger's release_state
    // (ARMED) so initiate/simulate have a row to act on (Req 5.1).
    await ensureReleaseState(auth.ownerId, input.trigger_type);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}
