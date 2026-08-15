/**
 * When the channel goes quiet, tell somebody to pick up a phone.
 *
 * THE FAILURE THIS ADDRESSES IS NOT A BUG — IT IS THE PRODUCT WORKING AS BUILT
 * WHILE NOBODY IS REACHED. A release opens the confirmable window, verifier
 * notices go out, and if those notices are junked the window simply runs. The
 * state machine is correct, the audit log says the verifiers were contacted, the
 * provider says `delivered`, and no human being knows anything is waiting. Relay
 * has already measured every part of that: Outlook files us at SCL 5 with
 * flawless authentication, and a Resend-suppressed address is muted permanently
 * while the send returns 200 with a message id.
 *
 * Redundancy (`fanout.ts`) buys a second chance on the same medium. This is the
 * admission that the medium may simply not work, and that the family has a
 * channel Relay does not: they can ring each other. The product holds the phone
 * numbers already — `lib/people/people.ts` has selected them since the first
 * sprint — and has never once used one.
 *
 * SO THE ESCALATION IS A HUMAN ONE. Nothing here transitions state, opens
 * access, or counts towards quorum; a lapse is the absence of a signal, and
 * `escalation.ts` is already explicit that absence must never be read as
 * consent. All this does is stop the silence being invisible.
 *
 * Pure, so the rule can be read without running anything and tested without a
 * database — the same shape as `isChallengeLapsed`, which it deliberately
 * mirrors.
 *
 * Feature: relay-standby
 * Requirements: J6-R7, J7-R5
 */

/**
 * How long a release may wait on its verifiers before the silence is treated as
 * a fact worth acting on.
 *
 * SIX HOURS IS A JUDGEMENT, NOT A MEASUREMENT, and it is written here rather
 * than hidden in a caller so it can be argued with. It is long enough that a
 * verifier who is asleep, at work, or simply slow is not turned into an alarm —
 * the commonest reason for a gap of an hour or two is an ordinary life, and a
 * product that phones the family every time somebody is in a meeting will be
 * ignored by the third occasion. It is short enough that a genuine emergency
 * begun in the morning is escalated the same day.
 *
 * ⏸️ The right number is a PRODUCT decision that this constant does not settle,
 * exactly as `GRACE_WINDOW_MS` does not settle how long an owner gets to stop a
 * false alarm. Changing it is a one-line change with no migration.
 */
export const VERIFIER_SILENCE_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface WaitingRelease {
  state: string;
  initiated_at: string | null;
  received_confirmations: number;
  required_confirmations: number;
}

/**
 * True when a release has been waiting on its verifiers past the window with
 * quorum still unmet.
 *
 * Bad data never fires it. An unparseable or missing `initiated_at` means "we do
 * not know how long this has been waiting", and not knowing is not grounds for
 * telling a family their circle has gone silent — the same rule
 * `isChallengeLapsed` applies to a malformed expiry, for the same reason.
 */
export function isVerifierSilence(rs: WaitingRelease, now: Date = new Date()): boolean {
  // Only the two states where somebody is actually being waited on. `armed` is
  // the resting state and `released` is already answered.
  if (rs.state !== 'pending' && rs.state !== 'grace') return false;

  // A quorum of zero is satisfied by definition; nobody is being waited on.
  if (rs.required_confirmations <= 0) return false;
  if (rs.received_confirmations >= rs.required_confirmations) return false;

  if (!rs.initiated_at) return false;
  const started = new Date(rs.initiated_at).getTime();
  if (Number.isNaN(started)) return false;

  return now.getTime() - started >= VERIFIER_SILENCE_WINDOW_MS;
}

export interface RingablePerson {
  id: string;
  name: string;
  phone: string | null;
  answered: boolean;
  revoked: boolean;
}

/**
 * Who is actually worth ringing, most-reachable first.
 *
 * A revoked verifier is never named. The owner removed that person on purpose,
 * and `notifyOneVerifier` already refuses to mail them — naming them in a "these
 * people have not answered" list would leak the same fact down a channel that
 * has no such guard.
 */
export function whoToRing(people: RingablePerson[]): RingablePerson[] {
  return people
    .filter((p) => !p.answered && !p.revoked)
    .slice()
    .sort((a, b) => Number(Boolean(b.phone)) - Number(Boolean(a.phone)));
}

/**
 * One line per person, for a message somebody may be reading in a hurry.
 *
 * A missing number is stated rather than skipped. It is the actionable half:
 * it tells whoever is reading which person they must find another way to reach,
 * and it tells the owner afterwards which row in their circle to fix.
 */
export function callListLines(people: RingablePerson[]): string[] {
  return whoToRing(people).map((p) =>
    p.phone ? `${p.name} — ${p.phone}` : `${p.name} — no phone number on file`,
  );
}
