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
import { getClosureSummary, getClosureSummaryForUser } from '../../../../lib/access/closure';

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

      if (resolved?.released) {
        return NextResponse.json(
          await getAccessDashboardForRecipient(resolved.recipientId, resolved.releaseStateId),
        );
      }

      /*
        🔴 IN PROGRESS IS NOT CLOSED. A pending or grace release means the
        opposite of closed: the owner has been asked and has not answered, and
        this may be about to open. Until now every non-released resolve took the
        branch below and told the recipient "That access has closed because they
        checked back in" — describing a check-in that had not happened, on the
        one screen a family member would be watching during the wait. It is the
        same sentence as the true close, so nothing distinguished them.

        No summary and no `closed` flag: this is not an ending, and the client
        must not render the farewell screen for it.
      */
      if (resolved) {
        return NextResponse.json(
          {
            error: 'AccessNotOpenYet',
            pending: true,
            state: resolved.state,
            message:
              'Nothing is open yet. They have been asked to confirm they are all right, and ' +
              'if they do not answer, this page will open on its own. You do not need to do anything.',
          },
          { status: 403 },
        );
      }

      /*
        Nothing is open. That is either the graceful close (J9-R4) or the calm
        steady state, and after a close the row is re-armed — so the two are
        identical by state and are separated by EVIDENCE instead: a summary
        comes back only for someone whose footprint is in the owner's audit
        chain. Absent that, this person never had access, and the 401 below
        carries the right words for them.

        The SUMMARY is what makes the close true rather than merely intended.
        The client only renders it when one is present, so omitting it — as this
        branch did until 2026-08-12 — fell through to "This access link is
        invalid or has expired": no link exists on this path, and it is the
        precise sentence the graceful close was written to replace.
      */
      const summary = await getClosureSummaryForUser(session.ownerId);
      if (summary) {
        return NextResponse.json(
          {
            error: 'AccessClosed',
            closed: true,
            message: 'That access has closed because they checked back in.',
            summary,
          },
          { status: 403 },
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
