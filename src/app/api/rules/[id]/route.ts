/**
 * /api/rules/[id] — Owner access rule (PUT update, DELETE).
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.3, 3.5, 3.8
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../../lib/http/owner-route';
import { updateRule, deleteRule, validateAccessRuleInput } from '../../../../../lib/rules/access-rules';

type Ctx = { params: { id: string } };

const NOT_FOUND = { error: 'NotFound', message: 'Access rule not found' };

export async function PUT(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const input = validateAccessRuleInput(body);
    const updated = await updateRule(auth.ownerId, params.id, input);
    if (!updated) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  await deleteRule(auth.ownerId, params.id);
  return NextResponse.json({ deleted: true });
}
