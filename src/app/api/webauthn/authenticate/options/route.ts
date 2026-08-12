/**
 * POST /api/webauthn/authenticate/options — start signing in with a passkey.
 *
 * Deliberately UNAUTHENTICATED and deliberately identifier-free. Discoverable
 * credentials mean the browser offers the right passkey and the person types
 * nothing — which matters most for the contact who may act once in five years.
 *
 * It also means this endpoint reveals nothing: it takes no email, looks nothing
 * up, and returns the same shape to everyone. There is no account to enumerate.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { NextResponse } from 'next/server';

import { beginAuthentication, sealChallenge } from '../../../../../../lib/auth/webauthn';

export async function POST(): Promise<NextResponse> {
  const { options, challenge } = await beginAuthentication();

  return NextResponse.json({
    options,
    challengeToken: await sealChallenge(challenge, 'authentication'),
  });
}
