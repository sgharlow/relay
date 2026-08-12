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

/**
 * The free-text reason, made safe to put in an email.
 *
 * 🔴 THIS BECAME REACHABLE ON 2026-08-12. The reason was stored and mailed
 * verbatim, which was inert while `POST /api/access-requests` required a
 * recipient token nobody could obtain before a release. Giving J6 a front door
 * turned it into **attacker-controlled text that Relay sends from its own domain
 * to the owner's inbox**, and the attacker is exactly the person this
 * architecture already names as a threat: a named contact who accepted, then
 * turned hostile.
 *
 * Two things are removed, for two different reasons.
 *
 * NEWLINES COLLAPSE. The reason is interpolated into a plain-text body inside a
 * quoted block. Newlines let a sender close that quote visually and append text
 * that reads as Relay's own — the ordinary email-body forgery. One line cannot
 * do that.
 *
 * LINKS ARE REMOVED, and the message says so. Relay's anti-phishing promise is
 * that a message from us never asks you to click; a Relay-branded email carrying
 * a stranger's URL, arriving during someone's emergency, spends the domain
 * reputation that promise is built on. A legitimate requester rarely needs a
 * link and can be asked. Stated rather than silently stripped, because a
 * requester who wrote one deserves to know it did not arrive.
 *
 * ⚠️ RESIDUAL, ACCEPTED: bare hostnames with no scheme (`evil.com`) are not
 * stripped, because the patterns that catch them also catch "St. Mary's" and
 * ordinary filenames. Some clients auto-link them. The cap and the attribution
 * bound what that is worth.
 */
export const MAX_REASON_CHARS = 500;

const URLISH = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi;

export function sanitiseRequestReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const flat = raw.replace(URLISH, '[link removed]').replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, MAX_REASON_CHARS) : null;
}

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
