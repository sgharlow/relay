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
 * How long a requester waits after being REFUSED before they may ask again (J6-R8).
 *
 * 🔴 THE DEFECT THIS CLOSES, 2026-08-21. Nothing in this file looked at how a
 * previous request ENDED. `assertRequestAllowed` counted rows, so an owner who
 * read "someone is asking for access to your vault", answered no, and put the
 * phone down could be asked again a minute later, and once more after that,
 * before the three-per-24h budget ran out. Three refusals in an afternoon is
 * not a rate limit doing its job — it is precisely the wearing-down this file's
 * header names as the reason the velocity limit exists, carried out inside the
 * budget. Per-trigger challenge windows did not help either: they bound how long
 * the owner has to ANSWER, not how soon they can be asked again.
 *
 * TWELVE HOURS IS A JUDGEMENT, NOT A MEASUREMENT, and it is written here rather
 * than hidden in a caller so it can be argued with — the same stance
 * `VERIFIER_SILENCE_WINDOW_MS` takes about its own number.
 *
 * It is deliberately short. A cooling-off that runs for days converts "the owner
 * said no once" into "this person cannot raise an alarm this week", and the
 * person barred is the caregiver standing in the kitchen — the one the product
 * exists for. Twelve hours makes "ask again in ten minutes" impossible, which is
 * the coercion, while still letting the same day's genuine change of
 * circumstance through. And it is PER RECIPIENT: a household with two named
 * contacts is not silenced by one refusal, because the other one's clock never
 * started.
 *
 * ⚠️ THE CLOCK RUNS FROM THE ASK, NOT THE ANSWER, and that is a constraint as
 * much as a choice. `access_requests` records `created_at` and nothing else —
 * there is no `resolved_at`, and adding one is a migration for a rule that does
 * not need it. So a request created at T and refused at T+2h stops barring at
 * T+12h, not T+14h. Read the other way round that is the fairer reading anyway:
 * the requester has been unable to do anything since T, so the quiet period is
 * measured ask-to-ask at exactly this length however long the owner took to
 * reply. If a `resolved_at` ever arrives for another reason, anchoring on it
 * would only lengthen the bar, never shorten it.
 */
export const REFUSAL_COOLING_OFF_SECONDS = 12 * 60 * 60;

/**
 * The `access_requests.status` values that count as the owner saying NO.
 *
 * ⚠️ `escalated` IS NOT ONE, and the omission is the rule rather than an
 * oversight. `escalation.ts` is explicit that the absence of an answer must
 * never be read as consent; the mirror of that is that absence must never be
 * read as refusal either. An owner too ill to answer has said nothing, and the
 * recipient who asked is the person most likely to need to ask again — barring
 * them would turn the incapacity this product is sold for into a lock-out.
 * `closed` is left out for the same reason: nothing sets it, so what it would
 * mean is undecided, and guessing here would bar somebody on a guess.
 */
export const REFUSED_STATUSES: readonly string[] = ['denied_by_owner'];

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

/**
 * 🔴 THIS PATTERN WAS QUADRATIC ON ATTACKER-CONTROLLED TEXT until 2026-08-13.
 *
 * The scheme part was `[a-z][a-z0-9+.-]*`, unbounded. On a run of letters with
 * no `://` after it, the engine consumed the whole run at every start position
 * and backtracked — O(n²). Measured: 2,000 chars 3ms, 40,000 chars 1,199ms, and
 * `POST /api/access-requests` puts no size limit on the body. A standby contact
 * — the exact actor this file already names as the threat — could post a
 * megabyte of letters and hold a serverless function's CPU until it timed out.
 *
 * Bounding the quantifier makes it linear and changes nothing real: the longest
 * IANA-registered scheme is well under 32 characters, and anything longer was
 * never a URL this was meant to strip.
 *
 * Found by CI, which timed out where a faster laptop did not — the machine that
 * is slower than yours being the one that tells the truth.
 */
const URLISH = /(?:[a-z][a-z0-9+.-]{0,31}:\/\/|www\.)\S+/gi;

/**
 * Beyond this, no input can affect the 500-character result: whitespace
 * collapsing only ever shortens, so the surviving prefix is drawn from far less
 * than this. Belt to the regex's braces — a bound that holds even if some future
 * pattern here is pathological again.
 */
const MAX_SCAN_CHARS = MAX_REASON_CHARS * 16;

export function sanitiseRequestReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const bounded = raw.length > MAX_SCAN_CHARS ? raw.slice(0, MAX_SCAN_CHARS) : raw;
  const flat = bounded.replace(URLISH, '[link removed]').replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, MAX_REASON_CHARS) : null;
}

