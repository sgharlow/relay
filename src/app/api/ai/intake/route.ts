/**
 * POST /api/ai/intake — run the Intake Agent over the owner's vault metadata.
 *
 * Owner-authenticated. Reads ONLY via the ZK metadata query layer (never the
 * secret columns) and writes back classifications + clamped importance scores.
 * Returns the count scored plus a warning list of any items that fell back to
 * the default classification (Req 11.9).
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.1, 11.5, 11.9
 */

import { NextResponse } from 'next/server';
import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { runIntake } from '../../../../../lib/ai/intake-agent';

export async function POST(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const result = await runIntake(auth.ownerId);
  return NextResponse.json({
    scored: result.scored,
    warnings: result.warnings,
    results: result.results,
  });
}
