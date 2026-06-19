/**
 * GET /api/audit — Owner audit log (Requirement 8.6).
 *
 * Owner-authenticated; returns the owner's entries in ascending `seq` (no
 * cross-owner data) plus a server-side hash-chain verification result so the
 * viewer can surface tamper-evidence without trusting the client.
 *
 * Feature: relay-h0-mvp
 * Requirements: 8.6
 */

import { NextResponse } from 'next/server';
import { requireOwner, isResponse } from '../../../../lib/http/owner-route';
import { getAuditLog } from '../../../../lib/audit/audit-service';
import { verifyAuditChain } from '../../../../lib/audit/chain';

// Authenticated + DB-backed — never statically prerender this route.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const entries = await getAuditLog(auth.ownerId);
  const verification = verifyAuditChain(entries);

  return NextResponse.json({ entries, verification });
}
