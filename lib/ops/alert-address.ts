/**
 * Where an operational alert goes. One definition, three callers.
 *
 * 🔴 THE SAME MISCONFIGURATION HAS NOW BITTEN TWICE, IN THE SAME SHAPE.
 * On 2026-08-13, production had OPS_ALERT_EMAIL set deliberately while the code
 * read only OPS_ALERT_ADDRESS — the variable somebody configured did nothing,
 * and the fallback to the reply-to inbox meant alerts still arrived, so nothing
 * looked wrong. error-reporter.ts and guess-watch.ts were fixed to accept both.
 *
 * lib/ops/incident.ts was not, and read OPS_ALERT_EMAIL alone. So an operator
 * following .env.example — which now recommends OPS_ALERT_ADDRESS — silently
 * muted every client-side incident alert, with no fallback to cover it. Three
 * files, three different answers to one question.
 *
 * This is the portfolio rule about cross-boundary contracts: a value read in
 * more than one place gets exactly one authoritative definition, or the copies
 * drift. The drift here is invisible by construction, because the symptom of a
 * broken alerting path is silence — which is also what working alerting looks
 * like on a good day.
 *
 * BOTH NAMES ARE ACCEPTED rather than renaming the live Vercel variable:
 * accepting a name costs nothing and cannot break anything, whereas renaming a
 * variable that is currently working can. lib/ops/env-example.test.ts pins both
 * so the next person meets one documented answer.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC9
 */

/**
 * Resolves the operator alert address.
 *
 * `fallbackToReplyTo` is opt-IN, because the fallback has its own failure mode:
 * a default that always works makes a misconfiguration invisible. It is right
 * for the monitors whose whole job is to notice silence (they must never be
 * off), and wrong for anything that would rather send nothing than send
 * somewhere unexpected.
 *
 * Returns undefined when nothing is configured — local and preview
 * environments must not try to mail anyone.
 */
export function opsAlertAddress(opts: { fallbackToReplyTo?: boolean } = {}): string | undefined {
  const configured = process.env.OPS_ALERT_ADDRESS ?? process.env.OPS_ALERT_EMAIL;
  const resolved = opts.fallbackToReplyTo
    ? (configured ?? process.env.RESEND_REPLY_TO_ADDRESS)
    : configured;
  const trimmed = resolved?.trim();
  return trimmed ? trimmed : undefined;
}
