/**
 * Send an operator alert, and put it in the same ledger as everything else.
 *
 * 🔴 WHY THIS EXISTS RATHER THAN A CALL TO `sendEmail`. The B12.i heartbeat runs
 * on the operator's machine, outside GitHub Actions, precisely so it still
 * speaks when the app and its scheduled workflows do not. `sendEmail` reaches
 * for the Resend SDK, the environment guards and the database on the way past;
 * a watchdog that inherits all of that fails in the conditions it exists for.
 * So the wire call stays a bare POST.
 *
 * 🔴 WHAT THAT COST, UNTIL 2026-09-03. Skipping `sendEmail` also skipped
 * `recordSendAttempt`, and `webhook-health.ts` reads a delivery event with no
 * matching attempt row as proof that the recorder has died. The alert mail is
 * stored like any other — `attributableToRelay` matches on DOMAIN, deliberately,
 * so `hello@relaystandby.com` is Relay — which made every heartbeat alert an
 * orphan. Production showed `orphanEvents: 2` (the two heartbeat alerts)
 * alongside `ripeSends: 5` / `ripeSendsHeard: 5` and `refusedSends: 0`: nothing
 * was wrong with the mail, and the switch was stuck anyway. Permanently, since
 * the orphan query has no upper time bound.
 *
 * So the ledger write comes back, without the rest of the machinery: one
 * dynamic import, after the alert is already gone, and any failure swallowed.
 * The alert is the emergency; the ledger is telemetry about it, and telemetry
 * must never be able to hold up the thing it measures.
 *
 * The alternative was to teach `webhook-health` a second exception. That would
 * have left the next unrecorded sender to discover this all over again — the
 * invariant is worth more than the exception.
 */

/** Injection seams. Both default to the real thing; tests pass their own. */
export interface OperatorAlertDeps {
  fetchImpl?: typeof fetch;
  recordAttempt?: (providerId: string) => Promise<void>;
}

export interface OperatorAlert {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

/**
 * Defers to `recordSendAttempt` only when it is actually needed, so importing
 * this module does not drag the database client into the watchdog's start-up
 * path — where a misconfiguration would silence the alert instead of the
 * telemetry.
 */
async function recordViaLedger(providerId: string): Promise<void> {
  const { recordSendAttempt } = await import('./delivery-events');
  await recordSendAttempt(providerId);
}

/** True when the provider accepted the alert. Never throws. */
export async function sendOperatorAlert(
  msg: OperatorAlert,
  deps: OperatorAlertDeps = {},
): Promise<boolean> {
  const doFetch = deps.fetchImpl ?? fetch;
  const record = deps.recordAttempt ?? recordViaLedger;

  let res: Response;
  try {
    res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${msg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text }),
    });
  } catch {
    return false;
  }

  if (!res.ok) return false;

  // A refused send has no id, and recording one would invent a send that never
  // happened — the opposite of what the ledger is for.
  let providerId: string | undefined;
  try {
    const body = (await res.json()) as { id?: unknown };
    if (typeof body?.id === 'string' && body.id.trim()) providerId = body.id.trim();
  } catch {
    // Accepted, but the body was unreadable. The alert still went.
  }

  if (providerId) {
    try {
      await record(providerId);
    } catch (err) {
      process.stderr.write(`[heartbeat] alert sent but not recorded: ${String(err)}\n`);
    }
  }

  return true;
}
