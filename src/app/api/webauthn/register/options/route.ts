/**
 * POST /api/webauthn/register/options — start adding a passkey.
 *
 * Requires a session: registration is stage TWO of the claim, offered after the
 * contact has already bound a device. It is deferrable by design, so nothing here
 * is on the critical path of claiming.
 *
 * The sealed challenge goes back to the CLIENT rather than into a cookie. It is a
 * signed, five-minute JWT carrying a purpose claim, so handing it to the caller
 * costs nothing and avoids cookie plumbing through two round trips.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { NextResponse } from 'next/server';

import { requireOwner, isResponse, mapError } from '../../../../../../lib/http/owner-route';
import { beginRegistration, sealChallenge } from '../../../../../../lib/auth/webauthn';
import { query } from '../../../../../../lib/db/connection';

export async function POST(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  try {
    const u = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [
      auth.ownerId,
    ]);
    const email = u.rows[0]?.email;
    if (!email) {
      return NextResponse.json({ error: 'NotFound', message: 'No such account' }, { status: 404 });
    }

    const { options, challenge } = await beginRegistration({ id: auth.ownerId, email });

    return NextResponse.json({
      options,
      // Attributed: registration always knows who is asking, so the nonce row
      // carries the user. Sign-in deliberately does not — it is identifier-free.
      challengeToken: await sealChallenge(challenge, 'registration', auth.ownerId),
    });
  } catch (err) {
    return mapError(err);
  }
}
