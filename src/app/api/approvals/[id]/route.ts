/**
 * POST /api/approvals/[id] — the OWNER decides. Only the owner (J3-R6).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R6
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../lib/http/owner-route';
import { decideApproval } from '../../../../../lib/people/approvals';
import { ValidationError } from '../../../../../lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { decision } = (body ?? {}) as Record<string, unknown>;

  try {
    if (decision !== 'approve' && decision !== 'reject') {
      throw new ValidationError('decision must be approve or reject', 'decision');
    }
    return NextResponse.json(await decideApproval(auth.ownerId, (await params).id, decision));
  } catch (err) {
    return mapError(err);
  }
}
