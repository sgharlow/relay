/**
 * Recipient-initiated access requests, with owner-challenge-first.
 *
 * Requests fall into three cases, and only one of them needs a verifier:
 *  - False alarm — the owner is fine and says so in one tap. Escalating this
 *    burns the verification network's credibility for nothing.
 *  - Owner conscious but genuinely needs help — post-surgery, overwhelmed. They
 *    can simply approve. Asking three other people to vote on something the
 *    owner is sitting right there agreeing to is absurd.
 *  - Owner truly unreachable — the only case that requires N-of-M.
 *
 * This is what mitigates the verification cold-start risk: verifiers pinged
 * constantly stop responding, and a network that does not respond is not a
 * network (J6-R2).
 *
 * OWNER APPROVAL ADDS NO NEW TRANSITION. It walks the existing
 * ARMED -> PENDING -> GRACE pair with notification suppressed and the quorum
 * auto-satisfied, exactly as simulate.ts already does. PERMITTED_TRANSITIONS
 * stays at seven (J6-R5).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R1 .. J6-R12
 */

import { ValidationError } from '../validation';

export type TriggerType = 'emergency' | 'travel' | 'caregiver' | 'business' | 'estate';

/**
 * How long the owner gets to answer before verifiers are contacted. Emergency
 * is shortest because someone is waiting; estate is longest because it cannot
 * be undone. These are starting proposals, not evidence (J6-R7).
 */
export const CHALLENGE_WINDOW_SECONDS: Record<TriggerType, number> = {
  emergency: 7200, // 2 h
  travel: 14400, // 4 h
  business: 14400, // 4 h
  caregiver: 21600, // 6 h
  estate: 259200, // 72 h
};

export const MAX_REQUESTS_PER_WINDOW = 3;
export const VELOCITY_WINDOW_SECONDS = 86400;

export function challengeExpiry(triggerType: TriggerType, now: Date = new Date()): string {
  const window = CHALLENGE_WINDOW_SECONDS[triggerType] ?? CHALLENGE_WINDOW_SECONDS.emergency;
  return new Date(now.getTime() + window * 1000).toISOString();
}

/**
 * Velocity limit per recipient. A recipient who can request unlimited times can
 * wear an owner down into approving, so repeated asks are throttled (J6-R8).
 */
export function assertRequestAllowed(
  recent: { created_at: string }[],
  now: Date = new Date(),
): void {
  const cutoff = now.getTime() - VELOCITY_WINDOW_SECONDS * 1000;
  const inWindow = recent.filter((r) => new Date(r.created_at).getTime() >= cutoff);

  if (inWindow.length >= MAX_REQUESTS_PER_WINDOW) {
    throw new ValidationError(
      'Too many access requests in the last 24 hours. Please contact them directly.',
      'velocity',
    );
  }
}
