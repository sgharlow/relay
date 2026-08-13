/**
 * /api/approvals — the owner's queue, and the helper's way into it.
 *
 * GET  → the owner's pending delegate proposals (J3-R6)
 * POST → a helper proposes; only the owner can apply it
 *
 * Feature: relay-caregiver
 * Requirements: J3-R6
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { listPendingApprovals, enqueueApproval } from '../../../../lib/people/approvals';
import { resolveActor, requireScope } from '../../../../lib/http/delegate-route';
import { validateRecipientInput } from '../../../../lib/people/recipients';
import { IntegrityError } from '../../../../lib/db/integrity';
import { ValidationError } from '../../../../lib/validation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Takes no request argument, so Next tries to prerender it at build time —
 * which means running a query with no session against no database. That made
 * the build depend on the cluster being reachable and on credentials being
 * present, which is why it failed the first time CI ran it on a clean machine
 * and passed on every developer laptop with a .env.local.
 *
 * The route was already dynamic in the built output; this makes the build
 * hermetic rather than changing what ships.
 */
export const dynamic = 'force-dynamic';


export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  return NextResponse.json({ approvals: await listPendingApprovals(auth.ownerId) });
}

/**
 * POST /api/approvals — a HELPER proposes something the owner must decide.
 *
 * 🔴 THE QUEUE COULD NEVER FILL. `enqueueApproval` was written, tested and
 * called by nothing, so the owner's approvals screen — built, deployed and
 * rendering an empty state since it shipped — was waiting on a proposal no
 * surface in the product could make. Found by the 2026-08-12 reassessment.
 *
 * This is the whole point of the delegate model: a helper can suggest people,
 * and CANNOT add them. Everything that changes who can reach what stops here
 * and waits for the owner (J3-R6).
 *
 * ⚠️ `self_designation` IS ALLOWED, and is the reason this queue exists. A
 * helper proposing THEMSELVES as a recipient is the single most dangerous thing
 * they can ask for, so it is not refused — it is routed to the one person
 * entitled to answer it, and labelled as what it is on the way past.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { ownerId: targetOwnerId, kind, payload } = (body ?? {}) as Record<string, unknown>;

  if (typeof targetOwnerId !== 'string' || !UUID_RE.test(targetOwnerId)) {
    return NextResponse.json({ error: 'BadRequest', message: 'ownerId is required' }, { status: 400 });
  }

  // Resolves who is acting and on whose vault, refusing unless an ACTIVE
  // delegation covers that exact pair (J3-R11). An owner posting about their own
  // vault resolves as not-a-delegate and is refused below — they have direct
  // routes and should not be queuing proposals to themselves.
  const actor = await resolveActor(targetOwnerId);
  if (actor instanceof NextResponse) return actor;

  if (!actor.isDelegate) {
    return NextResponse.json(
      { error: 'BadRequest', message: 'Only a helper proposes; you can make this change directly.' },
      { status: 400 },
    );
  }

  try {
    requireScope(actor, 'people:propose');
  } catch (err) {
    if (err instanceof IntegrityError) {
      return NextResponse.json({ error: 'Forbidden', message: err.message }, { status: 403 });
    }
    throw err;
  }

  try {
    if (kind !== 'recipient' && kind !== 'self_designation') {
      throw new ValidationError('kind must be recipient or self_designation', 'kind');
    }
    // Validated HERE as well as on approval, so a malformed proposal is refused
    // at the moment somebody can still fix it rather than surviving in the queue
    // to fail under the owner's hands days later.
    validateRecipientInput(payload);

    return NextResponse.json(
      await enqueueApproval(actor.ownerId, {
        kind,
        payload: payload as Record<string, unknown>,
        proposedByDelegationId: actor.delegationId,
      }),
      { status: 201 },
    );
  } catch (err) {
    return mapError(err);
  }
}
