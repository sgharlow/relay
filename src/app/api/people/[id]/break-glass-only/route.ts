/**
 * POST /api/people/[id]/break-glass-only — record (or undo) the documented
 * exclusion of §8.1.
 *
 * ⚠️ THIS ROUTE DELIBERATELY ANSWERS WITH THE CONSEQUENCE, not just `ok`.
 * The failure mode of this feature is converting a nagging red light into a
 * comfortable silence: an owner marks two of three verifiers as paper-only, the
 * nagging stops, and the plan is now impossible with nothing saying so. So the
 * readiness assessment is re-run after the change and the fatal blocker — if the
 * exclusion just created one — comes back in the response for the UI to show
 * immediately, rather than waiting for the banner on the next page load.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../../lib/http/owner-route';
import { assertOwns } from '../../../../../../lib/db/integrity';
import { setBreakGlassOnly } from '../../../../../../lib/people/break-glass-only';
import { assessReadiness } from '../../../../../../lib/vault/readiness';
import { ValidationError } from '../../../../../../lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { personType, value } = (body ?? {}) as Record<string, unknown>;

  try {
    if (personType !== 'recipient' && personType !== 'verifier') {
      throw new ValidationError('personType must be recipient or verifier', 'personType');
    }

    await assertOwns(
      auth.ownerId,
      personType === 'recipient' ? 'recipients' : 'verifiers',
      (await params).id,
    );

    await setBreakGlassOnly({
      ownerId: auth.ownerId,
      personId: (await params).id,
      personType,
      value: value !== false,
    });

    const readiness = await assessReadiness(auth.ownerId);
    const blocker = readiness.blockers.find((b) => b.fatal) ?? null;

    return NextResponse.json({
      breakGlassOnly: value !== false,
      // Null when the plan still works. Present when this change — or something
      // already true — means it does not.
      blocker: blocker ? { message: blocker.message, href: blocker.href } : null,
      circle: { light: readiness.circle.light, executable: readiness.circle.executable },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { error: 'ValidationError', message: err.message, field: err.field },
        { status: 400 },
      );
    }
    return mapError(err);
  }
}
