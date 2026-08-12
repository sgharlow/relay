/**
 * GET /api/access — Recipient access dashboard.
 *
 * Auth: a recipient JWT (Authorization: Bearer, or `?token=`). Returns the
 * recipient's scoped items — ranked full metadata when RELEASED, limited
 * descriptive fields otherwise (Req 7.3). Stale tokens (version mismatch) → 403.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1–7.4, 7.6, 7.7
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  getAccessDashboard,
  getAccessDashboardForRecipient,
  AccessError,
} from '../../../../lib/access/dashboard';
import { resolveReleaseForUser } from '../../../../lib/access/session-access';
import { getOwnerSession } from '../../../../lib/auth/session';
import { getClosureSummary } from '../../../../lib/access/closure';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : req.nextUrl.searchParams.get('token') ?? undefined;

  if (!token) {
    // No token: a CLAIMED recipient resolves from their session instead. The row
    // is read fresh, so there is no version claim to go stale — a re-arm closes
    // this on the next call by construction.
    //
    // Both modes coexist deliberately. An unclaimed recipient keeps the emailed
    // code, which is what makes this sprint's rollback a code revert with no data
    // change.
    const session = await getOwnerSession().catch(() => null);
    if (session) {
      const resolved = await resolveReleaseForUser(session.ownerId, { audit: true });
      if (resolved) {
        if (!resolved.released) {
          // Same graceful close the token path gives (J9-R4): the owner checked
          // back in, which is the product working rather than a fault.
          return NextResponse.json(
            {
              error: 'AccessClosed',
              closed: true,
              message: 'That access has closed because they checked back in.',
              state: resolved.state,
            },
            { status: 403 },
          );
        }
        return NextResponse.json(
          await getAccessDashboardForRecipient(resolved.recipientId, resolved.releaseStateId),
        );
      }
    }

    return NextResponse.json({ error: 'Unauthorized', message: 'Recipient token required' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getAccessDashboard(token));
  } catch (err) {
    if (err instanceof AccessError) {
      // The graceful close (J9-R4). A stale version means the owner re-armed —
      // they recovered, or the alarm was false. That is the product working,
      // not a fault, and the recipient deserves to be told so rather than shown
      // an expiry error. Still 403: access really is denied, and the summary is
      // built only for a bearer whose token passes signature verification.
      if (err.httpStatus === 403) {
        const summary = await getClosureSummary(token);
        if (summary) {
          return NextResponse.json(
            { error: 'AccessClosed', closed: true, message: err.message, summary },
            { status: 403 },
          );
        }
      }
      return NextResponse.json({ error: 'AccessError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}
