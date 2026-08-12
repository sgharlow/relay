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
import { resolveActorNames } from '../../../../lib/audit/actor-names';

// Authenticated + DB-backed — never statically prerender this route.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const entries = await getAuditLog(auth.ownerId);

  // ⚠️ VERIFY FIRST, AND VERIFY THE STORED BYTES. `entry_hash` covers `actor`,
  // so the names below must never be substituted into the entries themselves —
  // they travel as a separate lookup the renderer applies on top.
  const verification = verifyAuditChain(entries);

  const actorNames = await resolveActorNames(
    auth.ownerId,
    entries.map((e) => String((e as { actor?: unknown }).actor ?? '')),
  );

  return NextResponse.json({ entries, verification, actorNames });
}
