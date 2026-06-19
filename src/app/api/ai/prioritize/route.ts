/**
 * POST /api/ai/prioritize — run the Prioritization Agent (gap detection).
 *
 * Owner-authenticated. Derives the ranked gap list from non-secret metadata
 * (never KMS). Recomputed each call, so resolved gaps drop off automatically.
 *
 * Feature: relay-h0-mvp
 * Requirements: 12.1–12.4
 */

import { NextResponse } from 'next/server';
import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { runPrioritize } from '../../../../../lib/ai/prioritize-agent';

export async function POST(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  return NextResponse.json(await runPrioritize(auth.ownerId));
}
