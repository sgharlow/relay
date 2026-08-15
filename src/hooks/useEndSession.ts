'use client';

/**
 * Signing out, all the way out.
 *
 * `signOut()` alone drops the NextAuth session cookie and leaves the step-up
 * elevation cookie behind. That is inert on its own — every guarded route
 * authenticates before it checks elevation, so a stranded elevation cookie
 * unlocks nothing without a session — but "inert today" is a property of the
 * current call order, not a guarantee, and this is the one credential whose
 * theft converts a session into permanent control.
 *
 * So elevation is REVOKED SERVER-SIDE first: the row is consumed, which ends it
 * in every browser rather than only in this one. Then the session goes.
 *
 * BEST EFFORT, DELIBERATELY. If the revoke call fails, sign-out still happens.
 * Refusing to sign somebody out because a housekeeping call did not answer would
 * be the worst possible trade on a shared family computer — the exact machine
 * the sign-out control was added for. The elevation expires on its own within
 * five minutes regardless.
 *
 * Shared by both sign-out controls so the two modes cannot drift on what
 * "sign out" means.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { signOut } from 'next-auth/react';

export async function endSession(callbackUrl = '/'): Promise<void> {
  try {
    await fetch('/api/account/step-up', { method: 'DELETE' });
  } catch {
    // See the header: never block the sign-out.
  }
  await signOut({ callbackUrl });
}
