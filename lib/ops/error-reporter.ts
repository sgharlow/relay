/**
 * Telling someone when a real user hits a 500.
 *
 * WHY THIS EXISTS. The production canary asserts behaviour on the paths it was
 * written to exercise — it exists because a validly signed verifier link 500'd
 * in production behind a green suite of a thousand tests. But a canary can only
 * ever check the failures someone already thought of, and an open self-serve
 * beta driven by ads is strangers walking paths nobody scripted. Without this,
 * the first report of a broken signup is a customer who bothers to email.
 *
 * Next 16's `onRequestError` gives the global server-error hook that Next 14
 * did not have (the canary's header still says otherwise; that comment predates
 * the upgrade). This module is what that hook calls.
 *
 * ⚠️ RULING, 2026-08-20 — THIS IS NOT THE ALARM OF RECORD.
 *
 * The finding (`PROJECT.yaml → deferred → the-in-app-alarm-shares-fate-with-product-email`,
 * B6): this alerter speaks through Resend, which is the same provider the
 * product's own mail rides, whose Outlook deliverability is an open ticket and
 * whose DMARC posture is still `p=none`. A watchdog that shares fate with the
 * thing it watches is the mistake `scheduler-monitor.yml` and
 * `delivery-webhook-monitor.yml` were both written to avoid — "a watchdog must
 * be able to outlive the thing it watches" — and it was being made one layer up.
 *
 * THE RULING IS THAT THE GITHUB-HOSTED MONITORS ARE THE ALARM OF RECORD AND
 * THIS MAIL IS ADVISORY. Three of them run off-platform, alert through GitHub,
 * and share fate with neither Vercel nor Resend:
 *
 *   scheduler-monitor.yml         the release sweep stopped
 *   delivery-webhook-monitor.yml  mail telemetry stopped — i.e. RESEND ITSELF
 *   production-canary.yml         the refusals that cost something stopped refusing
 *
 * So the case that looks worst for this file — Resend degraded — is already
 * covered by an independent path, because a Resend outage stops the delivery
 * webhook and that monitor says so through GitHub.
 *
 * WHY NOT MAKE THIS ONE INDEPENDENT INSTEAD. The two candidates both fail on
 * their own terms. Persisting alerts for a monitor to poll puts the alarm
 * behind DSQL, so it could not report a DSQL outage — the same fate-sharing
 * moved rather than removed, and it needs a migration. Calling GitHub directly
 * from the request path adds an outbound dependency and a second secret to an
 * error handler whose first rule is that it must never throw. Neither buys more
 * than the three monitors already provide.
 *
 * WHAT THIS FILE STILL OWES, and now pays: it is the only thing that knows when
 * ITS OWN alert was refused, so it says so in the log rather than dropping the
 * boolean. See the send below.
 *
 * TWO PROPERTIES DECIDE WHETHER THIS HELPS OR HURTS:
 *
 *   1. It must never throw. It runs inside the error path, so a failure here
 *      turns a handled 500 into an unhandled one and loses the original error.
 *      Every branch is wrapped, including the logging.
 *
 *   2. It must not mail-bomb. One bad deploy is thousands of identical errors.
 *      An alerting channel that floods gets muted, and a muted channel is worse
 *      than no channel because it still looks like coverage. So: alert once per
 *      signature per window, log every occurrence.
 *
 * The dedup window is per-instance memory rather than shared state. That is a
 * deliberate floor, not an oversight — several instances may each send one
 * alert for the same incident, which is a handful of emails, not thousands, and
 * it costs no infrastructure to get there.
 *
 * Feature: relay-h0-mvp (CC9)
 */

import { alertEnvironmentLabel, opsAlertAddress } from './alert-address';
import { sendEmailBestEffort } from '../notify/email';

export interface ErrorContext {
  /** Request path, when the hook knows it. */
  path?: string;
  /** Next's error digest — what appears in the user-facing error page. */
  digest?: string;
}

/** One alert per signature per this long. */
const ALERT_WINDOW_MS = 15 * 60 * 1000;

/** Bound on the dedup map, so a long-lived instance cannot grow it forever. */
const MAX_TRACKED = 500;

const lastAlerted = new Map<string, number>();

export function _resetErrorReporterForTesting(): void {
  lastAlerted.clear();
}

/**
 * Strips the things that turn up in error messages more often than anyone
 * expects, because this text leaves the building by email.
 */
function redact(text: string): string {
  return (
    text
      // scheme://user:password@host
      .replace(/(\w+:\/\/[^:@\s/]+):[^@\s/]+@/g, '$1:***@')
      // token=…, key=…, secret=…, password=…, signature=… in query or prose
      .replace(/\b(token|key|secret|password|passwd|pwd|signature|sig|auth)\b(=|:\s*)\S+/gi, '$1$2***')
      // bearer tokens and long opaque blobs that look like credentials
      .replace(/\bBearer\s+\S+/gi, 'Bearer ***')
      .replace(/\b(sk|rk|whsec|pk)_[A-Za-z0-9_]{8,}/g, '$1_***')
  );
}

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name, stack: err.stack };
  }
  return { message: typeof err === 'string' ? err : `non-Error thrown: ${String(err)}` };
}

