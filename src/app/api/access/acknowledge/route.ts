/**
 * POST /api/access/acknowledge — the recipient has read what this is and is not.
 *
 * Records the acknowledgement described in lib/access/acknowledgement.ts against
 * the OWNER's audit chain. Gate `g2-counsel-opinion` was declined on 2026-08-14;
 * this record is a named part of what was done instead of obtaining an opinion.
 *
 * TWO IDENTITY PATHS, THE SAME TWO /api/access GET already carries: an unclaimed
 * recipient presents a scoped token, a claimed one resolves from their session.
 * Deliberately mirrored rather than invented — if these two ever disagree about
 * who a recipient is, the acknowledgement would be filed against the wrong
 * person, which is worse than not filing it.
 *
 * Feature: relay-h0-mvp
 */

import { NextResponse, type NextRequest } from 'next/server';

import { verifyRecipientToken } from '../../../../../lib/auth/recipient-token';
import { resolveReleaseForUser } from '../../../../../lib/access/session-access';
import { getOwnerSession } from '../../../../../lib/auth/session';
import { query } from '../../../../../lib/db/connection';
import { recordLimitsAcknowledgement } from '../../../../../lib/access/acknowledgement';

/** The owner whose chain this belongs on, read from the release itself. */
async function ownerOf(releaseStateId: string): Promise<string | null> {
  const r = await query<{ owner_id: string }>(
    `SELECT owner_id FROM release_state WHERE id = $1 LIMIT 1`,
    [releaseStateId],
  );
  return r.rows[0]?.owner_id ?? null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ')
    ? authz.slice(7)
    : (req.nextUrl.searchParams.get('token') ?? undefined);

  let recipientId: string;
  let releaseStateId: string;

  if (token) {
    try {
      const payload = await verifyRecipientToken(token);
      recipientId = payload.recipientId;
      releaseStateId = payload.releaseStateId;
    } catch {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Invalid recipient token' },
        { status: 403 },
      );
    }
  } else {
    const session = await getOwnerSession().catch(() => null);
    const resolved = session ? await resolveReleaseForUser(session.ownerId) : null;
    if (!resolved) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Recipient token required' },
        { status: 401 },
      );
    }
    recipientId = resolved.recipientId;
    releaseStateId = resolved.releaseStateId;
  }

  const ownerId = await ownerOf(releaseStateId);
  if (!ownerId) {
    return NextResponse.json({ error: 'NotFound', message: 'No such release' }, { status: 404 });
  }

  await recordLimitsAcknowledgement({ ownerId, recipientId, releaseStateId });
  return NextResponse.json({ acknowledged: true });
}