export function challengeExpiry(triggerType: TriggerType, now: Date = new Date()): string {
  const window = CHALLENGE_WINDOW_SECONDS[triggerType] ?? CHALLENGE_WINDOW_SECONDS.emergency;
  return new Date(now.getTime() + window * 1000).toISOString();
}

/**
 * One prior request, as much of it as the rule needs.
 *
 * `status` IS REQUIRED, and that is the guard rather than a type detail. The
 * cooling-off below can only fire on a column the caller remembered to SELECT,
 * and a rule that silently does nothing when a field is missing is the shape
 * this repo keeps getting bitten by — an optional `status` would have let
 * `POST /api/access-requests` keep its old two-column read and still compile,
 * with every refusal invisible and the suite green. Making it required moves the
 * failure to `tsc`, where a person sees it.
 */
export interface PriorRequest {
  created_at: string;
  status: string;
}

/**
 * May this requester open another access request?
 *
 * ONE PLACE ANSWERS THIS, deliberately. Two rules apply and they are different
 * questions — "are you asking too often?" and "have you already been told no?" —
 * so they are checked together, in this order, and both surface as a
 * `ValidationError` whose `field` says which one fired. A requester meeting a
 * flat refusal cannot tell those apart otherwise, and they mean opposite things:
 * wait your turn, versus they answered you.
 *
 * Requirements: J6-R8
 */
export function assertRequestAllowed(recent: PriorRequest[], now: Date = new Date()): void {
  // Velocity: a recipient who can request unlimited times can wear an owner
  // down into approving, so repeated asks are throttled.
  const cutoff = now.getTime() - VELOCITY_WINDOW_SECONDS * 1000;
  const inWindow = recent.filter((r) => new Date(r.created_at).getTime() >= cutoff);

  if (inWindow.length >= MAX_REQUESTS_PER_WINDOW) {
    throw new ValidationError(
      'Too many access requests in the last 24 hours. Please contact them directly.',
      'velocity',
    );
  }

  // Cooling-off: the owner has already answered this person, and the answer was
  // no. See REFUSAL_COOLING_OFF_SECONDS for why it is hours and not days.
  // `<=`, so the exact boundary still bars — the same inclusive edge the
  // velocity window above takes, for the same reason: two rules in one function
  // that disagree about what "on the boundary" means is a bug waiting for the
  // one request that lands on it.
  const until = refusalCoolingOffUntil(recent);
  if (until !== null && now.getTime() <= until) {
    /*
      SAY THE REAL NUMBER. This read "in a few hours" while the bar is
      REFUSAL_COOLING_OFF_SECONDS from the refusal — up to twelve. A caregiver
      told "a few hours" comes back at hour three and hour five and meets the
      same flat refusal, so vague reassurance MANUFACTURES the repeated attempts
      the cooling-off exists to stop, in the one message a worried person reads.
      The instant is already computed on the line above and was being discarded.
    */
    const hoursLeft = Math.max(1, Math.ceil((until - now.getTime()) / 3_600_000));
    throw new ValidationError(
      `That request was declined. You can ask again in about ${hoursLeft} ` +
        `${hoursLeft === 1 ? 'hour' : 'hours'} — if this cannot wait, contact them directly.`,
      'cooling_off',
    );
  }
}

/**
 * When the most recent refusal stops barring further requests, in epoch ms, or
 * null if this requester has never been refused.
 *
 * Pure, and exported so the rule can be read and tested without a database —
 * the shape `isChallengeLapsed` and `isVerifierSilence` already establish for
 * the other two time-based rules in this subsystem.
 *
 * ⚠️ AN UNPARSEABLE `created_at` IS IGNORED, not treated as "just now". Bad data
 * must never become a permanent lock-out of the emergency path; the same
 * direction `isChallengeLapsed` takes on a malformed expiry, and the opposite of
 * the direction that would be "safe" if this were a release gate. It is not —
 * refusing to let somebody ask for help is the harm here.
 */
export function refusalCoolingOffUntil(recent: PriorRequest[]): number | null {
  let latest: number | null = null;
  for (const r of recent) {
    if (!REFUSED_STATUSES.includes(r.status)) continue;
    const at = new Date(r.created_at).getTime();
    if (Number.isNaN(at)) continue;
    // The MOST RECENT refusal decides. Rows arrive in whatever order the
    // database returns them, so stopping at the first one found would let a
    // stale refusal shadow a fresh one.
    if (latest === null || at > latest) latest = at;
  }
  return latest === null ? null : latest + REFUSAL_COOLING_OFF_SECONDS * 1000;
}
