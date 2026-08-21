/**
 * /api/verifiers — Owner verifiers collection (GET list, POST create).
 *
 * ⚠️ POST HAS NO UI CALLER SINCE 2026-08-21 — see the full note on the sibling
 * `/api/recipients` route, which carries the argument for both. In short: J4-R1
 * folded the two add forms into one that posts to `/api/people`, and this
 * handler is now driven only from `scripts/` (`e2e-reveal`, `invite-cohort`,
 * `disposable-owner`, `capture-screens`). It must not be retired for looking
 * dead to a checker that does not scan that directory.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.2
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { listVerifiers, createVerifier, validateVerifierInput } from '../../../../lib/people/verifiers';
import { inviteOnCreateBestEffort } from '../../../../lib/people/invite';
import { assertWithinVerifierCap, EntitlementError } from '../../../../lib/billing/entitlements';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;
  return NextResponse.json({ verifiers: await listVerifiers(auth.ownerId) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  try {
    const input = validateVerifierInput(body);

    // Checked BEFORE the row is written, matching /api/recipients. The sibling
    // route had this from the day the tier existed; this one never did, so a
    // free account could name unlimited verifiers — each of them an address this
    // route then hands to the outbound mail path.
    await assertWithinVerifierCap(auth.ownerId);

    const verifier = await createVerifier(auth.ownerId, input);

    // A verifier who first hears of Relay in an "Action needed" email during
    // someone's emergency is the one most likely to dismiss it as phishing —
    // and J7 only works if verifiers answer. Introduce them while nothing is
    // happening, which is exactly what the invitation copy says.
    await inviteOnCreateBestEffort(auth.ownerId, verifier.id, 'verifier');
    return NextResponse.json(verifier, { status: 201 });
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
