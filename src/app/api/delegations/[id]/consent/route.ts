/**
 * POST /api/delegations/[id]/consent — the owner records consent.
 *
 * Delegation NEVER activates without this (J3-R2). Consent is obtainable by
 * link, in person, or on paper, so a parent without a smartphone is not a
 * blocker (J3-R3).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R2, J3-R3
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../../lib/http/owner-route';
import { recordConsent, CONSENT_METHODS, type ConsentMethod } from '../../../../../../lib/people/delegation';
import { ValidationError } from '../../../../../../lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { method, evidenceRef } = (body ?? {}) as Record<string, unknown>;

  try {
    if (typeof method !== 'string' || !CONSENT_METHODS.includes(method as ConsentMethod)) {
      throw new ValidationError(
        `method must be one of: ${CONSENT_METHODS.join(', ')}`,
        'method',
      );
    }
    return NextResponse.json(
      await recordConsent((await params).id, {
        method: method as ConsentMethod,
        evidenceRef: typeof evidenceRef === 'string' ? evidenceRef : null,
      }),
    );
  } catch (err) {
    return mapError(err);
  }
}
