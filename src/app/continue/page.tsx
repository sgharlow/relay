/**
 * /continue — the one place that decides where a sign-in ends up.
 *
 * Sign-in paths used to each guess: the passkey button sent everyone to
 * `/start`, the email-and-code form sent everyone to `/vault`. Neither asked
 * who the person was, so on 2026-08-12 a standby contact who signed in with the
 * passkey they had just enrolled landed on "Start your vault" inside the owner
 * shell. They came to check on somebody and got an onboarding funnel.
 *
 * A server component rather than client-side branching, because the answer
 * depends on database state the client is not allowed to be told before it is
 * authenticated, and because a redirect that happens before paint has no flash
 * of the wrong page.
 *
 * Deliberately NOT the NextAuth `callbackUrl` default for every provider: an
 * explicit `?callbackUrl=` that a user followed to get here still wins, so
 * "sign in to see this specific thing" keeps working. This is only the fallback
 * for when nobody said where they were going.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R10, 17.1
 */

import { redirect } from 'next/navigation';

import { getOwnerSession } from '../../../lib/auth/session';
import { resolveLanding } from '../../../lib/access/landing';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Signing you in · Relay' };

export default async function ContinuePage() {
  const session = await getOwnerSession().catch(() => null);
  if (!session) redirect('/auth/signin');

  const destination = await resolveLanding(session.ownerId).catch(() => '/start' as const);
  redirect(destination);
}
