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
import {
  resolveReleaseForUser,
  resolveReleasesForUser,
} from '../../../../lib/access/session-access';
import { getOwnerSession } from '../../../../lib/auth/session';
import { getOwnerLabel } from '../../../../lib/people/owner-label';
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
      /*
        🔴 TWO OWNERS AT ONCE USED TO COLLAPSE TO AN ARBITRARY ONE. The resolver
        took `LIMIT 1` with no tiebreak, so an adult child standing by for both
        parents saw one plan and had nothing on the page suggesting the other
        existed. That is rare — and it is also precisely the situation this
        product is for, which is why "rare" was never a good enough answer.

        Offered rather than chosen: with more than one open, the caller is told
        both and picks. `?owner=` carries the choice. Nothing is audited on this
        branch — being shown a list of names is not viewing anybody's plan, and
        writing a `dashboard_viewed` entry into two families' chains for one
        visit would put an event in a log that did not happen.
      */
      const open = await resolveReleasesForUser(session.ownerId);
      const chosen = req.nextUrl.searchParams.get('owner') ?? undefined;

      /*
        🔴 A CHOICE THAT DOES NOT RESOLVE USED TO BE REPORTED AS A CLOSURE, found
        2026-08-15 by walking this live rather than by any test. With `?owner=`
        naming somebody this contact does not stand by for, the resolver returns
        null, execution falls through to the closure branch below, and a contact
        with TWO releases open right now is told "That access has closed because
        they checked back in" — a sentence about an event that did not happen,
        on the screen where being wrong costs the most.

        A selector that matches nothing is a bad selector, not an ending. Re-ask
        the question while anything is still open; only fall through when there
        is genuinely nothing, which is what the closure branch is for.
      */
      const unresolved = Boolean(chosen) && !open.some((r) => r.ownerId === chosen);

      if (open.length > 0 && (unresolved || (open.length > 1 && !chosen))) {
        return NextResponse.json(
          {
            error: 'ChooseOwner',
            choose: true,
            message:
              open.length > 1
                ? 'More than one person you stand by for needs you right now.'
                : 'Choose who to open.',
            releases: await Promise.all(
              open.map(async (r) => ({
                ownerId: r.ownerId,
                ownerLabel: await getOwnerLabel(r.ownerId),
                state: r.state,
                released: r.released,
              })),
            ),
          },
          /*
            403 with a discriminator, matching the two branches below it, rather
            than the technically-precise 300 Multiple Choices. Every sibling on
            this path answers 403 + `error` and the client already switches on
            that string, so a fourth case joins an existing switch instead of
            introducing a status class this codebase uses nowhere else. What
            matters is that it is NOT 2xx: a client that has never heard of
            `ChooseOwner` must not be able to mistake this for a dashboard and
            render an empty one.
          */
          { status: 403 },
        );
      }

      const resolved = await resolveReleaseForUser(session.ownerId, {
        audit: true,
        ownerId: chosen,
      });

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
