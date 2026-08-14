/**
 * Somebody hit a failure. Tell someone.
 *
 * 🔴 THE GAP THIS CLOSES. The scheduler has a dead-man's switch (J5-R7); the
 * CUSTOMER path had nothing. Twenty-seven `console.error` calls wrote to Vercel
 * logs that nobody watches, there was no root error boundary, and a mistyped URL
 * returned Next's bare default. So a real person hitting a real failure produced
 * silence, and the only way to learn of it was to go looking — which is the
 * definition of a thing nobody does.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT SENT: the error MESSAGE. Next.js gives a `digest`
 * in production precisely so a message never has to cross the wire, and this
 * product's central promise is that plaintext never leaves the browser. An
 * exception thrown anywhere near the crypto path could carry anything in its
 * text, so the report is the digest, the path and the mode — enough to find it
 * in the logs, and nothing that could contain somebody's vault.
 *
 * ⚠️ THE ALERT GOES THROUGH THE CHANNEL WE KNOW IS UNRELIABLE. Resend files at
 * SCL 5 with Outlook and mutes a bounced address silently, which is exactly the
 * "a failure alert is not a dead man" trap. It is used anyway, and honestly:
 * the alert is a PUSH convenience on top of a record that already exists in
 * Vercel's runtime logs. If the mail fails, the incident is still queryable —
 * the log is the record, the email is the tap on the shoulder. Swapping in a
 * real error service later is this one file.
 *
 * Feature: relay-h0-mvp
 * Requirements: J5-R7
 */

import { opsAlertAddress } from './alert-address';
import { sendEmailBestEffort } from '../notify/email';

export interface IncidentReport {
  /** React's production error digest — a hash, never a message. */
  digest: string | null;
  /** Where it happened. A pathname only; query strings can carry tokens. */
  path: string;
  /** Which half of the product: an owner mid-setup or a contact mid-crisis. */
  mode: 'owner' | 'access' | 'public';
}

/**
 * Dedup window. One broken page reloaded by one frustrated person is one
 * incident, not thirty — and an alert channel that cries wolf is one that stops
 * being read, which is the failure this exists to prevent rather than cause.
 *
 * In-process memory, so it resets on redeploy and does not dedup across Vercel
 * instances. That is acceptable for its job: it bounds a storm, it is not a
 * ledger. The ledger is the runtime log.
 */
const SEEN = new Map<string, number>();
const DEDUP_MS = 15 * 60 * 1000;
/** Hard ceiling per window, so a novel-digest storm cannot become a mail flood. */
const MAX_ALERTS_PER_WINDOW = 5;
let windowStart = 0;
let sentThisWindow = 0;

/** Test seam — the module holds process-lifetime state by design. */
export function _resetIncidentStateForTesting(): void {
  SEEN.clear();
  windowStart = 0;
  sentThisWindow = 0;
}

function shouldAlert(key: string, now: number): boolean {
  if (now - windowStart > DEDUP_MS) {
    windowStart = now;
    sentThisWindow = 0;
    SEEN.clear();
  }
  if (SEEN.has(key)) return false;
  SEEN.set(key, now);
  if (sentThisWindow >= MAX_ALERTS_PER_WINDOW) return false;
  sentThisWindow += 1;
  return true;
}

/**
 * Records the incident and, when it is not a repeat, alerts the operator.
 *
 * Always writes to stderr first: the log is the record and must not depend on
 * the alert succeeding. Returns whether an alert was attempted, which is what
 * the route reports back — never anything about the error itself.
 */
export async function reportIncident(
  report: IncidentReport,
  now: number = Date.now(),
): Promise<{ alerted: boolean }> {
  const line = `[incident] mode=${report.mode} path=${report.path} digest=${report.digest ?? 'none'}`;
  process.stderr.write(`${line}\n`);

  /*
    🔴 THIS READ OPS_ALERT_EMAIL ALONE, so an operator following .env.example —
    which recommends OPS_ALERT_ADDRESS — silently muted every client-side
    incident alert. Its two siblings already accepted both names after the same
    misconfiguration was found in production on 2026-08-13; this file was
    missed, and unlike them it has no reply-to fallback to hide the gap.

    The fallback is deliberately NOT taken here: an incident report should go to
    the operator address or nowhere, rather than surprising the public reply-to
    inbox. See lib/ops/alert-address.ts.
  */
  const to = opsAlertAddress();
  // No address configured is a valid deployment, not an error. The log still has
  // it; nobody is woken up.
  if (!to) return { alerted: false };

  const key = `${report.mode}:${report.path}:${report.digest ?? 'none'}`;
  if (!shouldAlert(key, now)) return { alerted: false };

  await sendEmailBestEffort({
    to,
    subject: `Relay: someone hit an error on ${report.path}`,
    text:
      `A ${report.mode === 'access' ? 'CONTACT' : report.mode} page failed for somebody using ` +
      `Relay.\n\n` +
      `  Path    ${report.path}\n` +
      `  Digest  ${report.digest ?? 'none — the error had no production digest'}\n` +
      `  Mode    ${report.mode}\n\n` +
      `The message itself is deliberately not included: a thrown error near the crypto path ` +
      `could carry vault content, so only the digest crosses the wire. Search the Vercel runtime ` +
      `logs for that digest to see the stack.\n\n` +
      `Repeats of this exact failure are suppressed for 15 minutes.\n`,
  });

  return { alerted: true };
}
