/**
 * /api/rules/[id] — DELETE an owner access rule.
 *
 * PUT was here and is gone — RETIRED 2026-08-13. A rule is changed by removing
 * it and writing another: the builder sits directly beneath the list on /rules,
 * so editing was redundant and had never had a caller. `updateRule` survives in
 * lib/rules/access-rules.ts with its tests.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.3, 3.5, 3.8
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { deleteRule } from '../../../../../lib/rules/access-rules';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  await deleteRule(auth.ownerId, (await params).id);
  return NextResponse.json({ deleted: true });
}
