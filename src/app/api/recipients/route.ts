/**
 * /api/recipients — Owner recipients collection (GET list, POST create).
 *
 * ⚠️ POST HAS NO UI CALLER SINCE 2026-08-21, AND MUST NOT BE RETIRED FOR IT.
 * J4-R1 folded the circle screen's two add forms into one, which posts to
 * `/api/people`; this handler is now driven only from `scripts/` — every one of
 * the five `verify:live` walks (`e2e-multiowner`, `e2e-ui`, `e2e-reveal`,
 * `e2e-factors`) and `scripts/invite-cohort.ts` create their people through it,
 * as does `scripts/disposable-owner.ts`. Deleting it would break the live-proof
 * chain and the cohort invitation in one move.
 *
 * `lib/ops/api-reachability.ts` scans `src/` and `lib/` only, so it cannot see
 * those callers and reports `POST /api/recipients` (and its verifier sibling) as
 * unreachable. That finding is TRUE about the product surface and WRONG about
 * the handler being dead, which is a distinction its allowlists cannot currently
 * express: `REACHED_FROM_OUTSIDE` is keyed per ROUTE and would exempt GET too,
 * and `KNOWN_UNREACHABLE` would assert these are dead when they are not. The
 * resolution is a method-scoped external-caller entry, and it is a deliberate
 * decision for whoever owns that file — recorded here rather than worked around,
 * because a gate quietly satisfied is a gate that stops meaning anything.
 *
 * GET is unaffected: /rules still reads this collection.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.1
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { listRecipients, createRecipient, validateRecipientInput } from '../../../../lib/people/recipients';
import { assertWithinRecipientCap, EntitlementError } from '../../../../lib/billing/entitlements';
import { inviteOnCreateBestEffort } from '../../../../lib/people/invite';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  return NextResponse.json({ recipients: await listRecipients(auth.ownerId) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const input = validateRecipientInput(body);
    // Free-tier cap, asserted server-side (J1-R7).
    await assertWithinRecipientCap(auth.ownerId);
    const recipient = await createRecipient(auth.ownerId, input);

    // Tell them they have been named, now, while nothing is happening. Until
    // 2026-08-08 nobody was told until an emergency was already underway, which
    // is the worst possible introduction to a product asking for trust.
    await inviteOnCreateBestEffort(auth.ownerId, recipient.id, 'recipient');

    return NextResponse.json(recipient, { status: 201 });
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json(
        { error: 'EntitlementError', message: err.message, limit: err.limit, tier: err.tier },
        { status: 402 },
      );
    }
    return mapError(err);
  }
}
