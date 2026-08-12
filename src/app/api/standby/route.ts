/**
 * GET /api/standby — what am I on standby for?
 *
 * Rung 0. A contact can answer this by looking, without anyone having reached
 * them, which is what lets every channel above it be allowed to fail.
 *
 * Membership is resolved from the DATABASE on every call and never from the
 * session token (§3.7 rule 1): the JWT is a snapshot, and authorizing from it
 * would delay revocation by the token lifetime.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { NextResponse } from 'next/server';

import { requireOwner, isResponse, mapError } from '../../../../lib/http/owner-route';
import { resolveStandbyFor } from '../../../../lib/access/standby-resolve';
import { query } from '../../../../lib/db/connection';

export async function GET(): Promise<NextResponse> {
  // `requireOwner` is a misnomer inherited from when every session was an owner.
  // It authenticates a USER; whether they own a vault is a separate question,
  // answered below.
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  try {
    const resolution = await resolveStandbyFor({ userId: auth.ownerId });

    // Drives [A6]'s conversion surface: someone standing by for a family and
    // holding nothing of their own is exactly who "start your own plan" is for.
    const own = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM vault_items WHERE owner_id = $1`,
      [auth.ownerId],
    );

    return NextResponse.json({
      ...resolution,
      hasOwnVault: Number(own.rows[0]?.n ?? 0) > 0,
    });
  } catch (err) {
    return mapError(err);
  }
}