/**
 * Groups identical failures. The message and path, not the stack — stacks vary
 * by line between otherwise identical failures and would defeat the dedup.
 */
function signature(message: string, path?: string): string {
  const normalised = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d+/g, '<n>');
  return `${path ?? '?'}::${normalised}`.slice(0, 300);
}

export async function reportServerError(err: unknown, context: ErrorContext = {}): Promise<void> {
  try {
    const { message, stack } = describe(err);
    const safeMessage = redact(message);
    const path = context.path;

    // Always logged, every occurrence, so the rate is visible in the log even
    // when the alert for it was suppressed.
    try {
      process.stderr.write(
        `[error] ${path ?? '?'} ${safeMessage}` +
          (context.digest ? ` digest=${context.digest}` : '') +
          '\n',
      );
    } catch {
      /* a broken stderr must not escalate */
    }

    /*
      Falls back to the reply-to inbox, exactly as lead notification does. A
      monitor that needs a new environment variable before it works is a monitor
      that is silently off until somebody remembers to set it — and this one is
      meant to be the thing that notices silence.

      🔴 OPS_ALERT_EMAIL IS READ TOO, added 2026-08-13. Production had a variable
      called OPS_ALERT_EMAIL, set deliberately, doing absolutely nothing —
      because the code has only ever read OPS_ALERT_ADDRESS. The fallback above
      is what hid it: alerts still arrived, at the reply-to inbox, so nothing
      looked broken and the setting somebody made was simply ignored.

      That is the fallback's own failure mode, and it is worth stating plainly:
      a default that always works is a default that makes a misconfiguration
      invisible. Both names are accepted rather than renaming the variable in
      Vercel, because accepting a name costs nothing and cannot break, whereas
      renaming a live variable can — and the .env.example test now pins both so
      the next person meets one documented answer.
    */
    const to = opsAlertAddress({ fallbackToReplyTo: true });
    // Local and preview environments must not try to mail anyone.
    if (!to) return;

    const key = signature(safeMessage, path);
    const now = Date.now();
    const previous = lastAlerted.get(key);
    if (previous !== undefined && now - previous < ALERT_WINDOW_MS) return;

    if (lastAlerted.size >= MAX_TRACKED) lastAlerted.clear();
    lastAlerted.set(key, now);

    /*
      The environment is stated, never assumed. This line used to read "A
      request failed in production." unconditionally, which is how a `next dev`
      server on a laptop came to file a production incident on 2026-08-15 and
      send the operator to Vercel logs that could not contain it.

      opsAlertAddress() now refuses to resolve outside production, so in
      practice this reads "production" — but it reads it because that is what
      the process reported, and an alert from an environment we could not name
      says so on its face instead of claiming the one that matters most.
    */
    const environment = alertEnvironmentLabel();

    const delivered = await sendEmailBestEffort({
      to,
      subject: `Relay: server error on ${path ?? 'an unknown route'}`,
      text:
        `A request failed in ${environment}.\n\n` +
        `Path:    ${path ?? 'unknown'}\n` +
        `Error:   ${safeMessage}\n` +
        (context.digest ? `Digest:  ${context.digest}\n` : '') +
        `\nFurther identical errors in the next ${ALERT_WINDOW_MS / 60000} minutes are logged ` +
        `but not emailed. Check the Vercel logs for the rate and the full stack.\n` +
        (stack ? `\nFirst stack:\n${redact(stack).split('\n').slice(0, 12).join('\n')}\n` : ''),
    });

    /*
      🔴 THE RETURN VALUE WAS DISCARDED UNTIL 2026-08-20, AND IT IS THE ONE
      THING THIS FUNCTION KNOWS THAT NOBODY ELSE CAN.

      `sendEmailBestEffort` answers `false` when the provider refused — and this
      alert rides Resend, the same provider whose Outlook deliverability is an
      open ticket and whose DMARC posture is still `p=none`. So the failure mode
      was: a 500 happens, the alert is composed, Resend is degraded, the send
      fails, the boolean is dropped on the floor, and the incident is silent
      twice over.

      Losing an alert is not worse than never having one. Losing it SILENTLY is,
      because the quiet reads as health — which is the shape this repository
      keeps catching.

      There is nowhere fate-independent to escalate to from inside this process,
      and that is exactly why the GitHub-hosted monitors are the alarm of record
      (see the ruling in this file's header). What IS achievable here is a
      trace: one distinctly-marked line in the Vercel log, so an operator
      reading back after an outage can see that an alert was composed and lost
      rather than concluding that nothing happened.
    */
    if (!delivered) {
      try {
        process.stderr.write(
          `[error-reporter] ALERT NOT DELIVERED for ${path ?? 'unknown'} — the mail provider ` +
            'refused it. The incident is real and this email did not arrive.\n',
        );
      } catch {
        /* a broken stderr must not escalate — the same rule guess-watch keeps */
      }
    }
  } catch {
    // Deliberately total. This runs inside the error path; anything escaping
    // here would replace a handled failure with an unhandled one.
  }
}
