/**
 * GET /api/readiness — can this vault actually open?
 *
 * Nothing in the product previously asked that question, which is how a vault
 * with no trusted contact could look entirely finished while being incapable
 * of ever releasing.
 *
 * Feature: relay-h0-mvp
 */

import { NextResponse } from 'next/server';

import { requireOwner, isResponse } from '../../../../lib/http/owner-route';
import { assessReadiness } from '../../../../lib/vault/readiness';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  return NextResponse.json(await assessReadiness(auth.ownerId));
}
