/**
 * What a rehearsal is allowed to CLAIM — the pure half of `fire-drill.ts`.
 *
 * SPLIT OUT FOR A CONCRETE REASON, not for tidiness. `DrillLine.tsx` is a client
 * component, and importing `describeDrill` from `fire-drill.ts` dragged that
 * module's `pg` and audit-log dependencies into the browser bundle — the build
 * failed with `Can't resolve 'dns' / 'fs' / 'net' / 'tls'`. The judgement here
 * needs no database, so it lives where a client can reach it. Same shape as
 * `lib/notify/delivery-claim.ts`, and for the same reason.
 *
 * Feature: relay-standby
 */

/**
 * How long a rehearsal may sit unanswered before the silence means something.
 *
 * Nobody answers within a minute, and a screen that went amber the instant the
 * owner pressed the button would be reporting its own impatience rather than a
 * fact about a person. A working day is long enough that an ordinary life —
 * asleep, at work, out — is not turned into an alarm.
 */
export const DRILL_GRACE_MS = 12 * 60 * 60 * 1000;

export interface DrillState {
  sentAt: string | null;
  acknowledgedAt: string | null;
}

/**
 * What the owner is told about one person's rehearsal.
 *
 * ⚠️ AN UNANSWERED DRILL IS NOT PROOF OF ANYTHING. It means "we have no evidence
 * this person can be reached", never "this person is unreachable" — people go
 * away. The copy says `did not answer` for exactly that reason, and nothing in
 * the release path consults it. What it IS is the only warning available before
 * the day it matters, which is why the unanswered case is not soft: an owner's
 * instinct is to assume the person is simply busy, and that assumption is what
 * this feature exists to interrupt.
 */
export function describeDrill(
  name: string,
  state: DrillState | null | undefined,
  now: Date = new Date(),
): { tone: 'warn' | 'note'; text: string } | null {
  if (!state?.sentAt) return null;

  const sent = new Date(state.sentAt).getTime();
  const acked = state.acknowledgedAt ? new Date(state.acknowledgedAt).getTime() : null;

  // Answered THIS drill, not some earlier one. Comparing the timestamps rather
  // than merely checking both exist is the difference between "they answered"
  // and "they answered something, once".
  if (acked !== null && !Number.isNaN(acked) && acked >= sent) {
    return {
      tone: 'note',
      text: `${name} answered the last practice run on ${new Date(acked).toLocaleDateString()}.`,
    };
  }

  // Too soon to mean anything. Reporting impatience as a finding would spend the
  // credibility the amber line needs when it is genuine.
  if (Number.isNaN(sent) || now.getTime() - sent < DRILL_GRACE_MS) {
    return {
      tone: 'note',
      text: `Practice run sent to ${name}. Waiting to hear back.`,
    };
  }

  return {
    tone: 'warn',
    text:
      `${name} did not answer the practice run sent on ${new Date(sent).toLocaleDateString()}. ` +
      `That does not prove they are unreachable — people go away — but it is the only warning ` +
      `you will get before the day it matters. Ring them, and check they can sign in.`,
  };
}
