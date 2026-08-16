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
 * The environment this process is running in, when it can be named.
 *
 * `VERCEL_ENV` is authoritative when present (`production` | `preview` |
 * `development`). Off Vercel it does not exist, so `NODE_ENV` answers instead.
 * Neither is trusted to be set: an unrecognised process reports `'unknown'`.
 */
export function alertEnvironmentLabel(): string {
  return process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV?.trim() || 'unknown';
}

/**
 * Names the environment ONLY when it is positively, recognisably not
 * production. Returns undefined for production — and for anything it does not
 * recognise.
 *
 * 🔴 THE DIRECTION HERE IS THE WHOLE DESIGN, so it is stated rather than
 * implied. The obvious spelling is `VERCEL_ENV !== 'production' → silence`.
 * That is the dangerous one: `VERCEL_ENV` is a Vercel *system* variable, and a
 * project setting can stop exposing it. Written that way, the day it goes
 * missing is the day every operational alert stops — silently, with no failure
 * to notice, and looking exactly like a quiet week. This file's own docstring
 * already warns that a monitor which needs a variable before it works is a
 * monitor that is off until somebody remembers.
 *
 * So silence requires evidence, never the absence of it. Unset, unexpected or
 * unreadable all send. The cost of that choice is an occasional alert from an
 * environment we could not name — which the alert says on its face.
 */
function positivelyNonProduction(): string | undefined {
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv) return vercelEnv === 'production' ? undefined : vercelEnv;

  const nodeEnv = process.env.NODE_ENV?.trim();
  if (nodeEnv === 'development' || nodeEnv === 'test') return nodeEnv;

  return undefined;
}

/**
 * Resolves the operator alert address.
 *
 * `fallbackToReplyTo` is opt-IN, because the fallback has its own failure mode:
 * a default that always works makes a misconfiguration invisible. It is right
 * for the monitors whose whole job is to notice silence (they must never be
 * off), and wrong for anything that would rather send nothing than send
 * somewhere unexpected.
 *
 * Returns undefined when nothing is configured, and — since 2026-08-15 — when
 * the process is recognisably not production.
 *
 * 🔴 THAT SECOND CONDITION USED TO BE THE FIRST ONE'S SIDE EFFECT, and it did
 * not work. The docstring here claimed "local and preview environments must not
 * try to mail anyone", but the only thing implementing that claim was the hope
 * that such environments had nothing configured. In this repo they always do:
 * `.env.local` is a full production env file, because Relay has no dev
 * database. On 2026-08-15 a `next dev` server duly emailed the operator inbox
 * to report a failure "in production", quoting a stack trace from
 * `.next\dev\server` and pointing at Vercel logs that never held it. The table
 * it complained about was missing for four minutes, on a laptop, mid-migration.
 *
 * An alerting channel is only worth having if everything on it is true. This is
 * the gate that makes the docstring's claim structural instead of hopeful, and
 * it lives here so no caller can forget it: all three ops-alert senders already
 * treat `undefined` as "do not send".
 */
export function opsAlertAddress(opts: { fallbackToReplyTo?: boolean } = {}): string | undefined {
  if (positivelyNonProduction()) return undefined;

  const configured = process.env.OPS_ALERT_ADDRESS ?? process.env.OPS_ALERT_EMAIL;
  const resolved = opts.fallbackToReplyTo
    ? (configured ?? process.env.RESEND_REPLY_TO_ADDRESS)
    : configured;
  const trimmed = resolved?.trim();
  return trimmed ? trimmed : undefined;
}
