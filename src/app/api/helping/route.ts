/**
 * GET /api/helping — the vaults this person helps with, and what they have done.
 *
 * Nothing told a helper they were one. An owner could appoint somebody and
 * record consent, and the person on the other end had no screen, no
 * notification and no way to discover it — so the appointment achieved nothing
 * (reassessment, 2026-08-12).
 *
 * ⚠️ SHAPED BY WHAT A HELPER MAY SEE, not by filtering what an owner sees. The
 * response carries the items this delegation entered and the proposals it made.
 * It never carries the vault, the circle, the triggers or the release state,
 * because those are not narrowed views of this data — they are different
 * questions this route does not ask (J3-R4).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R4, J3-R6
 */

import { NextResponse } from 'next/server';

import { requireOwner, isResponse } from '../../../../lib/http/owner-route';
import {
  listVaultsIHelp,
  listItemsIEntered,
  listMyPendingProposals,
} from '../../../../lib/people/delegate-workspace';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  // ⚠️ `requireOwner()` called WITHOUT `req`, deliberately (§3.7 rule 8).
  // Tidying somebody else's vault must not extend the helper's OWN
  // dead-man's-switch — the same choice `/api/verify` and `/api/standby/leave`
  // make, for the same reason.
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const vaults = await listVaultsIHelp(auth.ownerId);

  const detailed = await Promise.all(
    vaults.map(async (v) => ({
      ...v,
      items: await listItemsIEntered(v.ownerId, v.delegationId),
      proposals: await listMyPendingProposals(v.ownerId, v.delegationId),
    })),
  );

  return NextResponse.json({ vaults: detailed });
}
