/**
 * POST /api/people — name a person once, whatever hats they wear (J4-R1).
 *
 * THE DEFECT THIS CLOSES. `/api/recipients` and `/api/verifiers` each take one
 * row, so the circle screen carried two add forms and an owner naming their
 * spouse as both had to enter the same human twice — two rows, two invitations,
 * two claim codes, and a circle that overstates how many people are actually
 * standing by. `listPeople` has merged those rows on the READ side since it
 * shipped; nothing did it on the way in.
 *
 * ⚠️ POST ONLY, AND DELIBERATELY SO. `GET /api/people` existed here once and was
 * RETIRED on 2026-08-13 as "superseded by /api/circle" — the retirement is
 * recorded in the `KNOWN_UNREACHABLE` comment in `lib/ops/api-reachability.ts`,
 * which lists it first of the six removed that day. (That comment says all six
 * went into `docs/retired-surface.md` with their reasons; three of them did.
 * Noted rather than fixed here — the doc is not this file's to edit — because a
 * pointer that does not resolve is how the next person concludes the retirement
 * never happened.)
 *
 * Reading the circle is still `/api/circle`'s job and there must not be two
 * answers to that question; this file adds the write that never existed, and
 * does not bring back the read that was deliberately removed.
 *
 * The two single-role routes are untouched. They remain the API contract for
 * anything that genuinely wants one row — including the approvals queue, which
 * applies a delegate's proposal through `createRecipient` — and this route adds
 * a path over them rather than replacing them.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1, 3.1, 3.2
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { addPerson, validateAddPersonInput } from '../../../../lib/people/add-person';
import { EntitlementError } from '../../../../lib/billing/entitlements';
import { inviteOnCreateBestEffort } from '../../../../lib/people/invite';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const input = validateAddPersonInput(body);

    // Both plan ceilings are asserted inside addPerson, BEFORE either row is
    // written — a dual-hat submission that trips the second cap must not leave
    // the first row behind. Doing it here would put the check back beside one
    // create and reintroduce exactly that.
    const result = await addPerson(auth.ownerId, input);

    /*
      🔴 THE INTRODUCTION FOLLOWS THE ROW THAT WAS CREATED, NEVER THE SUBMISSION.
      `inviteAndNotify` mints a fresh 30-day claim token every time it is called,
      so introducing a row that already existed would hand a live credential to
      an address whose slot may already be claimed and confirmed, and ask a
      person to accept something they accepted months ago. `created: false` is
      the whole reason `addPerson` reports per hat rather than returning ids.

      Two rows means two introductions, because claiming binds ONE roster row —
      a recipient row and a verifier row are separately claimed, separately
      confirmed and separately revoked. Sending one message for two slots would
      leave the second permanently unclaimable. That the dual-hat person receives
      two is a consequence of the storage model, not of this route, and it is
      recorded rather than papered over.
    */
    for (const [outcome, type] of [
      [result.recipient, 'recipient'],
      [result.verifier, 'verifier'],
    ] as const) {
      if (outcome?.created) await inviteOnCreateBestEffort(auth.ownerId, outcome.id, type);
    }

    /*
      201 means something was created; a submission naming somebody who already
      holds every hat asked for created nothing, and saying 201 there would be
      the false green this codebase keeps finding — a status line reporting
      success because nothing errored. The body says which hats are new, so the
      screen can be specific rather than triumphant.
    */
    return NextResponse.json(result, { status: result.createdAnything ? 201 : 200 });
  } catch (err) {
    if (err instanceof EntitlementError) {
      // Shaped exactly like its two siblings, so an owner who hits the ceiling
      // through this route and through /api/recipients is not told two stories.
      return NextResponse.json(
        { error: 'EntitlementError', message: err.message, limit: err.limit, tier: err.tier },
        { status: 402 },
      );
    }
    return mapError(err);
  }
}
