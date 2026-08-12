/**
 * Owner session helper.
 *
 * `getOwnerSession()` is the single entry point for Server Components, API
 * Route Handlers, and Server Actions to obtain the authenticated owner's
 * identity.  It returns {ownerId, isDemo} on success or throws a NextResponse
 * 401 if the session is missing or malformed.
 *
 * Usage in an API route handler:
 *
 *   import { getOwnerSession } from '@/lib/auth/session';
 *
 *   export async function GET() {
 *     const { ownerId, isDemo } = await getOwnerSession();
 *     // ... use ownerId safely
 *   }
 *
 * Usage in a Server Component (does not throw; redirect instead):
 *
 *   const session = await getOwnerSession().catch(() => null);
 *   if (!session) redirect('/auth/signin');
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { getServerSession } from 'next-auth/next';
import { isSessionCurrent } from './session-epoch';
import { NextResponse } from 'next/server';
import { authOptions } from './auth-options';
import type { Session } from 'next-auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OwnerSession {
  /** UUID of the authenticated owner — maps to users.id. */
  ownerId: string;
  /** True when the account is flagged as a demo account. */
  isDemo: boolean;
}

// ---------------------------------------------------------------------------
// Internal type guard
// ---------------------------------------------------------------------------

function isValidOwnerSession(
  session: Session | null,
): session is Session & OwnerSession {
  if (session === null) return false;
  const s = session as unknown as Record<string, unknown>;
  return (
    typeof s.ownerId === 'string' &&
    s.ownerId !== '' &&
    typeof s.isDemo === 'boolean'
  );
}

// ---------------------------------------------------------------------------
// Public helper
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated owner's session fields.
 *
 * @throws {NextResponse} 401 JSON response if there is no valid session or
 *   if the session is missing the ownerId field (e.g., the MFA factor was
 *   not validated during sign-in).
 */
export async function getOwnerSession(): Promise<OwnerSession> {
  const session = await getServerSession(authOptions);

  if (!isValidOwnerSession(session)) {
    throw NextResponse.json(
      { error: 'Unauthorized', message: 'Valid owner session required' },
      { status: 401 },
    );
  }

  // Revocation. A JWT is a snapshot taken at sign-in, so without this a DELETED
  // user's session keeps working until it expires -- proven on production
  // 2026-08-12, where /api/standby answered 200 for exactly that. One indexed
  // primary-key read is the honest price of immediate revocation on a stateless
  // session, and it denies on failure: a database blip signs people out rather
  // than honouring a stale token, and every route behind this queries the
  // database anyway.
  const epoch = (session as { sessionEpoch?: number }).sessionEpoch;
  if (!(await isSessionCurrent(session.ownerId, epoch))) {
    throw NextResponse.json(
      { error: 'Unauthorized', message: 'That session is no longer valid. Please sign in again.' },
      { status: 401 },
    );
  }

  return {
    ownerId: session.ownerId,
    isDemo: session.isDemo,
  };
}
