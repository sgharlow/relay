/**
 * Opt-in outbound-mail transcript, for walking a scenario end to end.
 *
 * WHY IT RECORDS RATHER THAN SUPPRESSES. The obvious way to rehearse a family
 * scenario is to turn email off. That inverts the test: every handoff between
 * the owner, the recipient and the verifier IS an email, so suppressing them
 * exercises the layer already proven and skips the one where this codebase's
 * worst defects have actually lived — a send path that swallowed every failure,
 * and links pointing at a dead deployment host. Both were invisible until a
 * real message reached a real inbox.
 *
 * So messages still send. This just remembers what went out, which is what
 * suppression was really reaching for: the ability to assert on content,
 * ordering and volume without reading somebody's inbox and taking their word
 * for it.
 *
 * ⚠️ NEVER ENABLED IN PRODUCTION. Message bodies contain live access tokens —
 * a recipient link is a bearer credential. Retaining those in memory on a
 * production instance would turn a debugging aid into a credential store, so
 * the guard below is structural rather than a note asking people to be careful:
 * on Vercel production the recorder refuses to arm, whatever the env says.
 *
 * Feature: relay-h0-mvp
 */

export interface TranscriptEntry {
  to: string;
  subject: string;
  text: string;
  /** Every URL found in the body — the part a human is asked to act on. */
  links: string[];
  /** Whether the provider accepted it. A recorded failure is the useful case. */
  accepted: boolean;
  error?: string;
  at: string;
}

let entries: TranscriptEntry[] | null = null;

/**
 * Arms the recorder. Returns false (and stays off) in production.
 *
 * Idempotent: arming an already-armed recorder keeps existing entries, so a
 * caller cannot silently discard a colleague's transcript.
 */
export function startTranscript(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  if (!entries) entries = [];
  return true;
}

export function stopTranscript(): void {
  entries = null;
}

export function getTranscript(): readonly TranscriptEntry[] {
  return entries ?? [];
}

export function isRecording(): boolean {
  return entries !== null;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

/** Called by the email boundary on every send attempt. No-op when disarmed. */
export function recordSend(msg: { to: string; subject: string; text: string }, outcome: { accepted: boolean; error?: string }): void {
  if (!entries) return;
  entries.push({
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    links: msg.text.match(URL_PATTERN) ?? [],
    accepted: outcome.accepted,
    error: outcome.error,
    at: new Date().toISOString(),
  });
}
