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

  return {
    ownerId: session.ownerId,
    isDemo: session.isDemo,
  };
}
