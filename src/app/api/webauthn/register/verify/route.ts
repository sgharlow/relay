/**
 * POST /api/webauthn/register/verify — finish adding a passkey.
 *
 * Body: `{ response, challengeToken, label? }`.
 *
 * The challenge is opened with `purpose: 'registration'`, so a token minted for
 * the sign-in path cannot be spent here and vice versa.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  requireOwner,
  readJson,
  isResponse,
  mapError,
} from '../../../../../../lib/http/owner-route';
import { finishRegistration, openChallenge } from '../../../../../../lib/auth/webauthn';
import { ValidationError } from '../../../../../../lib/validation';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { response, challengeToken, label } = (body ?? {}) as Record<string, unknown>;

  try {
    if (typeof challengeToken !== 'string' || !response || typeof response !== 'object') {
      throw new ValidationError('response and challengeToken are required', 'response');
    }

    const expectedChallenge = await openChallenge(challengeToken, 'registration');

    const out = await finishRegistration({
      userId: auth.ownerId,
      response: response as never,
      expectedChallenge,
      label: typeof label === 'string' ? label : undefined,
    });

    return NextResponse.json({ registered: true, credentialId: out.credentialId });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { error: 'ValidationError', message: err.message, field: err.field },
        { status: 400 },
      );
    }
    // A bad signature or an expired seal arrives as a jose error, not a
    // ValidationError. It is still the caller's problem, and it must not leak
    // which of the two it was.
    if (err instanceof Error && /jwt|signature|exp/i.test(err.message)) {
      return NextResponse.json(
        { error: 'ValidationError', message: 'That registration attempt expired. Try again.' },
        { status: 400 },
      );
    }
    return mapError(err);
  }
}
